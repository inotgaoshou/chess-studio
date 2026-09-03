use super::*;
use local_store::{EndgameAttempt, EndgameLibrary, EndgameProblem, EndgameProblemImport};
use manual_format::CBL_PARSER_VERSION;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EndgameImportResult {
    pub library: EndgameLibrary,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EndgameRefreshResult {
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EndgameFreePracticeMove {
    pub fen: String,
    pub notation: String,
    pub terminal: bool,
}

#[tauri::command]
pub(crate) fn endgame_chinese_mainline(
    starting_fen: String,
    moves: Vec<String>,
) -> Result<Vec<String>, String> {
    let board = Board::from_fen(&starting_fen).map_err(|error| error.to_string())?;
    board
        .chinese_pv_notation(&moves)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn endgame_free_practice_move(
    starting_fen: String,
    previous_moves: Vec<String>,
    iccs: String,
) -> Result<EndgameFreePracticeMove, String> {
    let mut board = Board::from_fen(&starting_fen).map_err(|error| error.to_string())?;
    for previous in previous_moves {
        board = board
            .apply_iccs(&previous)
            .map_err(|_| "自由练习的历史着法无效".to_owned())?;
    }
    let mv = Move::from_iccs(&iccs).map_err(|error| error.to_string())?;
    let notation = board
        .chinese_move_notation(mv)
        .map_err(|_| "这步不符合中国象棋规则".to_owned())?;
    board = board
        .apply_move(mv)
        .map_err(|_| "这步不符合中国象棋规则".to_owned())?;
    Ok(EndgameFreePracticeMove {
        fen: board.to_fen(),
        notation,
        terminal: !matches!(board.status(), GameStatus::Ongoing | GameStatus::Check),
    })
}

#[tauri::command]
pub(crate) fn import_endgame_cbl(
    path: String,
    state: State<'_, DesktopState>,
) -> Result<EndgameImportResult, String> {
    import_endgame_cbl_path(&path, &state)
}

fn import_endgame_cbl_path(
    path: &str,
    state: &DesktopState,
) -> Result<EndgameImportResult, String> {
    let bytes = std::fs::read(path).map_err(|error| format!("读取 CBL 失败：{error}"))?;
    let parsed = import_cbl_library(&bytes)?;
    let fingerprint = format!("{:x}", Sha256::digest(&bytes));
    let problems = parsed
        .problems
        .iter()
        .map(|problem| {
            Ok(EndgameProblemImport {
                source_index: problem.source_index,
                title: problem.title.clone(),
                category: problem.category.clone(),
                starting_fen: problem.starting_fen.clone(),
                note: problem.note.clone(),
                solution_json: serde_json::to_string(&problem.solution)
                    .map_err(|error| error.to_string())?,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let mut model = state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?;
    let library = model
        .store
        .import_endgame_library(
            path,
            &fingerprint,
            &parsed.title,
            CBL_PARSER_VERSION,
            &problems,
        )
        .map_err(|error| error.to_string())?;
    Ok(EndgameImportResult {
        library,
        warnings: parsed.warnings,
    })
}

#[tauri::command]
pub(crate) fn refresh_endgame_libraries(
    state: State<'_, DesktopState>,
) -> Result<EndgameRefreshResult, String> {
    let libraries = {
        state
            .model
            .lock()
            .map_err(|_| "state lock poisoned".to_owned())?
            .store
            .endgame_libraries_requiring_refresh(CBL_PARSER_VERSION)
            .map_err(|error| error.to_string())?
    };
    let mut warnings = Vec::new();
    for library in libraries {
        match import_endgame_cbl_path(&library.source_path, &state) {
            Ok(result) if result.warnings.is_empty() => {}
            Ok(result) => warnings.push(format!(
                "《{}》已更新，跳过 {} 条无效记录",
                library.title,
                result.warnings.len()
            )),
            Err(error) => warnings.push(format!("《{}》未能更新：{error}", library.title)),
        }
    }
    Ok(EndgameRefreshResult { warnings })
}

#[tauri::command]
pub(crate) fn list_endgame_libraries(
    state: State<'_, DesktopState>,
) -> Result<Vec<EndgameLibrary>, String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .endgame_libraries()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_endgame_problems(
    library_id: Uuid,
    state: State<'_, DesktopState>,
) -> Result<Vec<EndgameProblem>, String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .endgame_problems(library_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn list_endgame_attempts(
    problem_id: Uuid,
    state: State<'_, DesktopState>,
) -> Result<Vec<EndgameAttempt>, String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .endgame_attempts(problem_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn save_endgame_attempt(
    problem_id: Uuid,
    mode: String,
    elapsed_ms: u64,
    hints_used: u32,
    mistakes: u32,
    outcome: String,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    if !matches!(mode.as_str(), "solver" | "replay" | "free")
        || !matches!(outcome.as_str(), "completed" | "revealed" | "abandoned" | "free_finished")
    {
        return Err("残局训练参数无效".into());
    }
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .save_endgame_attempt(
            problem_id, &mode, elapsed_ms, hints_used, mistakes, &outcome,
        )
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn delete_endgame_library(
    library_id: Uuid,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .delete_endgame_library(library_id)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub(crate) fn delete_endgame_problem(
    problem_id: Uuid,
    state: State<'_, DesktopState>,
) -> Result<(), String> {
    state
        .model
        .lock()
        .map_err(|_| "state lock poisoned".to_owned())?
        .store
        .hide_endgame_problem(problem_id)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_practice_accepts_a_legal_move_and_returns_its_position() {
        let result = endgame_free_practice_move(
            "4k4/9/9/9/4P4/9/9/9/9/R3K4 w - - 0 1".into(),
            Vec::new(),
            "a0a1".into(),
        )
        .unwrap();
        assert_eq!(result.notation, "车九进一");
        assert!(result.fen.ends_with(" b - - 1 1"));
        assert!(!result.terminal);
    }
}
