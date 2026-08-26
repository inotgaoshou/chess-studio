use super::*;
use crate::credential_store::SystemCredentialStore;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Condvar, Mutex};

mod tests {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    use super::*;
    use crate::engine_service::*;
    use crate::link_service::*;
    use crate::manual_service::*;
    use crate::report_service::*;
    use crate::sync_service::*;
    use crate::training_service::*;

    async fn mock_auth_server(status: &str, body: String) -> String {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let status = status.to_owned();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = vec![0; 4096];
            let read = socket.read(&mut request).await.unwrap();
            let request = String::from_utf8_lossy(&request[..read]);
            assert!(request.starts_with("POST /api/v1/auth/login HTTP/1.1"));
            let response = format!(
                "HTTP/1.1 {status}\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            socket.write_all(response.as_bytes()).await.unwrap();
        });
        format!("http://{address}")
    }

    fn desktop_state_for_link_tests() -> DesktopState {
        let game_id = Uuid::new_v4();
        let device_id = Uuid::new_v4();
        let tree = ManualTree::new();
        let mut store = LocalStore::open_in_memory().unwrap();
        let create_operation = Operation {
            op_id: Uuid::new_v4(),
            device_id,
            entity_id: game_id,
            game_id,
            kind: OperationKind::CreateGame,
            payload: serde_json::to_value(CreateGamePayload {
                title: "连线测试".into(),
                fen: STARTING_FEN.into(),
                root_id: tree.root_id(),
            })
            .unwrap(),
            lamport: 1,
            created_at: Utc::now(),
        };
        store
            .save_game_with_operation(
                game_id,
                "连线测试",
                STARTING_FEN,
                tree.root_id(),
                &create_operation,
            )
            .unwrap();
        DesktopState {
            model: Mutex::new(AppModel {
                board: Board::from_fen(STARTING_FEN).unwrap(),
                starting_fen: STARTING_FEN.into(),
                tree,
                current_node: None,
                game_id,
                device_id,
                lamport: 1,
                store,
                metadata: ManualMetadata::default(),
                note: String::new(),
                source_path: None,
                source_format: None,
                playable: true,
            }),
            credentials: Arc::new(SystemCredentialStore),
            session_token: Mutex::new(None),
            engine: tokio::sync::Mutex::new(HashMap::new()),
            report_engine: tokio::sync::Mutex::new(None),
            report_commit: tokio::sync::Mutex::new(()),
            play_session: tokio::sync::Mutex::new(None),
            analysis_generation: AtomicU64::new(0),
            play_generation: AtomicU64::new(0),
            report_generation: AtomicU64::new(0),
            report_running: AtomicBool::new(false),
            cloud_book_cache: Mutex::new(BTreeMap::new()),
            link_session: Mutex::new(LinkSession::default()),
            screenshot_resolution_guard: Mutex::new(()),
            link_capture_generation: AtomicU64::new(0),
            link_region_selection_background: Mutex::new(None),
            link_region_selection: (Mutex::new(None), Condvar::new()),
        }
    }

    #[test]
    fn screenshot_resolution_prefers_exact_yolo_position_over_conflicting_white_marker() {
        // This intentionally has two legal red continuations. The white marker
        // points to the cannon route, while the complete YOLO post-move FEN is
        // the horse route. The marker must not override exact placement.
        let before = Board::from_fen("4k4/9/9/9/9/4p4/9/C8/9/1N2K4 w - - 0 1").unwrap();
        let horse = Move::from_iccs("b0c2").unwrap();
        let cannon = Move::from_iccs("a2a0").unwrap();
        assert!(before.legal_moves().contains(&horse));
        assert!(before.legal_moves().contains(&cannon));
        let recognized_after = before.apply_move(horse).unwrap();

        let resolution = resolve_screenshot_move_from_board(
            &before,
            &recognized_after,
            Some(link_vision::ScreenshotMoveMarker {
                from: Some(cannon.from),
                to: Some(cannon.to),
                from_confidence: 240,
                to_confidence: 480,
            }),
            BoardOrientation::RedAtBottom,
        )
        .unwrap();

        assert_eq!(resolution.status, "unique");
        assert_eq!(resolution.candidates.len(), 1);
        assert_eq!(resolution.candidates[0].step.notation, "马八进七");
        assert_eq!(resolution.candidates[0].step.from.row, horse.from.row);
        assert_eq!(resolution.candidates[0].step.to.col, horse.to.col);
        assert_ne!(resolution.candidates[0].step.notation, "炮九退二");
    }

    #[test]
    fn tiantian_fixture_yolo_position_resolves_the_documented_last_move() {
        // This is the production path exercised against the anonymous mobile
        // fixture: YOLO reconstructs the complete post-move placement first,
        // then the resolver enumerates legal moves from the known parent. The
        // white circle/base glow is passed in only as a tie-breaker and cannot
        // manufacture a candidate.
        const PARENT_FEN: &str =
            "1r1akabn1/3r5/nc2b2c1/p3p1p1p/9/1NR6/P3P1P1P/1C2C1N2/9/1RBAKAB2 w - - 0 1";
        let parent = Board::from_fen(PARENT_FEN).expect("fixture parent position");
        let expected_move = Move::from_iccs("b4c6").expect("fixture last move ICCS");
        assert!(parent.legal_moves().contains(&expected_move));

        let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let model = manifest_dir.join("resources/link-vision/yolov11.onnx");
        let fixture = include_bytes!("../tests/fixtures/tiantian-black-bottom-board.jpg");
        let mut detector = link_vision::Yolo11Detector::open(&model).unwrap_or_else(|error| {
            panic!("bundled YOLO11 model must load for fixture regression: {error}")
        });
        let detections = detector.detect_png(fixture).unwrap_or_else(|error| {
            panic!("YOLO11 must infer the bundled anonymous fixture: {error}")
        });
        let recognition = link_vision::recognition_from_detections(&detections, &parent)
            .unwrap_or_else(|error| {
                panic!("fixture must reconstruct a complete board placement: {error}")
            });
        let marker = link_vision::detect_screenshot_move_marker_from_png(
            fixture,
            &detections,
            recognition.orientation,
        )
        .unwrap_or_else(|error| panic!("fixture marker extraction must not fail: {error}"));
        let recognized_after = Board::from_fen(&recognition.fen)
            .expect("YOLO reconstruction must remain a valid Xiangqi FEN");

        let resolution = resolve_screenshot_move_from_board(
            &parent,
            &recognized_after,
            marker,
            recognition.orientation,
        )
        .expect("strict screenshot resolution");

        assert_eq!(recognition.orientation, BoardOrientation::BlackAtBottom);
        assert_eq!(resolution.status, "unique");
        assert_eq!(resolution.candidates.len(), 1);
        let candidate = &resolution.candidates[0];
        assert_eq!(candidate.step.notation, "马八进七");
        assert_eq!(candidate.step.moved_by, "红方");
        assert_eq!(candidate.step.from.row, expected_move.from.row);
        assert_eq!(candidate.step.from.col, expected_move.from.col);
        assert_eq!(candidate.step.to.row, expected_move.to.row);
        assert_eq!(candidate.step.to.col, expected_move.to.col);
        assert_eq!(candidate.side_to_move, "黑方");
    }

    #[test]
    fn screenshot_resolution_never_creates_a_marker_only_candidate() {
        let before = Board::from_fen("4k4/9/9/9/9/4p4/9/C8/9/1N2K4 w - - 0 1").unwrap();
        let cannon = Move::from_iccs("a2a0").unwrap();
        // The YOLO board is visibly different from every legal continuation
        // from `before`: the red horse is missing. A high-confidence marker
        // for cannon a2-a0 must still yield no exact match.
        let unrelated = Board::from_fen("4k4/9/9/9/9/4p4/9/C8/9/9 b - - 0 1").unwrap();
        let resolution = resolve_screenshot_move_from_board(
            &before,
            &unrelated,
            Some(link_vision::ScreenshotMoveMarker {
                from: Some(cannon.from),
                to: Some(cannon.to),
                from_confidence: 255,
                to_confidence: 510,
            }),
            BoardOrientation::BlackAtBottom,
        )
        .unwrap();

        assert_eq!(resolution.status, "noExactMatch");
        assert!(resolution.candidates.is_empty());
        assert_eq!(resolution.orientation, BoardOrientation::BlackAtBottom);
        assert!(
            resolution
                .reason
                .as_deref()
                .unwrap()
                .contains("不能单独推断走法")
        );
    }

    #[test]
    fn image_recognition_error_invalidates_an_old_screenshot_confirmation() {
        let mut session = LinkSession::default();
        session.source = CaptureSource::ImageImport;
        session.capture_generation = 17;
        session.latest_fen = Some("old-post-move-fen".into());
        session.screenshot_move_marker = Some(link_vision::ScreenshotMoveMarker {
            from: Some(Square { row: 9, col: 1 }),
            to: Some(Square { row: 7, col: 2 }),
            from_confidence: 255,
            to_confidence: 510,
        });
        session.screenshot_resolution_before_fen = Some("old-parent-fen".into());
        session.screenshot_resolution_generation = Some(17);
        session.screenshot_resolution_mode = Some(ScreenshotResolutionMode::ExactPlacement);

        apply_link_capture_error(&mut session, 17, "图片未识别到完整棋盘".into());

        assert_eq!(session.state, LinkSessionState::NeedsManualCorrection);
        assert!(session.latest_fen.is_none());
        assert!(session.screenshot_move_marker.is_none());
        assert!(session.screenshot_resolution_before_fen.is_none());
        assert!(session.screenshot_resolution_generation.is_none());
        assert!(session.screenshot_resolution_mode.is_none());
        assert!(session.screenshot_resolution_game_id.is_none());
        assert!(session.screenshot_resolution_current_node.is_none());
        assert!(session.screenshot_resolution_allowed_moves.is_empty());
    }

    #[test]
    fn screenshot_resolution_binding_rejects_a_same_fen_different_game_or_node() {
        let mut state = desktop_state_for_link_tests();
        let model = state.model.get_mut().unwrap();
        let before_fen = model.board.to_fen();
        let binding = ScreenshotResolutionBinding {
            recognized_after_fen: None,
            before_fen,
            generation: 1,
            mode: ScreenshotResolutionMode::ManualFallback,
            game_id: model.game_id,
            current_node: None,
            allowed_moves: vec!["b2b9".into()],
        };

        validate_screenshot_resolution_binding(model, &binding)
            .expect("the original game root remains valid");

        model.current_node = Some(Uuid::new_v4());
        let node_error = validate_screenshot_resolution_binding(model, &binding).unwrap_err();
        assert!(node_error.contains("棋谱或节点已变化"));

        model.current_node = None;
        model.game_id = Uuid::new_v4();
        let game_error = validate_screenshot_resolution_binding(model, &binding).unwrap_err();
        assert!(game_error.contains("棋谱或节点已变化"));
    }

    #[test]
    fn screenshot_resolution_only_confirms_the_resolved_or_previewed_move() {
        let binding = ScreenshotResolutionBinding {
            recognized_after_fen: None,
            before_fen: STARTING_FEN.into(),
            generation: 1,
            mode: ScreenshotResolutionMode::ManualFallback,
            game_id: Uuid::new_v4(),
            current_node: None,
            allowed_moves: vec!["b2b9".into()],
        };

        validate_screenshot_resolution_move(&binding, "b2b9").unwrap();
        let error = validate_screenshot_resolution_move(&binding, "h2h9").unwrap_err();
        assert!(error.contains("合法候选"));
    }

    #[test]
    fn consuming_a_screenshot_resolution_rejects_a_second_confirmation() {
        let mut session = LinkSession::default();
        session.source = CaptureSource::ImageImport;
        session.latest_fen = Some(STARTING_FEN.into());
        session.screenshot_resolution_before_fen = Some(STARTING_FEN.into());
        session.screenshot_resolution_generation = Some(4);
        session.screenshot_resolution_mode = Some(ScreenshotResolutionMode::ManualFallback);
        session.screenshot_resolution_game_id = Some(Uuid::new_v4());
        session.screenshot_resolution_current_node = Some(None);
        session.screenshot_resolution_allowed_moves = vec!["b2b9".into()];

        active_screenshot_resolution(&session).expect("first confirmation is available");
        invalidate_screenshot_move_resolution(&mut session);
        let error = active_screenshot_resolution(&session).unwrap_err();
        assert!(error.contains("已失效"));
    }

    #[test]
    fn screenshot_resolution_matches_a_capture_from_the_complete_yolo_position() {
        let before = Board::from_fen("4k4/9/9/9/9/4p4/9/9/4R4/4K4 w - - 0 1").unwrap();
        let capture = Move::from_iccs("e1e4").unwrap();
        assert!(before.legal_moves().contains(&capture));
        let recognized_after = before.apply_move(capture).unwrap();

        let resolution = resolve_screenshot_move_from_board(
            &before,
            &recognized_after,
            None,
            BoardOrientation::RedAtBottom,
        )
        .unwrap();

        assert_eq!(resolution.status, "unique");
        assert_eq!(resolution.candidates.len(), 1);
        assert_eq!(resolution.candidates[0].step.notation, "车五进三");
        assert!(resolution.candidates[0].captured);
        assert_eq!(resolution.candidates[0].side_to_move, "黑方");
    }

    #[test]
    fn exact_screenshot_confirmation_rejects_another_legal_move() {
        let before = Board::from_fen("4k4/9/9/9/9/4p4/9/C8/9/1N2K4 w - - 0 1").unwrap();
        let horse = Move::from_iccs("b0c2").unwrap();
        let cannon = Move::from_iccs("a2a0").unwrap();
        let recognized_after = before.apply_move(horse).unwrap();

        let error = validate_screenshot_move_confirmation(
            &before,
            cannon,
            &before.to_fen(),
            Some(&recognized_after.to_fen()),
            ScreenshotResolutionMode::ExactPlacement,
        )
        .unwrap_err();

        assert!(error.contains("完整局面不一致"));
        validate_screenshot_move_confirmation(
            &before,
            horse,
            &before.to_fen(),
            Some(&recognized_after.to_fen()),
            ScreenshotResolutionMode::ExactPlacement,
        )
        .unwrap();
    }

    #[test]
    fn manual_screenshot_confirmation_requires_the_original_document_node() {
        let before = Board::from_fen("4k4/9/9/9/9/4p4/9/C8/9/1N2K4 w - - 0 1").unwrap();
        let horse = Move::from_iccs("b0c2").unwrap();
        let moved = before.apply_move(horse).unwrap();

        let error = validate_screenshot_move_confirmation(
            &moved,
            moved.legal_moves()[0],
            &before.to_fen(),
            None,
            ScreenshotResolutionMode::ManualFallback,
        )
        .unwrap_err();

        assert!(error.contains("当前棋谱节点已变化"));
    }

    #[test]
    fn link_capture_timeout_stops_silent_first_frame_session() {
        let mut session = LinkSession::default();
        session.source = CaptureSource::WindowLink;
        session.state = LinkSessionState::ClassifyingSquares;
        session.capture_running = true;
        session.started_at = Some(Utc::now() - chrono::Duration::seconds(13));
        session.last_heartbeat_at = Some(Utc::now() - chrono::Duration::seconds(9));
        session.phase = Some("load_model".into());

        apply_link_capture_timeout(&mut session);

        assert_eq!(session.state, LinkSessionState::NeedsManualCorrection);
        assert!(!session.capture_running);
        assert_eq!(session.phase.as_deref(), Some("timeout"));
        assert!(session.reason.as_deref().unwrap().contains("12 秒"));
    }

    #[cfg(not(target_os = "windows"))]
    #[test]
    fn link_region_selection_failure_is_visible_in_status() {
        let mut session = LinkSession::default();
        session.source = CaptureSource::WindowLink;
        session.state = LinkSessionState::Calibrating;
        session.capture_running = true;
        session.capture_generation = 9;
        session.phase = Some("selecting_region".into());

        apply_link_region_selection_failure(
            &mut session,
            9,
            "region_selection_cancelled",
            "已取消棋盘区域框选；可重新启动连线或重新框选。".into(),
        );

        assert_eq!(session.state, LinkSessionState::NeedsManualCorrection);
        assert!(!session.capture_running);
        assert_eq!(session.phase.as_deref(), Some("region_selection_cancelled"));
        assert_eq!(session.last_error, session.reason);
        assert!(session.reason.as_deref().unwrap().contains("重新启动连线"));
    }

    #[test]
    fn window_link_start_initializes_non_blocking_selection_state() {
        let mut session = LinkSession::default();
        session.manual_turn_override = Some(Color::Black);
        let request = StartLinkSessionRequest {
            source: CaptureSource::WindowLink,
            recognition_mode: RecognitionMode::YoloBoard,
            mode: LinkMode::AutoPlay,
            stable_frames: 1,
            auto_side: Some("red".into()),
            target_window_id: None,
        };
        let policy = CapturePolicy::for_source(request.source);

        initialize_link_session_for_request(&mut session, &request, 12, 0.55, policy);

        assert_eq!(session.state, LinkSessionState::Calibrating);
        assert_eq!(session.phase.as_deref(), Some("selecting_region"));
        assert!(!session.capture_running);
        assert_eq!(session.capture_generation, 12);
        assert_eq!(session.gate.required_frames(), 2);
        assert_eq!(session.manual_turn_override, None);
        assert!(session.reason.as_deref().unwrap().contains("等待框选"));
    }

    #[test]
    fn manual_turn_override_is_exposed_and_takes_precedence_over_auto_indicator() {
        let auto = link_vision::TurnIndicator {
            side: Color::Red,
            slot: link_vision::TurnIndicatorSlot::RightPlayer,
            confidence: 0.9,
            detail: "轮走识别：右侧头像高亮 → 红方行棋".into(),
        };

        let message = link_turn_indicator_message(Some(Color::Black), Some(&auto));

        assert!(message.contains("手动模式已开启"));
        assert!(message.contains("已忽略"));
        assert!(message.contains("右侧头像高亮"));

        let mut session = LinkSession::default();
        session.manual_turn_override = Some(Color::Black);
        session.turn_indicator = Some(message);
        let dto = link_status_dto(&session);

        assert_eq!(dto.manual_turn_override.as_deref(), Some("black"));
        assert!(dto.turn_indicator.as_deref().unwrap().contains("手动模式"));
    }

    #[test]
    fn link_board_preview_crops_detected_board_instead_of_full_capture() {
        let mut image = image::RgbaImage::new(300, 200);
        for y in 0..200 {
            for x in 0..300 {
                let color = if x < 90 {
                    image::Rgba([210, 210, 210, 255])
                } else {
                    image::Rgba([180, 130, 70, 255])
                };
                image.put_pixel(x, y, color);
            }
        }
        let mut source = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut source, image::ImageFormat::Png)
            .unwrap();

        let cropped =
            crop_png_by_bounds(source.get_ref(), (100.0, 40.0, 120.0, 120.0), 0.0).unwrap();
        let cropped = image::load_from_memory(&cropped).unwrap().to_rgba8();

        assert_eq!((cropped.width(), cropped.height()), (128, 128));
        assert_eq!(cropped.get_pixel(0, 0), &image::Rgba([180, 130, 70, 255]));
    }

    #[test]
    fn link_region_crop_uses_selector_ratios_instead_of_screen_coordinates() {
        let mut image = image::RgbaImage::new(200, 100);
        for y in 0..100 {
            for x in 0..200 {
                let color = if x < 100 {
                    image::Rgba([220, 20, 20, 255])
                } else {
                    image::Rgba([20, 180, 60, 255])
                };
                image.put_pixel(x, y, color);
            }
        }
        let mut source = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(image)
            .write_to(&mut source, image::ImageFormat::Png)
            .unwrap();
        let region = LinkCaptureRegion {
            x: 900,
            y: 500,
            width: 100,
            height: 100,
            selection_x: 100.0,
            selection_y: 0.0,
            selection_width: 100.0,
            selection_height: 100.0,
            selector_width: 200.0,
            selector_height: 100.0,
        };

        let cropped = crop_link_capture_frame(source.get_ref(), region).unwrap();
        let cropped = image::load_from_memory(&cropped).unwrap().to_rgba8();

        assert_eq!((cropped.width(), cropped.height()), (100, 100));
        assert_eq!(cropped.get_pixel(0, 0), &image::Rgba([20, 180, 60, 255]));
    }

    #[test]
    fn window_link_expands_tracking_region_without_leaving_selector() {
        let region = LinkCaptureRegion {
            x: 300,
            y: 220,
            width: 360,
            height: 360,
            selection_x: 300.0,
            selection_y: 220.0,
            selection_width: 360.0,
            selection_height: 360.0,
            selector_width: 1000.0,
            selector_height: 800.0,
        };

        let expanded = expand_link_capture_region(region);

        assert!(expanded.selection_x < region.selection_x);
        assert!(expanded.selection_y < region.selection_y);
        assert!(expanded.selection_width > region.selection_width);
        assert!(expanded.selection_height > region.selection_height);
        assert!(expanded.selection_x >= 0.0);
        assert!(expanded.selection_y >= 0.0);
        assert!(expanded.selection_x + expanded.selection_width <= expanded.selector_width + 0.01);
        assert!(
            expanded.selection_y + expanded.selection_height <= expanded.selector_height + 0.01
        );
    }

    #[test]
    fn link_floating_panel_overlap_guard_ignores_expanded_capture_margin() {
        let region = LinkCaptureRegion {
            x: 300,
            y: 220,
            width: 360,
            height: 360,
            selection_x: 300.0,
            selection_y: 220.0,
            selection_width: 360.0,
            selection_height: 360.0,
            selector_width: 1200.0,
            selector_height: 900.0,
        };

        let expanded = expand_link_capture_region(region);
        let guard = link_capture_guard_region(region);
        let floating_panel_on_capture_margin =
            (expanded.x as f64 + 8.0, region.y as f64 + 24.0, 56.0, 180.0);

        assert!(rects_intersect(
            floating_panel_on_capture_margin,
            link_region_rect(expanded)
        ));
        assert!(!rects_intersect(
            floating_panel_on_capture_margin,
            link_region_rect(guard)
        ));
    }

    #[test]
    fn link_capture_uses_original_region_when_expanded_margin_is_polluted() {
        let region = LinkCaptureRegion {
            x: 300,
            y: 220,
            width: 360,
            height: 360,
            selection_x: 300.0,
            selection_y: 220.0,
            selection_width: 360.0,
            selection_height: 360.0,
            selector_width: 1200.0,
            selector_height: 900.0,
        };

        assert_eq!(
            select_link_capture_frame_region(Some(region), true),
            Some(region)
        );
        assert_eq!(
            select_link_capture_frame_region(Some(region), false),
            Some(expand_link_capture_region(region))
        );
    }

    #[test]
    fn window_link_recenters_tracking_region_from_detected_board_bounds() {
        let search_region = LinkCaptureRegion {
            x: 100,
            y: 80,
            width: 800,
            height: 640,
            selection_x: 100.0,
            selection_y: 80.0,
            selection_width: 800.0,
            selection_height: 640.0,
            selector_width: 1200.0,
            selector_height: 900.0,
        };

        let next = link_region_around_board_bounds(search_region, (380.0, 260.0, 420.0, 420.0));

        assert!(next.x < 380);
        assert!(next.y < 260);
        assert!(next.x + next.width > 800);
        assert!(next.y + next.height > 680);
        assert!(next.width < search_region.width);
        assert!(next.height < search_region.height);
    }

    #[test]
    fn link_capture_bounds_convert_retina_pixels_back_to_screen_points() {
        let region = LinkCaptureRegion {
            x: 500,
            y: 300,
            width: 200,
            height: 100,
            selection_x: 500.0,
            selection_y: 300.0,
            selection_width: 200.0,
            selection_height: 100.0,
            selector_width: 1000.0,
            selector_height: 600.0,
        };

        let bounds =
            map_capture_bounds_to_screen((20.0, 10.0, 160.0, 80.0), region, Some((400, 200)));

        assert_eq!(bounds, (510.0, 305.0, 80.0, 40.0));
    }

    #[test]
    fn link_capture_signature_rejects_a_changed_board_frame() {
        let make_frame = |piece_color: [u8; 4]| {
            let mut image = image::RgbaImage::from_pixel(32, 32, image::Rgba([210, 180, 140, 255]));
            image.put_pixel(16, 16, image::Rgba(piece_color));
            let mut png = Vec::new();
            image::DynamicImage::ImageRgba8(image)
                .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
                .unwrap();
            png
        };
        let bounds = (0.0, 0.0, 32.0, 32.0);
        let stable = make_frame([210, 0, 0, 255]);
        let changed = make_frame([0, 0, 0, 255]);

        assert_eq!(
            link_capture_board_signature(&stable, bounds).unwrap(),
            link_capture_board_signature(&stable, bounds).unwrap()
        );
        assert_ne!(
            link_capture_board_signature(&stable, bounds).unwrap(),
            link_capture_board_signature(&changed, bounds).unwrap()
        );
    }

    #[test]
    fn link_engine_click_points_follow_arrow_one_iccs_move() {
        let mv = Move::from_iccs("b2c2").unwrap();
        let bounds = (100.0, 200.0, 400.0, 450.0);

        let points = link_move_click_points(bounds, link_core::BoardOrientation::RedAtBottom, mv);

        assert_eq!(points.0, (150.0, 550.0));
        assert_eq!(points.1, (200.0, 550.0));
    }

    #[test]
    fn link_engine_click_points_flip_for_black_bottom_board() {
        let mv = Move::from_iccs("b2c2").unwrap();
        let bounds = (100.0, 200.0, 400.0, 450.0);

        let points = link_move_click_points(bounds, link_core::BoardOrientation::BlackAtBottom, mv);

        assert_eq!(points.0, (450.0, 300.0));
        assert_eq!(points.1, (400.0, 300.0));
    }

    #[test]
    fn link_engine_click_uses_detected_piece_center_for_start_square() {
        let mv = Move::from_iccs("b2c2").unwrap();
        let bounds = (100.0, 200.0, 400.0, 450.0);
        let detected = LinkPieceClickCenter {
            square: mv.from,
            x: 153.0,
            y: 556.0,
            confidence: 0.91,
        };

        let points = link_move_click_points_for_click(
            bounds,
            link_core::BoardOrientation::RedAtBottom,
            mv,
            Some(detected),
        );

        assert_eq!(points.0, (153.0, 556.0));
        assert_eq!(points.1, (200.0, 550.0));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn confirm_click_script_selects_only_the_start_piece() {
        let script = macos_link_click_script(153.0, 556.0, 200.0, 550.0, false);

        assert!(script.contains("click at {153, 556}"));
        assert!(!script.contains("click at {200, 550}"));
        assert!(script.contains("set frontmost of proc to true"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn auto_play_click_script_clicks_the_target_square() {
        let script = macos_link_click_script(153.0, 556.0, 200.0, 550.0, true);

        assert!(script.contains("click at {153, 556}"));
        assert!(script.contains("click at {200, 550}"));
    }

    #[test]
    fn link_piece_click_centers_map_retina_frame_to_screen_points() {
        let region = LinkCaptureRegion {
            x: 100,
            y: 200,
            width: 400,
            height: 400,
            selection_x: 100.0,
            selection_y: 200.0,
            selection_width: 400.0,
            selection_height: 400.0,
            selector_width: 1200.0,
            selector_height: 900.0,
        };
        let board = link_vision::Detection {
            label: '0',
            confidence: 0.99,
            alternatives: vec![('0', 0.99)],
            center_x: 400.0,
            center_y: 420.0,
            width: 640.0,
            height: 720.0,
        };
        let red_cannon = link_vision::Detection {
            label: 'C',
            confidence: 0.9,
            alternatives: vec![('C', 0.9)],
            center_x: 166.0,
            center_y: 618.0,
            width: 48.0,
            height: 48.0,
        };

        let centers = link_piece_click_centers(
            &[board.clone(), red_cannon],
            link_vision::board_bounds(&[board]).unwrap(),
            link_core::BoardOrientation::RedAtBottom,
            Some(region),
            Some((800, 800)),
        );

        let center = centers
            .iter()
            .find(|center| center.square == (Square { row: 7, col: 1 }))
            .expect("red cannon center");
        assert_eq!((center.x.round(), center.y.round()), (183.0, 509.0));
    }

    #[test]
    fn link_status_dto_exposes_capture_diagnostics() {
        let mut session = LinkSession::default();
        session.reason = Some("框选预览未识别到可同步棋盘".into());
        session.phase = Some("waiting_recognition".into());
        session.last_error = Some("模型推理异常".into());
        session.started_at = Some(Utc::now());
        session.last_heartbeat_at = Some(Utc::now());
        session.recognition_attempts = 2;
        session.board_orientation = BoardOrientation::BlackAtBottom;
        session.last_detection_summary =
            Some("框选预览检测：棋盘框 1 个，棋子 20 个，平均置信度 82%".into());
        session.last_move_detail = Some(LinkMoveDetailDto {
            iccs: "h2e2".into(),
            notation: "炮二平五".into(),
            moved_by: "红方",
            from: SquareDto { row: 7, col: 7 },
            to: SquareDto { row: 7, col: 4 },
        });

        let dto = link_status_dto(&session);

        assert_eq!(dto.phase.as_deref(), Some("waiting_recognition"));
        assert_eq!(dto.last_error.as_deref(), Some("模型推理异常"));
        assert_eq!(dto.recognition_attempts, 2);
        assert_eq!(dto.board_orientation, BoardOrientation::BlackAtBottom);
        assert_eq!(dto.last_move_detail.as_ref().unwrap().notation, "炮二平五");
        assert!(dto.started_at.is_some());
        assert!(dto.last_heartbeat_at.is_some());
        assert!(
            dto.last_detection_summary
                .as_deref()
                .unwrap()
                .contains("棋子 20 个")
        );
    }

    #[test]
    fn link_recognition_accepts_tiantian_style_sixty_one_percent_confidence() {
        let state = desktop_state_for_link_tests();
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.state = LinkSessionState::ClassifyingSquares;
            session.capture_running = true;
            session.capture_generation = 3;
            session.confidence_threshold = 0.55;
        }

        let observation =
            observe_link_recognition_inner(&state, STARTING_FEN.into(), Some(0.61), Some(3))
                .unwrap();
        let session = state.link_session.lock().unwrap();

        assert_eq!(observation.state, LinkSessionState::Tracking);
        assert_eq!(session.state, LinkSessionState::Tracking);
        assert!(session.capture_running);
        assert_eq!(session.confidence, Some(0.61));
    }

    #[test]
    fn window_link_apply_move_exposes_last_move_detail_for_mini_board() {
        let state = desktop_state_for_link_tests();
        let next_fen = Board::from_fen(STARTING_FEN)
            .unwrap()
            .apply_move(Move::from_iccs("h2e2").unwrap())
            .unwrap()
            .to_fen();
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.state = LinkSessionState::ClassifyingSquares;
            session.capture_running = true;
            session.initial_position_seen = true;
            session.capture_generation = 6;
            session.confidence_threshold = 0.55;
        }

        let observation =
            observe_link_recognition_inner(&state, next_fen, Some(0.91), Some(6)).unwrap();
        let session = state.link_session.lock().unwrap();
        let detail = session.last_move_detail.as_ref().unwrap();

        assert!(observation.accepted);
        assert_eq!(session.phase.as_deref(), Some("move_synced"));
        assert_eq!(session.last_move.as_deref(), Some("h2e2"));
        assert_eq!(detail.iccs, "h2e2");
        assert_eq!(detail.moved_by, "红方");
        assert_eq!(detail.notation, "炮二平五");
        assert_eq!((detail.from.row, detail.from.col), (7, 7));
        assert_eq!((detail.to.row, detail.to.col), (7, 4));
    }

    #[test]
    fn pending_confirmed_link_move_ignores_turn_indicator_flicker() {
        let state = desktop_state_for_link_tests();
        let flicker_fen = STARTING_FEN.replacen(" w ", " b ", 1);
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.mode = LinkMode::ConfirmPlay;
            session.state = LinkSessionState::Tracking;
            session.capture_running = true;
            session.initial_position_seen = true;
            session.capture_generation = 7;
            session.pending_external_move = Some("g6g5".into());
            session.pending_expected_fen = Some("expected".into());
            session.confidence_threshold = 0.55;
        }

        let observation =
            observe_link_recognition_inner(&state, flicker_fen, Some(0.91), Some(7)).unwrap();
        let session = state.link_session.lock().unwrap();
        let model = state.model.lock().unwrap();

        assert!(!observation.accepted);
        assert!(observation.board.is_none());
        assert_eq!(session.pending_external_move.as_deref(), Some("g6g5"));
        assert!(
            session
                .reason
                .as_deref()
                .unwrap()
                .contains("等待网页棋盘完成走子")
        );
        assert!(model.board.to_fen().contains(" w "));
    }

    #[test]
    fn unstable_live_side_flicker_keeps_the_last_stable_board() {
        let state = desktop_state_for_link_tests();
        let flicker_fen = STARTING_FEN.replacen(" w ", " b ", 1);
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.state = LinkSessionState::Tracking;
            session.capture_running = true;
            session.initial_position_seen = true;
            session.latest_fen = Some(STARTING_FEN.into());
            session.capture_generation = 8;
            session.confidence_threshold = 0.55;
            session.gate = StabilityGate::new(2);
            reset_link_stability_progress(&mut session);
        }

        let observation =
            observe_link_recognition_inner(&state, flicker_fen, Some(0.91), Some(8)).unwrap();
        let session = state.link_session.lock().unwrap();
        let model = state.model.lock().unwrap();

        assert!(!observation.accepted);
        assert!(observation.board.is_none());
        assert_eq!(observation.state, LinkSessionState::WaitingStableFrames);
        assert_eq!(session.latest_fen.as_deref(), Some(STARTING_FEN));
        assert_eq!(session.stable_frames, 1);
        assert_eq!(session.required_stable_frames, 2);
        assert!(model.board.to_fen().contains(" w "));
    }

    #[test]
    fn side_flicker_waits_even_when_position_gate_is_already_stable() {
        let state = desktop_state_for_link_tests();
        let flicker_fen = STARTING_FEN.replacen(" w ", " b ", 1);
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.state = LinkSessionState::Tracking;
            session.capture_running = true;
            session.initial_position_seen = true;
            session.latest_fen = Some(STARTING_FEN.into());
            session.capture_generation = 10;
            session.confidence_threshold = 0.55;
            session.gate = StabilityGate::new(2);
            for _ in 0..6 {
                let _ = session.gate.observe(&flicker_fen).unwrap();
            }
            mark_link_stability_accepted(&mut session);
        }

        let observation =
            observe_link_recognition_inner(&state, flicker_fen, Some(0.91), Some(10)).unwrap();
        let session = state.link_session.lock().unwrap();
        let model = state.model.lock().unwrap();

        assert!(!observation.accepted);
        assert!(observation.board.is_none());
        assert_eq!(observation.state, LinkSessionState::WaitingStableFrames);
        assert_eq!(session.phase.as_deref(), Some("waiting_side_stability"));
        assert_eq!(session.stable_frames, 1);
        assert_eq!(session.required_stable_frames, 4);
        assert_eq!(session.latest_fen.as_deref(), Some(STARTING_FEN));
        assert!(model.board.to_fen().contains(" w "));
    }

    #[test]
    fn live_side_change_requires_extra_stability_before_updating_turn() {
        let state = desktop_state_for_link_tests();
        let black_to_move_fen = STARTING_FEN.replacen(" w ", " b ", 1);
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.state = LinkSessionState::Tracking;
            session.capture_running = true;
            session.initial_position_seen = true;
            session.latest_fen = Some(STARTING_FEN.into());
            session.capture_generation = 9;
            session.confidence_threshold = 0.55;
            session.gate = StabilityGate::new(2);
            reset_link_stability_progress(&mut session);
        }

        for _ in 0..4 {
            let observation = observe_link_recognition_inner(
                &state,
                black_to_move_fen.clone(),
                Some(0.91),
                Some(9),
            )
            .unwrap();
            assert!(!observation.accepted);
        }
        {
            let session = state.link_session.lock().unwrap();
            let model = state.model.lock().unwrap();
            assert_eq!(session.phase.as_deref(), Some("waiting_side_stability"));
            assert_eq!(session.latest_fen.as_deref(), Some(STARTING_FEN));
            assert_eq!(session.stable_frames, 3);
            assert_eq!(session.required_stable_frames, 4);
            assert!(model.board.to_fen().contains(" w "));
        }

        let observation =
            observe_link_recognition_inner(&state, black_to_move_fen, Some(0.91), Some(9)).unwrap();
        let session = state.link_session.lock().unwrap();
        let model = state.model.lock().unwrap();

        assert!(observation.accepted);
        assert_eq!(session.state, LinkSessionState::Tracking);
        assert!(session.latest_fen.as_deref().unwrap().contains(" b "));
        assert!(model.board.to_fen().contains(" b "));
    }

    #[test]
    fn window_link_syncs_legal_web_manual_position_jumps() {
        let state = desktop_state_for_link_tests();
        let mut jumped = Board::from_fen(STARTING_FEN).unwrap();
        jumped = jumped
            .apply_move(xiangqi_core::Move::from_iccs("h2e2").unwrap())
            .unwrap();
        jumped = jumped
            .apply_move(xiangqi_core::Move::from_iccs("h9g7").unwrap())
            .unwrap();
        let jumped_fen = jumped.to_fen();
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.state = LinkSessionState::Tracking;
            session.capture_running = true;
            session.initial_position_seen = true;
            session.capture_generation = 5;
            session.confidence_threshold = 0.55;
        }

        for _ in 0..4 {
            let observation =
                observe_link_recognition_inner(&state, jumped_fen.clone(), Some(0.88), Some(5))
                    .unwrap();
            assert!(!observation.accepted);
            assert_eq!(observation.state, LinkSessionState::WaitingStableFrames);
        }
        let observation =
            observe_link_recognition_inner(&state, jumped_fen.clone(), Some(0.88), Some(5))
                .unwrap();
        let session = state.link_session.lock().unwrap();
        let model = state.model.lock().unwrap();

        assert_eq!(observation.state, LinkSessionState::Tracking);
        assert!(observation.accepted);
        assert_eq!(observation.board.as_ref().unwrap().fen, jumped_fen);
        assert_eq!(model.board.to_fen(), jumped_fen);
        assert_eq!(session.latest_fen.as_deref(), Some(jumped_fen.as_str()));
        assert_eq!(session.phase.as_deref(), Some("position_jump_synced"));
        assert!(session.last_move_detail.is_none());
        assert!(session.reason.as_deref().unwrap().contains("网页棋谱跳转"));
    }

    #[test]
    fn low_confidence_link_recognition_warns_without_stopping_capture() {
        let state = desktop_state_for_link_tests();
        {
            let mut session = state.link_session.lock().unwrap();
            session.source = CaptureSource::WindowLink;
            session.state = LinkSessionState::ClassifyingSquares;
            session.capture_running = true;
            session.capture_generation = 4;
            session.confidence_threshold = 0.70;
        }

        let observation =
            observe_link_recognition_inner(&state, STARTING_FEN.into(), Some(0.61), Some(4))
                .unwrap();
        let session = state.link_session.lock().unwrap();

        assert_eq!(observation.state, LinkSessionState::ClassifyingSquares);
        assert_eq!(session.phase.as_deref(), Some("low_confidence"));
        assert!(session.capture_running);
        assert!(session.reason.as_deref().unwrap().contains("继续采集中"));
    }

    #[test]
    fn link_vision_candidates_cover_tauri_bundle_resource_layout() {
        let base = PathBuf::from("/Applications/Xiangqi Studio.app/Contents/Resources");
        let candidates = link_vision_candidates(&base);
        assert!(candidates.contains(&base.join("link-vision/yolov11.onnx")));
        assert!(candidates.contains(&base.join("resources/link-vision/yolov11.onnx")));
    }

    #[test]
    fn link_vision_candidates_cover_development_resource_layout() {
        let resource_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let candidates = link_vision_candidates(&resource_dir);
        assert!(candidates.contains(&resource_dir.join("link-vision/yolov11.onnx")));
        assert!(resource_dir.join("link-vision/yolov11.onnx").is_file());
    }

    #[test]
    fn master_style_seed_candidates_cover_development_resource_layout() {
        let resource_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources");
        let candidates = master_style_seed_candidates(&resource_dir);
        assert!(candidates.contains(&resource_dir.join("master-style")));
        assert!(
            resource_dir
                .join("master-style/seed-manifest.json")
                .is_file()
        );
    }

    #[test]
    fn bundled_master_style_seed_files_parse_into_four_profiles() {
        let seed_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/master-style");
        let imports = imported_master_style_profiles_from_files(
            &seed_dir.join("master-style-profiles.json"),
            &seed_dir.join("master-style-samples.jsonl"),
            &seed_dir.join("master-style-analysis.jsonl"),
        )
        .unwrap();
        let players = imports
            .iter()
            .map(|(profile, _)| profile.player_name.as_str())
            .collect::<std::collections::HashSet<_>>();
        let sample_count: usize = imports.iter().map(|(_, samples)| samples.len()).sum();
        assert_eq!(imports.len(), 4);
        assert!(players.contains("赵鑫鑫"));
        assert!(players.contains("许银川"));
        assert!(players.contains("王天一"));
        assert!(players.contains("郑惟桐"));
        assert_eq!(sample_count, 12_000);
    }

    #[test]
    fn board_dto_formats_history_and_attaches_saved_scores() {
        let mut board = Board::from_fen(STARTING_FEN).unwrap();
        let mut tree = ManualTree::new();
        let first_move = xiangqi_core::Move::from_iccs("h2e2").unwrap();
        let first = tree.add_move(tree.root_id(), first_move, "").unwrap();
        board = board.apply_move(first_move).unwrap();
        let second_move = xiangqi_core::Move::from_iccs("h9g7").unwrap();
        let second = tree.add_move(first, second_move, "").unwrap();
        board = board.apply_move(second_move).unwrap();
        let game_id = Uuid::new_v4();
        let mut store = LocalStore::open_in_memory().unwrap();
        store
            .save_analysis(
                game_id,
                Some(first),
                "/engine",
                "depth:12",
                Some(12),
                Some(42),
                None,
                "[]",
                10,
            )
            .unwrap();
        let model = AppModel {
            board,
            starting_fen: STARTING_FEN.into(),
            tree,
            current_node: Some(second),
            game_id,
            device_id: Uuid::new_v4(),
            lamport: 0,
            store,
            metadata: ManualMetadata {
                title: "测试棋谱".into(),
                result: "*".into(),
                ..ManualMetadata::default()
            },
            note: "关键局面".into(),
            source_path: Some("/tmp/study.pgn".into()),
            source_format: Some("pgn".into()),
            playable: true,
        };

        let dto = board_dto(&model).unwrap();
        assert_eq!(dto.history[0].notation, "炮二平五");
        assert_eq!(dto.history[0].moved_by, "红方");
        assert_eq!(dto.history[0].score_cp, Some(42));
        assert_eq!(dto.history[1].notation, "马8进7");
        assert_eq!(dto.history[1].moved_by, "黑方");
        assert_eq!(dto.history[1].score_cp, None);
        assert_eq!(dto.title, "测试棋谱");
        assert_eq!(dto.note, "关键局面");
        assert_eq!(dto.source_path.as_deref(), Some("/tmp/study.pgn"));
        assert_eq!(dto.source_format.as_deref(), Some("pgn"));
        assert!(dto.playable);
        assert_eq!(dto.rule_name, xiangqi_core::DOMESTIC_RULE_NAME);
        assert_eq!(dto.rule_verdict, "ongoing");
        assert!(dto.rule_reason.contains("2020版导向"));
    }

    #[test]
    fn arena_rule_outcome_maps_domestic_rule_verdicts() {
        let red = EngineArenaPlayerDto {
            name: "红引擎".into(),
            engine_path: BUILTIN_ENGINE_PATH.into(),
        };
        let black = EngineArenaPlayerDto {
            name: "黑引擎".into(),
            engine_path: "/engines/external-fairy-stockfish".into(),
        };

        assert_eq!(
            arena_rule_outcome(
                RuleVerdict::LossByPerpetualCheck { loser: Color::Red },
                RuleMode::Domestic2020,
                &red,
                &black
            ),
            Some((
                "0-1".into(),
                Some("黑引擎".into()),
                "红方单方长将，按国内中国象棋规则（2020版导向）判负".into()
            ))
        );
        assert_eq!(
            arena_rule_outcome(
                RuleVerdict::PendingRepetition,
                RuleMode::Domestic2020,
                &red,
                &black
            ),
            Some((
                "1/2-1/2".into(),
                None,
                "重复待判局面；擂台 MVP 未细分长杀/长捉，按和棋计".into()
            ))
        );
        assert_eq!(
            arena_rule_outcome(
                RuleVerdict::DrawByRepetitionMvp,
                RuleMode::AsianAxf,
                &red,
                &black
            ),
            Some((
                "1/2-1/2".into(),
                None,
                "重复局面双方不变，按亚洲规则 MVP 判和".into()
            ))
        );
        assert_eq!(
            arena_rule_outcome(
                RuleVerdict::PendingAsianRepetition,
                RuleMode::AsianAxf,
                &red,
                &black
            ),
            Some((
                "1/2-1/2".into(),
                None,
                "亚洲规则复杂待判，MVP 按和棋计".into()
            ))
        );
    }

    #[test]
    fn board_dto_keeps_mainline_continuation_after_navigating_to_an_old_node() {
        let mut tree = ManualTree::new();
        let first_move = xiangqi_core::Move::from_iccs("h2e2").unwrap();
        let first = tree.add_move(tree.root_id(), first_move, "").unwrap();
        let second_move = xiangqi_core::Move::from_iccs("h9g7").unwrap();
        let second = tree.add_move(first, second_move, "").unwrap();
        let third_move = xiangqi_core::Move::from_iccs("c3c4").unwrap();
        let third = tree.add_move(second, third_move, "").unwrap();
        let board = Board::from_fen(STARTING_FEN)
            .unwrap()
            .apply_move(first_move)
            .unwrap();
        let model = AppModel {
            board,
            starting_fen: STARTING_FEN.into(),
            tree,
            current_node: Some(first),
            game_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            lamport: 0,
            store: LocalStore::open_in_memory().unwrap(),
            metadata: ManualMetadata::default(),
            note: String::new(),
            source_path: None,
            source_format: None,
            playable: true,
        };

        let dto = board_dto(&model).unwrap();

        assert_eq!(
            dto.history.iter().map(|item| item.id).collect::<Vec<_>>(),
            vec![first]
        );
        assert_eq!(
            dto.continuation
                .iter()
                .map(|item| item.id)
                .collect::<Vec<_>>(),
            vec![second, third]
        );
        assert_eq!(dto.continuation[0].notation, "马8进7");
        assert_eq!(dto.continuation[1].notation, "兵七进一");
    }

    #[test]
    fn preview_line_simulates_moves_without_model_state() {
        let steps =
            preview_line_steps(STARTING_FEN, &["h2e2".to_owned(), "h9g7".to_owned()]).unwrap();

        assert_eq!(steps.len(), 2);
        assert_eq!(steps[0].notation, "炮二平五");
        assert_eq!(steps[0].moved_by, "红方");
        assert_eq!(steps[0].from.row, 7);
        assert_eq!(steps[0].to.col, 4);
        assert_eq!(steps[0].status, "进行中");
        assert_eq!(steps[1].notation, "马8进7");
        assert_eq!(steps[1].moved_by, "黑方");
        assert!(
            steps[1]
                .pieces
                .iter()
                .any(|piece| piece.row == 2 && piece.col == 6 && piece.label == "马")
        );
    }

    #[test]
    fn preview_line_rejects_illegal_candidate_move() {
        let error = preview_line_steps(STARTING_FEN, &["h2e2".to_owned(), "h2e2".to_owned()])
            .err()
            .unwrap();

        assert!(error.contains("第 2 步非法"));
    }

    #[test]
    fn chinese_line_parser_resolves_sequential_chinese_notation() {
        let parsed = parse_chinese_line(
            STARTING_FEN.into(),
            vec!["炮二平五".into(), "马8进7".into()],
        )
        .unwrap();

        assert_eq!(parsed.moves, vec!["h2e2", "h9g7"]);
        assert_eq!(parsed.steps.len(), 2);
        assert_eq!(parsed.steps[0].notation, "炮二平五");
        assert_eq!(parsed.steps[1].notation, "马8进7");
    }

    #[test]
    fn book_game_53_trap_variation_replays_legally() {
        let detail: serde_json::Value =
            serde_json::from_str(include_str!("../resources/book-topics/game-53/detail.json"))
                .unwrap();
        let mainline = detail["mainline"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        let lesson = detail["lessonNodes"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["id"] == "trap-defense")
            .unwrap();
        let ply = lesson["ply"].as_u64().unwrap() as usize;
        let base = preview_line_steps(STARTING_FEN, &mainline[..ply])
            .unwrap()
            .pop()
            .unwrap();
        let variation = lesson["variationNotation"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_owned())
            .collect::<Vec<_>>();
        let parsed = parse_chinese_line(base.fen, variation).unwrap();

        assert_eq!(parsed.moves.len(), 12);
        assert_eq!(parsed.steps.last().unwrap().notation, "相三进五");
    }

    #[test]
    fn chinese_line_parser_reports_the_illegal_step_in_chinese() {
        let error = parse_chinese_line(
            STARTING_FEN.into(),
            vec!["炮二平五".into(), "车九退十".into()],
        )
        .err()
        .unwrap();

        assert!(error.contains("第 2 步"));
        assert!(error.contains("合法中文着法"));
    }

    #[test]
    fn only_legal_king_placements_are_playable() {
        assert!(position_is_playable(
            &Board::from_fen(STARTING_FEN).unwrap()
        ));
        assert!(!position_is_playable(
            &Board::from_fen("9/9/9/9/9/9/9/9/9/4K4 w - - 0 1").unwrap()
        ));
        assert!(!position_is_playable(
            &Board::from_fen("4k4/9/9/9/9/9/9/9/9/4K4 w - - 0 1").unwrap()
        ));
        assert!(!position_is_playable(
            &Board::from_fen("9/9/9/4k4/9/9/9/9/9/4K4 w - - 0 1").unwrap()
        ));
    }

    #[test]
    fn report_line_uses_selected_path_then_mainline_continuation() {
        let mut tree = ManualTree::new();
        let first = tree
            .add_move(
                tree.root_id(),
                xiangqi_core::Move::from_iccs("h2e2").unwrap(),
                "",
            )
            .unwrap();
        let reply = tree
            .add_move(first, xiangqi_core::Move::from_iccs("h9g7").unwrap(), "")
            .unwrap();
        let continuation = tree
            .add_move(reply, xiangqi_core::Move::from_iccs("h0g2").unwrap(), "")
            .unwrap();
        tree.add_move(first, xiangqi_core::Move::from_iccs("b9c7").unwrap(), "")
            .unwrap();

        let nodes = report_line_nodes(&tree, Some(first)).unwrap();
        assert_eq!(
            nodes.iter().map(|node| node.id).collect::<Vec<_>>(),
            vec![first, reply, continuation]
        );
        assert!(
            report_line_signature(&tree, Some(first))
                .unwrap()
                .starts_with(&tree.root_id().to_string())
        );
    }

    #[test]
    fn report_positions_include_root_chinese_moves_and_post_move_material() {
        let mut tree = ManualTree::new();
        let first = tree
            .add_move(
                tree.root_id(),
                xiangqi_core::Move::from_iccs("h2e2").unwrap(),
                "",
            )
            .unwrap();
        let second = tree
            .add_move(first, xiangqi_core::Move::from_iccs("h9g7").unwrap(), "")
            .unwrap();
        let model = AppModel {
            board: Board::from_fen(STARTING_FEN).unwrap(),
            starting_fen: STARTING_FEN.into(),
            tree,
            current_node: Some(second),
            game_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            lamport: 0,
            store: LocalStore::open_in_memory().unwrap(),
            metadata: ManualMetadata::default(),
            note: String::new(),
            source_path: None,
            source_format: None,
            playable: true,
        };

        let (_, positions) = report_positions(&model).unwrap();
        assert_eq!(positions.len(), 3);
        assert!(positions[0].move_.is_none());
        assert_eq!(positions[0].material, 5660);
        assert_eq!(positions[1].move_.as_ref().unwrap().notation, "炮二平五");
        assert_eq!(positions[2].move_.as_ref().unwrap().notation, "马8进7");
        assert_eq!(positions[2].side_to_move, "红方");
        assert_eq!(positions[2].phase, "opening");
    }

    #[test]
    fn report_phase_uses_the_starting_fen_move_number() {
        assert_eq!(fen_starting_ply(STARTING_FEN), 0);
        assert_eq!(fen_starting_ply("4k4/9/9/9/9/9/9/9/9/4K4 b - - 0 40"), 79);
        assert_eq!(report_phase(79, 5000), "middle");
        assert_eq!(report_phase(81, 5000), "endgame");
        assert_eq!(report_phase(0, 1000), "endgame");
    }

    #[test]
    fn terminal_report_positions_score_the_mated_side_as_losing() {
        let board = Board::from_fen("4k4/3RRR3/9/9/9/9/9/9/9/4K4 b - - 0 1").unwrap();
        assert_eq!(board.status(), GameStatus::Checkmate);
        assert_eq!(terminal_report_mate(&board), Some(-1));
    }

    #[test]
    fn report_engine_fingerprint_changes_with_engine_or_nnue_content() {
        let directory = tempfile::tempdir().unwrap();
        let engine = directory.path().join("pikafish");
        let nnue = directory.path().join("pikafish.nnue");
        std::fs::write(&engine, b"engine-one").unwrap();
        std::fs::write(&nnue, b"network-one").unwrap();
        let first = report_engine_fingerprint(&engine).unwrap();

        std::fs::write(&nnue, b"network-two").unwrap();
        let second = report_engine_fingerprint(&engine).unwrap();
        assert_ne!(first, second);

        std::fs::write(&engine, b"engine-two").unwrap();
        let third = report_engine_fingerprint(&engine).unwrap();
        assert_ne!(second, third);
    }

    #[test]
    fn pikafish_runtime_metadata_parses_version_and_nnue_lines() {
        assert_eq!(
            parse_pikafish_version_line(
                "Pikafish dev-20260726-b2180562 by the Pikafish developers (see AUTHORS file)"
            )
            .as_deref(),
            Some("Pikafish dev-20260726-b2180562")
        );
        assert_eq!(
            parse_pikafish_nnue_metadata_line(
                "info string NNUE evaluation using pikafish.nnue (64MiB, (62083, 1024, 32, 32, 1))"
            )
            .as_deref(),
            Some("(64MiB, (62083, 1024, 32, 32, 1))")
        );
        assert_eq!(
            decorate_known_pikafish_nnue_version(
                Some(PIKAFISH_260720_NNUE_SHA256),
                Some("(64MiB, (62083, 1024, 32, 32, 1))".into())
            )
            .as_deref(),
            Some("权重260720 · (64MiB, (62083, 1024, 32, 32, 1))")
        );
    }

    #[test]
    fn preferred_nnue_path_uses_only_the_fixed_pikafish_network_name() {
        let directory = tempfile::tempdir().unwrap();
        let pikafish = directory.path().join("pikafish");
        let pikafish_nnue = directory.path().join("pikafish.nnue");
        let unrelated_nnue = directory.path().join("xiangqi-other.nnue");
        std::fs::write(&pikafish, b"pikafish").unwrap();
        std::fs::write(&pikafish_nnue, b"pikafish-network").unwrap();
        std::fs::write(&unrelated_nnue, b"other-network").unwrap();

        assert_eq!(preferred_nnue_path(&pikafish).unwrap(), pikafish_nnue);
    }

    #[tokio::test]
    async fn auth_http_maps_success_and_common_failures() {
        let user_id = Uuid::new_v4();
        let server = mock_auth_server(
            "200 OK",
            serde_json::json!({ "user_id": user_id, "token": "jwt-secret" }).to_string(),
        )
        .await;
        assert_eq!(
            request_auth(&server, "login", "user@example.com", "password-123")
                .await
                .unwrap(),
            AuthResponse {
                user_id,
                token: "jwt-secret".into()
            }
        );

        let duplicate = mock_auth_server("409 Conflict", r#"{"error":"duplicate"}"#.into()).await;
        assert_eq!(
            request_auth(&duplicate, "login", "user@example.com", "password-123")
                .await
                .unwrap_err(),
            "该邮箱已经注册，请直接登录"
        );

        let legacy_duplicate = mock_auth_server(
            "400 Bad Request",
            r#"{"error":"email already registered"}"#.into(),
        )
        .await;
        assert_eq!(
            request_auth(
                &legacy_duplicate,
                "login",
                "user@example.com",
                "password-123",
            )
            .await
            .unwrap_err(),
            "该邮箱已经注册，请直接登录"
        );

        let unauthorized =
            mock_auth_server("401 Unauthorized", r#"{"error":"invalid"}"#.into()).await;
        assert_eq!(
            request_auth(&unauthorized, "login", "user@example.com", "password-123")
                .await
                .unwrap_err(),
            "邮箱或密码不正确"
        );

        let unavailable =
            mock_auth_server("503 Service Unavailable", r#"{"error":"down"}"#.into()).await;
        assert!(
            request_auth(&unavailable, "login", "user@example.com", "password-123")
                .await
                .unwrap_err()
                .contains("503")
        );
    }

    #[test]
    fn preference_validation_rejects_remote_http_and_invalid_engine_limits() {
        assert!(validate_server_url("http://127.0.0.1:8080").is_ok());
        assert!(validate_server_url("https://sync.example.com").is_ok());
        assert!(validate_server_url("http://sync.example.com").is_err());
        let mut preferences = DesktopPreferences::default();
        preferences.threads = 0;
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "线程数必须在 1 到 64 之间"
        );
        let mut preferences = DesktopPreferences::default();
        preferences.color_theme = "high-contrast".into();
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "不支持的颜色主题"
        );
        let mut preferences = DesktopPreferences::default();
        preferences.layout_mode = "floating".into();
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "不支持的工作台布局"
        );
        let mut preferences = DesktopPreferences::default();
        preferences.candidate_line_moves = 18;
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "每种后续必须在 5 到 8 个回合之间"
        );
        let mut preferences = DesktopPreferences::default();
        preferences.rule_mode = "tiantian".into();
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "不支持的棋规模式"
        );
    }

    #[test]
    fn builtin_opening_book_preferences_validate_and_normalize() {
        let mut preferences = DesktopPreferences::default();
        preferences.active_builtin_opening_book_id = "complete-compatible".into();
        assert!(validate_preferences(&preferences).is_ok());

        preferences.active_builtin_opening_book_id = "unknown-book".into();
        assert_eq!(
            validate_preferences(&preferences).unwrap_err(),
            "不支持的内嵌开局库"
        );
        normalize_desktop_preferences(&mut preferences);
        assert_eq!(
            preferences.active_builtin_opening_book_id,
            pfbook_opening_book::DEFAULT_BUILTIN_OPENING_BOOK_ID
        );
        assert!(validate_preferences(&preferences).is_ok());
    }

    #[test]
    fn desktop_preferences_migrate_old_depth_defaults_to_twenty_four() {
        let mut preferences = DesktopPreferences::default();
        preferences.search_mode = "depth".into();
        preferences.search_value = 30;
        preferences.report_depth = 30;
        preferences.auto_analyze = true;

        normalize_desktop_preferences(&mut preferences);

        assert_eq!(preferences.search_mode, "depth");
        assert_eq!(preferences.search_value, 24);
        assert_eq!(preferences.report_depth, 24);
        assert!(!preferences.auto_analyze);

        let mut custom = DesktopPreferences::default();
        custom.search_mode = "depth".into();
        custom.search_value = 22;
        custom.report_depth = 22;
        normalize_desktop_preferences(&mut custom);
        assert_eq!(custom.search_value, 22);
        assert_eq!(custom.report_depth, 22);
    }

    #[test]
    fn desktop_preferences_remove_legacy_bundled_fairy_engine() {
        let mut preferences = DesktopPreferences::default();
        preferences.engine_path = "builtin:fairy-stockfish".into();
        preferences.active_engine_id = Some(Uuid::new_v4());
        preferences.parallel_engine_paths = vec![
            BUILTIN_ENGINE_PATH.into(),
            "builtin:fairy-stockfish".into(),
            "/external/fairy-stockfish".into(),
        ];

        normalize_desktop_preferences(&mut preferences);

        assert_eq!(preferences.engine_path, BUILTIN_ENGINE_PATH);
        assert_eq!(preferences.active_engine_id, None);
        assert_eq!(preferences.parallel_engine_paths, Vec::<String>::new());
    }

    #[test]
    fn signed_out_preferences_can_preserve_but_not_select_account_skins() {
        let mut current = DesktopPreferences::default();
        current.board_skin = "jingdian".into();
        current.piece_skin = "jingdian".into();

        let mut updated = current.clone();
        updated.candidate_line_moves = 12;
        assert!(validate_skin_access(&current, &updated, false).is_ok());

        updated.board_skin = "xinghe".into();
        assert_eq!(
            validate_skin_access(&current, &updated, false).unwrap_err(),
            "登录同步账号后才能使用登录专享皮肤"
        );

        let current = DesktopPreferences::default();
        let mut updated = current.clone();
        updated.piece_skin = "jingdian".into();
        assert!(validate_skin_access(&current, &updated, false).is_err());
        assert!(validate_skin_access(&current, &updated, true).is_ok());
    }

    #[test]
    fn hongmu_skin_is_valid_and_free() {
        let current = DesktopPreferences::default();
        let mut updated = current.clone();
        updated.board_skin = "hongmu".into();
        updated.piece_skin = "hongmu".into();

        assert!(validate_preferences(&updated).is_ok());
        assert!(validate_skin_access(&current, &updated, false).is_ok());
    }

    #[test]
    fn flyknife_templates_resolve_to_legal_positions() {
        let templates = flyknife_templates();
        assert!(templates.len() >= 8, "templates: {}", templates.len());
        for template in templates {
            assert!(Board::from_fen(&template.fen).is_ok(), "{}", template.name);
        }
    }

    #[test]
    fn flyknife_accepts_chinese_lure_notation() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        assert_eq!(resolve_flyknife_lure(&board, "炮二平五").unwrap(), "h2e2");
        let after_red_cannon = board.apply_iccs("h2e2").unwrap();
        assert_eq!(
            resolve_flyknife_lure(&after_red_cannon, "马8进7").unwrap(),
            "h9g7"
        );
        assert_eq!(
            resolve_flyknife_lure(&after_red_cannon, "马８进７").unwrap(),
            "h9g7"
        );
    }

    #[test]
    fn flyknife_best_defense_is_presented_as_chinese_notation() {
        assert_eq!(
            flyknife_best_defense_notation(
                STARTING_FEN,
                &["h2e2".into(), "h9g7".into(), "b0c2".into()],
                "h9g7",
                &["b0c2".into()],
            ),
            ["马八进七"]
        );
    }

    #[test]
    fn flyknife_can_analyze_current_position_without_lure_when_attacker_to_move() {
        let board = Board::from_fen(STARTING_FEN).unwrap();
        let (setup, lure, before_lure, prepared) =
            prepare_flyknife_position(&board, Color::Red, "", "").unwrap();
        assert_eq!(setup, "");
        assert_eq!(lure, "");
        assert_eq!(before_lure.to_fen(), STARTING_FEN);
        assert_eq!(prepared.to_fen(), STARTING_FEN);
        let error = prepare_flyknife_position(&board, Color::Black, "", "")
            .expect_err("black cannot move directly from red-to-move starting position");
        assert!(error.contains("请先填写一手对手诱导着法"), "{error}");
        let (setup, lure, before_lure, prepared) =
            prepare_flyknife_position(&board, Color::Black, "", "炮二平五").unwrap();
        assert_eq!(setup, "");
        assert_eq!(lure, "h2e2");
        assert_eq!(before_lure.side_to_move(), Color::Red);
        assert_eq!(prepared.side_to_move(), Color::Black);

        let (setup, lure, before_lure, prepared) =
            prepare_flyknife_position(&board, Color::Red, "炮二平五", "马8进7").unwrap();
        assert_eq!(setup, "h2e2");
        assert_eq!(lure, "h9g7");
        assert_eq!(before_lure.side_to_move(), Color::Black);
        assert_eq!(prepared.side_to_move(), Color::Red);
    }

    #[test]
    fn flyknife_topics_list_bundled_starter_pack() {
        let topics = flyknife_topics();
        assert_eq!(topics.len(), 13);
        assert!(topics.iter().any(|topic| topic.title.contains("仙人指路")));
        assert!(
            topics
                .iter()
                .any(|topic| topic.id == "book-game-53-hong-zhi-huang-shiqing")
        );
        assert_eq!(
            flyknife_topic_file_name("pingfeng-po-guoheche"),
            Some("06-15屏风马破中炮过河车.pgn")
        );
    }

    #[test]
    fn book_game_53_resource_is_a_legal_chinese_manual() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/book-topics/game-53/game-53.pgn");
        let document = import_document(&fs::read(path).unwrap(), Some(ManualFormat::Pgn)).unwrap();
        assert_eq!(document.metadata.red, "洪智");
        assert_eq!(document.metadata.black, "黄仕清");
        assert_eq!(document.metadata.result, "1-0");
    }

    #[test]
    fn book_import_requires_a_legal_complete_chinese_line() {
        assert_eq!(
            chinese_move_tokens("1. 炮二平五 马8进7 2. 马二进三"),
            ["炮二平五", "马8进7", "马二进三"]
        );
        assert_eq!(
            parse_book_import_moves("炮二平五 马8进7 马二进三").unwrap(),
            ["h2e2", "h9g7", "h0g2"]
        );
        let error = parse_book_import_moves("炮二平五 马8进7 车八进九").unwrap_err();
        assert!(error.contains("第 3 步"), "{error}");
    }

    #[test]
    fn flyknife_topic_candidates_cover_packaged_resource_layout() {
        let base = PathBuf::from("/Applications/Xiangqi Studio.app/Contents/Resources");
        let candidates = flyknife_topic_candidates(&base, "01-34仙人指路对卒底炮-一.pgn");
        assert!(candidates.contains(
            &base.join("resources/flyknife-library/single-pgn/01-34仙人指路对卒底炮-一.pgn")
        ));
        assert!(
            candidates
                .contains(&base.join("flyknife-library/single-pgn/01-34仙人指路对卒底炮-一.pgn"))
        );
    }

    #[test]
    fn training_system_seed_cards_cover_the_method_tags() {
        let cards = training_system_seed_cards();
        assert_eq!(cards.len(), 7);
        assert!(cards.iter().all(|card| {
            card.external_id.starts_with("training-system-")
                && card.review_status == "approved"
                && card.source_path.starts_with(TRAINING_SYSTEM_SOURCE_URL)
                && card
                    .source_book
                    .as_deref()
                    .is_some_and(|source| source.contains("方法论参考"))
        }));
        let tags = cards
            .iter()
            .flat_map(|card| card.tags.iter().map(String::as_str))
            .collect::<std::collections::HashSet<_>>();
        for tag in [
            "残局打底",
            "战术漏算",
            "候选着计算",
            "专属布局",
            "深度复盘",
            "慢棋训练",
            "心态管理",
        ] {
            assert!(tags.contains(tag), "missing {tag}");
        }
    }
}
