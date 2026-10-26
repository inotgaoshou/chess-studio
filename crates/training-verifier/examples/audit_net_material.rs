//! Finite local audit; output is evidence only and never changes publication state.
use serde::Deserialize;
use std::{collections::HashSet, io::Write, path::PathBuf};
use training_verifier::{Criteria, Goal, Node, Request, engine};
#[derive(Deserialize)]
struct Library {
    problems: Vec<Problem>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Problem {
    source_index: u32,
    title: String,
    starting_fen: String,
    solution: Vec<Node>,
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 5 {
        return Err("input.json engine nnue output.jsonl [limit]".into());
    }
    let library: Library = serde_json::from_slice(&std::fs::read(&args[1])?)?;
    let engine_path = PathBuf::from(&args[2]).canonicalize()?;
    let nnue = PathBuf::from(&args[3]).canonicalize()?;
    let limit: usize = args
        .get(5)
        .map(|s| s.parse())
        .transpose()?
        .unwrap_or(usize::MAX);
    let mut completed = HashSet::new();
    if let Ok(old) = std::fs::read_to_string(&args[4]) {
        for line in old.lines() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
                if let Some(i) = v["sourceIndex"].as_u64() {
                    completed.insert(i as u32);
                }
            }
        }
    }
    let fingerprint = engine::fingerprint(&engine_path, Some(&nnue)).await?;
    let mut output = std::fs::OpenOptions::new()
        .append(true)
        .create(true)
        .open(&args[4])?;
    let mut processed = 0;
    for problem in library.problems {
        if completed.contains(&problem.source_index) {
            continue;
        }
        if processed >= limit {
            break;
        }
        let mut verdicts = Vec::new();
        for node in &problem.solution {
            let request = Request {
                starting_fen: problem.starting_fen.clone(),
                path: vec![],
                candidate: node.iccs.clone(),
                solution: problem.solution.clone(),
                target_mate_moves: None,
        require_verified_goal: false,
                goal: Some(Goal {
                    kind: "gain_material".into(),
                    description: "净得子：在对方最优应手与回吃后，至少净赚一兵（100 子力分）"
                        .into(),
                    solver_side: problem
                        .starting_fen
                        .split_whitespace()
                        .nth(1)
                        .unwrap_or("w")
                        .into(),
                    review_method: "reviewed_solution".into(),
                    verification: Some(Criteria {
                        horizon_plies: 2,
                        max_cp_loss: 50,
                        min_material_gain: Some(100),
                        min_score_cp: None,
                    }),
                }),
            };
            let (result, evidence) = engine::run(
                &request,
                engine_path.clone(),
                Some(nnue.clone()),
                fingerprint.clone(),
            )
            .await;
            verdicts
                .push(serde_json::json!({"request":request,"result":result,"evidence":evidence}));
        }
        let passed = !verdicts.is_empty()
            && verdicts
                .iter()
                .all(|v| v["result"]["completed"] == true && v["result"]["outcome"] == "completed");
        let row = serde_json::json!({"sourceIndex":problem.source_index,"title":problem.title,"passed":passed,"policy":"net-material-after-defence-v1","verdicts":verdicts});
        writeln!(output, "{}", row)?;
        output.flush()?;
        processed += 1;
        println!("audit index={} passed={}", problem.source_index, passed);
    }
    Ok(())
}
