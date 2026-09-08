use manual_format::import_cbl_game_library_reader;
use serde::Serialize;
use std::{
    env, fs,
    fs::File,
    path::{Path, PathBuf},
};

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    files: u32,
    games: u64,
    empty_files: u32,
    invalid_records: u64,
    failed_files: u32,
    warnings: Vec<String>,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let root = PathBuf::from(
        args.next()
            .ok_or("用法：cbl_preflight <CBL文件或目录> [每文件最多棋局数]")?,
    );
    let limit = args
        .next()
        .map(|value| value.parse::<usize>())
        .transpose()?;
    let files = cbl_files(&root)?;
    let mut report = Report {
        files: files.len() as u32,
        ..Report::default()
    };
    for path in files {
        let display = path.strip_prefix(&root).unwrap_or(&path).to_string_lossy();
        let mut file = File::open(&path)?;
        match import_cbl_game_library_reader(&mut file, limit, |_| Ok(())) {
            Ok(summary) => {
                report.games += u64::from(summary.game_count);
                if summary.game_count == 0 {
                    report.empty_files += 1;
                }
                report.invalid_records += summary
                    .warnings
                    .iter()
                    .filter(|warning| warning.contains("记录已跳过"))
                    .count() as u64;
                report.warnings.extend(
                    summary
                        .warnings
                        .into_iter()
                        .take(3)
                        .map(|warning| format!("{display}：{warning}")),
                );
            }
            Err(error) => {
                report.failed_files += 1;
                report.warnings.push(format!("{display}：{error}"));
            }
        }
    }
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}

fn cbl_files(root: &Path) -> std::io::Result<Vec<PathBuf>> {
    if root.is_file() {
        return Ok(vec![root.to_owned()]);
    }
    let mut files = Vec::new();
    let mut pending = vec![root.to_owned()];
    while let Some(directory) = pending.pop() {
        for entry in fs::read_dir(directory)? {
            let path = entry?.path();
            if path.is_dir() {
                pending.push(path);
            } else if path
                .extension()
                .is_some_and(|value| value.eq_ignore_ascii_case("cbl"))
            {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}
