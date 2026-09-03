use local_store::{EndgameProblemImport, LocalStore};
use manual_format::{import_cbl_library, CBL_PARSER_VERSION};
use sha2::{Digest, Sha256};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = std::env::args_os();
    let executable = args.next().unwrap_or_default();
    let database_path = args.next().ok_or_else(|| {
        format!(
            "用法：{} <xiangqi.sqlite3> <题库.cbl>",
            executable.to_string_lossy()
        )
    })?;
    let cbl_path = args.next().ok_or_else(|| {
        format!(
            "用法：{} <xiangqi.sqlite3> <题库.cbl>",
            executable.to_string_lossy()
        )
    })?;

    let bytes = std::fs::read(&cbl_path)?;
    let parsed = import_cbl_library(&bytes)?;
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
                solution_json: serde_json::to_string(&problem.solution)?,
            })
        })
        .collect::<Result<Vec<_>, serde_json::Error>>()?;
    let fingerprint = format!("{:x}", Sha256::digest(&bytes));
    let mut store = LocalStore::open(database_path)?;
    let library = store.import_endgame_library(
        &cbl_path.to_string_lossy(),
        &fingerprint,
        &parsed.title,
        CBL_PARSER_VERSION,
        &problems,
    )?;

    println!(
        "已重建《{}》：{} 道残局，跳过 {} 条目录或无效记录。",
        library.title,
        library.problem_count,
        parsed.warnings.len()
    );
    Ok(())
}
