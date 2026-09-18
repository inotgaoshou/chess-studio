use manual_format::import_cbl_library;
use serde::Serialize;
use std::{env, fs};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReviewReport {
    title: String,
    declared_count: u32,
    problem_count: usize,
    warning_count: usize,
    first_problem: String,
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = env::args()
        .nth(1)
        .ok_or("usage: cbl_review_check <sample.cbl>")?;
    let library = import_cbl_library(&fs::read(path)?)?;
    let first_problem = library
        .problems
        .first()
        .ok_or("CBL file contains no importable endgame problems")?;
    let report = ReviewReport {
        title: library.title,
        declared_count: library.declared_count,
        problem_count: library.problems.len(),
        warning_count: library.warnings.len(),
        first_problem: first_problem.title.clone(),
    };
    println!("{}", serde_json::to_string_pretty(&report)?);
    Ok(())
}
