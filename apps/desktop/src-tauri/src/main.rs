#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod app_state;
mod bootstrap;
mod cloud_opening_book;
mod credential_store;
mod desktop_types;
mod eleeye_opening_book;
mod engine_service;
mod gif_export;
mod link_service;
mod link_vision;
mod manual_pdf;
mod manual_service;
mod opening_book;
mod pdf_report;
mod pfbook_opening_book;
mod report_service;
mod sync_service;
mod training_service;
mod ttxq_sync;
mod u10_learning;
mod window_service;
#[cfg(target_os = "windows")]
mod windows_link;
mod xqb_opening_book;

use std::collections::{BTreeMap, HashMap};
use std::fs::{self, File};
use std::io::{Cursor, Read};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command as ProcessCommand;
use std::process::Stdio;
use std::sync::atomic::Ordering;
use std::time::Duration;
use std::time::Instant;

use app_state::{AppModel, DesktopState};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use chrono::{DateTime, Utc};
use credential_store::TOKEN_KEY;
use engine_protocol::{EngineEvent, EngineSession, Protocol, SearchLimit};
use link_core::{
    BoardOrientation, CapturePolicy, CaptureSource, LinkMode, LinkSessionState, RecognitionMode,
    ReconcileDecision, StabilityGate,
};
use local_store::{
    AnalysisSummary, DesktopPreferences, FlyknifePlan, FlyknifeStepAnnotation, GameMirrorStatus,
    GuidedAnalysisSession, GuidedAnalysisSubmission, ImportedGame, ImportedMasterStyleProfile,
    ImportedMasterStyleSample, ImportedTheoryCard, LearningProfile, LibraryFolder, LocalGame,
    LocalStore, MasterStyleHint, MasterStyleProfile, StudySession, SyncAccountBinding, TheoryCard,
    TheoryCardFeedback, TheoryLesson, TrainingAttempt, TrainingTask, WeaknessStat,
};
use manual_format::{
    ManualDocument, ManualFormat, ManualMetadata, detect_format, export_chinese_text,
    export_dhtmlxq, export_mainline_pgn, export_pgn, import_document,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sync_protocol::{
    AddMovePayload, CreateGamePayload, DeleteNodePayload, Operation, OperationKind,
    ReorderBranchesPayload, SetMainlinePayload, UpdateCommentPayload, UpdateGameMetadataPayload,
};
use tauri::{Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::time::timeout;
use u10_learning::{
    DailyTrainingPlanDto, GuidedAnalysisResultDto, GuidedEngineLine, OpeningRepertoireDto,
    OpeningSample, WeeklyLearningReportDto, classify_submission, daily_plan,
    infer_opening_repertoire, weekly_report,
};
use uuid::Uuid;
use xiangqi_core::{
    Board, Color, DomesticRuleState, GameStatus, Move, PieceKind, RuleMode, RuleVerdict,
    STARTING_FEN, Square,
};
use xiangqi_manual::{ManualTree, MoveNode};

#[cfg(target_os = "macos")]
#[link(name = "CoreGraphics", kind = "framework")]
unsafe extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
}

#[cfg(target_os = "macos")]
#[link(name = "ApplicationServices", kind = "framework")]
unsafe extern "C" {
    fn AXIsProcessTrusted() -> bool;
}

pub(crate) use desktop_types::*;

#[derive(Serialize)]
struct AppInfoDto {
    version: &'static str,
    build_timestamp: u64,
    platform: String,
}

#[tauri::command]
fn get_app_info() -> AppInfoDto {
    AppInfoDto {
        version: env!("CARGO_PKG_VERSION"),
        build_timestamp: env!("XIANGQI_BUILD_TIMESTAMP").parse().unwrap_or_default(),
        platform: format!("{} · {}", std::env::consts::OS, std::env::consts::ARCH),
    }
}

fn main() {
    tauri::Builder::default()
        .setup(bootstrap::initialize)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            get_app_info,
            manual_service::get_state,
            link_service::prepare_link_selection_window,
            link_service::list_link_target_windows,
            link_service::complete_link_region_selection,
            link_service::cancel_link_region_selection,
            link_service::get_link_region_selection_background,
            link_service::start_link_session,
            link_service::stop_link_session,
            link_service::get_link_session_status,
            link_service::pause_link_session,
            link_service::recalibrate_link_session,
            link_service::get_link_capture_preview,
            link_service::recognize_link_image_file,
            link_service::submit_link_position,
            link_service::set_link_side_to_move,
            link_service::confirm_link_engine_move,
            link_service::import_recognized_position,
            ttxq_sync::get_ttxq_sync_progress,
            ttxq_sync::start_ttxq_authorization,
            ttxq_sync::collect_ttxq_h5_history,
            ttxq_sync::submit_ttxq_bridge_payload,
            ttxq_sync::report_ttxq_read_progress,
            ttxq_sync::report_ttxq_bridge_error,
            ttxq_sync::import_ttxq_history,
            ttxq_sync::disconnect_ttxq,
            manual_service::list_games,
            manual_service::get_game_mirror_status,
            manual_service::update_game_mirror,
            manual_service::rebuild_game_mirrors,
            manual_service::reveal_game_mirror,
            manual_service::list_library_folders,
            manual_service::create_library_folder,
            manual_service::rename_library_folder,
            manual_service::delete_library_folder,
            manual_service::update_game_library,
            manual_service::open_game,
            manual_service::play_move,
            manual_service::confirm_recognized_move,
            manual_service::preview_recognized_move_from_current,
            manual_service::resolve_screenshot_move,
            manual_service::preview_line,
            manual_service::parse_chinese_line,
            manual_service::new_game,
            manual_service::open_document,
            manual_service::import_xqb_opening_book,
            manual_service::import_eleeye_opening_book,
            manual_service::import_text,
            manual_service::export_text,
            manual_service::export_document_text,
            manual_service::export_document_file,
            manual_service::export_replay_gif,
            manual_service::export_mind_map_svg,
            manual_service::export_text_file,
            manual_service::export_manual_pdf,
            manual_service::save_document,
            manual_service::update_game_metadata,
            manual_service::reorder_branches,
            manual_service::navigate_to,
            manual_service::update_comment,
            manual_service::set_mainline,
            manual_service::delete_node,
            engine_service::detect_pikafish,
            window_service::open_compact_floating_panel,
            window_service::return_compact_floating_panel,
            engine_service::analyze_position,
            engine_service::run_engine_arena,
            engine_service::engine_play_move,
            engine_service::move_now,
            engine_service::stop_engine_play,
            report_service::stop_analysis,
            report_service::get_saved_analysis,
            report_service::generate_game_report,
            report_service::cancel_game_report,
            report_service::get_game_report,
            report_service::export_game_report_pdf,
            report_service::import_master_style_profile,
            report_service::list_master_style_profiles,
            report_service::match_master_style_hints,
            engine_service::get_desktop_preferences,
            engine_service::save_desktop_preferences,
            engine_service::list_builtin_opening_books,
            engine_service::probe_engine,
            engine_service::list_engine_profiles,
            engine_service::register_engine_profile,
            engine_service::set_active_engine_profile,
            engine_service::delete_engine_profile,
            engine_service::query_cloud_opening_book,
            training_service::list_flyknife_templates,
            training_service::list_flyknife_topics,
            training_service::get_book_topic_detail,
            training_service::recognize_book_page,
            training_service::save_book_import,
            training_service::open_external_url,
            training_service::open_flyknife_topic,
            training_service::generate_flyknife_candidates,
            training_service::list_flyknife_plans,
            training_service::save_flyknife_plan,
            training_service::delete_flyknife_plan,
            training_service::open_flyknife_practice,
            training_service::list_coach_reports,
            training_service::get_learning_profile,
            training_service::save_learning_profile,
            training_service::start_guided_analysis,
            training_service::submit_guided_analysis,
            training_service::cancel_guided_analysis,
            training_service::generate_daily_training_plan,
            training_service::get_weekly_learning_report,
            training_service::infer_opening_repertoire_command,
            training_service::list_training_tasks,
            training_service::generate_training_tasks,
            training_service::complete_training_task,
            training_service::get_training_summary,
            training_service::list_study_sessions,
            training_service::save_study_session,
            training_service::scan_theory_library,
            training_service::get_theory_library,
            training_service::review_theory_card,
            training_service::create_theory_card,
            training_service::save_theory_feedback,
            sync_service::get_sync_account,
            sync_service::get_subscription,
            sync_service::redeem_subscription_code,
            sync_service::list_master_players,
            sync_service::get_master_library_stats,
            sync_service::get_master_opening_profile,
            sync_service::list_master_games,
            sync_service::open_master_game,
            sync_service::find_related_master_games,
            sync_service::register_sync_account,
            sync_service::login_sync_account,
            sync_service::logout_sync_account,
            sync_service::unbind_sync_account,
            sync_service::sync_now
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Xiangqi Studio")
        .run(|app_handle, event| {
            #[cfg(not(target_os = "macos"))]
            let _ = (&app_handle, &event);
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(main_window) = app_handle.get_webview_window("main") {
                    let _ = main_window.show();
                    let _ = main_window.unminimize();
                    let _ = main_window.set_focus();
                }
            }
        });
}

#[cfg(test)]
mod desktop_tests;
