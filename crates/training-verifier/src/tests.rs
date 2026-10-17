use super::*;
fn request() -> Request {
    Request {
        starting_fen: xiangqi_core::STARTING_FEN.into(),
        path: vec![],
        candidate: "a3a4".into(),
        solution: vec![],
        goal: Some(Goal {
            kind: "draw".into(),
            description: "保持不败".into(),
            solver_side: "w".into(),
            review_method: "reviewed_solution".into(),
            verification: Some(Criteria {
                horizon_plies: 2,
                max_cp_loss: 50,
                min_material_gain: None,
                min_score_cp: Some(-50),
            }),
        }),
        target_mate_moves: None,
    }
}
fn evidence(score: i32) -> Evidence {
    let mut lines = HashMap::new();
    lines.insert(
        "best".into(),
        Line {
            depth: 26,
            score_cp: Some(0),
            pv: vec!["c3c4".into()],
            ..Default::default()
        },
    );
    lines.insert(
        "candidate".into(),
        Line {
            depth: 26,
            score_cp: Some(score),
            pv: vec!["a3a4".into(), "a6a5".into()],
            ..Default::default()
        },
    );
    Evidence {
        lines,
        engine_fingerprint: "test-engine-network".into(),
    }
}
#[test]
fn accepts_unlisted_equivalent_and_rejects_inferior_moves() {
    let r = request();
    let e = evidence(-20);
    let out = verify(&r, &e);
    assert_eq!(out.outcome, "completed");
    assert_eq!(out.path, ["a3a4", "a6a5"]);
    assert_eq!(out.review_kind.as_deref(), Some("alternative_solution"));
    assert_eq!(verify(&r, &evidence(-80)).outcome, "wrong");
}
#[test]
fn uncertain_results_never_become_wrong() {
    let r = request();
    for mutate in 0..4 {
        let mut e = evidence(0);
        let c = e.lines.get_mut("candidate").unwrap();
        match mutate {
            0 => c.depth = 25,
            1 => c.bound = Some("lowerbound".into()),
            2 => c.pv.truncate(1),
            _ => e.engine_fingerprint.clear(),
        }
        assert_eq!(verify(&r, &e).outcome, "pending_review");
    }
}
#[test]
fn missing_conditions_keep_legacy_but_do_not_accept_other_moves() {
    let mut r = request();
    r.goal.as_mut().unwrap().verification = None;
    assert_eq!(verify(&r, &evidence(0)).outcome, "pending_review");
    r.solution.push(Node {
        iccs: r.candidate.clone(),
        ..Default::default()
    });
    assert_eq!(verify(&r, &Evidence::default()).outcome, "completed");
}
#[test]
fn annotated_contradiction_is_reviewed() {
    let mut r = request();
    r.solution.push(Node {
        iccs: r.candidate.clone(),
        ..Default::default()
    });
    let out = verify(&r, &evidence(-100));
    assert_eq!(out.outcome, "pending_review");
    assert_eq!(out.review_kind.as_deref(), Some("suspect_answer"));
}
#[test]
fn winning_position_does_not_excuse_a_blunder() {
    let r = request();
    let mut e = evidence(600);
    e.lines.get_mut("best").unwrap().score_cp = Some(900);
    assert_eq!(verify(&r, &e).outcome, "wrong");
}
#[test]
fn black_scores_use_the_solver_perspective() {
    let mut r = request();
    r.starting_fen = r.starting_fen.replace(" w ", " b ");
    r.goal.as_mut().unwrap().solver_side = "b".into();
    r.candidate = "a6a5".into();
    let mut e = evidence(-20);
    e.lines.get_mut("candidate").unwrap().pv = vec!["a6a5".into(), "a3a4".into()];
    assert_eq!(verify(&r, &e).outcome, "completed");
    e.lines.get_mut("candidate").unwrap().score_cp = Some(-500);
    assert_eq!(verify(&r, &e).outcome, "wrong");
}
#[test]
fn material_forecast_detects_recapture_and_does_not_finish_on_forecast_only() {
    let mut r = request();
    r.starting_fen = "4k4/9/9/9/4p4/9/9/r8/p8/R3K4 w - - 0 1".into();
    r.candidate = "a0a1".into();
    let g = r.goal.as_mut().unwrap();
    g.kind = "gain_material".into();
    g.verification.as_mut().unwrap().min_material_gain = Some(100);
    let mut e = evidence(0);
    e.lines.get_mut("candidate").unwrap().pv = vec!["a0a1".into(), "a2a1".into()];
    assert_eq!(verify(&r, &e).outcome, "wrong");
}
#[test]
fn illegal_move_does_not_call_an_engine() {
    let mut r = request();
    r.candidate = "a3a9".into();
    assert!(searches(&r).is_err());
    assert_eq!(verify(&r, &Evidence::default()).outcome, "illegal");
}
#[test]
fn forecast_does_not_complete_an_alternative_by_empty_tree() {
    let mut r = request();
    r.goal
        .as_mut()
        .unwrap()
        .verification
        .as_mut()
        .unwrap()
        .horizon_plies = 4;
    let mut e = evidence(0);
    e.lines
        .get_mut("candidate")
        .unwrap()
        .pv
        .extend(["c3c4".into(), "c6c5".into()]);
    let out = verify(&r, &e);
    assert_eq!(out.outcome, "correct");
    assert!(!out.completed);
}
#[test]
fn all_independent_mates_pass_but_overlong_and_refuted_moves_do_not() {
    let mut r = request();
    r.goal = None;
    r.target_mate_moves = Some(1);
    r.starting_fen = "4k4/3R5/R3P4/9/9/9/9/9/9/4K4 w - - 0 1".into();
    let b = Board::from_fen(&r.starting_fen).unwrap();
    let mut mates = 0;
    for m in b.legal_moves() {
        if won(&b.apply_move(m).unwrap(), Color::Red) {
            r.candidate = m.to_iccs();
            assert!(verify(&r, &Evidence::default()).completed);
            mates += 1;
        }
    }
    assert!(mates > 1);
    r.candidate = "a7a6".into();
    let mut e = evidence(0);
    e.lines.get_mut("candidate").unwrap().pv = vec![r.candidate.clone()];
    assert_eq!(verify(&r, &e).outcome, "wrong");
    r.target_mate_moves = Some(0);
    assert_eq!(verify(&r, &e).outcome, "wrong");
}
#[test]
fn mate_and_cp_are_not_interchangeable() {
    let r = request();
    let mut e = evidence(0);
    let c = e.lines.get_mut("candidate").unwrap();
    c.score_cp = None;
    c.mate = Some(-3);
    assert_eq!(verify(&r, &e).outcome, "wrong");
}

#[test]
fn invalid_objective_and_broken_legacy_reply_are_pending() {
    let mut r = request();
    r.goal
        .as_mut()
        .unwrap()
        .verification
        .as_mut()
        .unwrap()
        .horizon_plies = 3;
    assert_eq!(verify(&r, &evidence(0)).outcome, "pending_review");
    r.goal = None;
    r.solution = vec![Node {
        iccs: r.candidate.clone(),
        comment: String::new(),
        children: vec![Node {
            iccs: "a6a0".into(),
            ..Default::default()
        }],
    }];
    let out = verify(&r, &Evidence::default());
    assert_eq!(out.outcome, "pending_review");
    assert!(!out.completed);
}
#[test]
fn draw_and_win_thresholds_are_required_even_for_a_near_best_move() {
    let mut r = request();
    r.goal
        .as_mut()
        .unwrap()
        .verification
        .as_mut()
        .unwrap()
        .min_score_cp = Some(100);
    assert_eq!(verify(&r, &evidence(0)).outcome, "wrong");
    r.goal.as_mut().unwrap().kind = "endgame_win".into();
    assert_eq!(verify(&r, &evidence(0)).outcome, "wrong");
}
#[test]
fn defence_must_be_strong_and_preserve_the_actual_objective() {
    let r = request();
    let b = play(&Board::from_fen(&r.starting_fen).unwrap(), &r.candidate).unwrap();
    let mut e = evidence(0);
    e.lines.get_mut("candidate").unwrap().pv = vec!["a6a5".into(), "c3c4".into()];
    assert!(verify_defence(&r, &b, "a6a5", &e).is_ok());
    e.lines.get_mut("candidate").unwrap().score_cp = Some(-200);
    assert!(verify_defence(&r, &b, "a6a5", &e).is_err());
    e.lines.get_mut("candidate").unwrap().score_cp = Some(200);
    e.lines.get_mut("best").unwrap().score_cp = Some(200);
    assert!(verify_defence(&r, &b, "a6a5", &e).is_err());
}
#[test]
fn one_principal_variation_cannot_prove_a_forced_mate() {
    // This rook check has several legal defences. A fabricated mating score
    // and one selected line must not bypass exhaustive defensive coverage.
    let mut r = request();
    r.goal = None;
    r.target_mate_moves = Some(2);
    r.starting_fen = "1r2k4/9/9/9/4p4/9/9/9/R8/4K4 w - - 0 1".into();
    r.candidate = "a1a9".into();
    let next = play(&Board::from_fen(&r.starting_fen).unwrap(), &r.candidate).unwrap();
    assert!(next.legal_moves().len() > 1);
    let mut e = evidence(0);
    let c = e.lines.get_mut("candidate").unwrap();
    c.pv = vec![r.candidate.clone()];
    c.mate = Some(2);
    c.score_cp = None;
    assert_eq!(verify(&r, &e).outcome, "wrong");
}

#[cfg(feature = "engine")]
#[tokio::test]
#[ignore = "uses a real Pikafish executable and pinned NNUE"]
async fn real_pikafish_regression() {
    let path = std::path::PathBuf::from(
        std::env::var("PIKAFISH_TEST_ENGINE").expect("PIKAFISH_TEST_ENGINE"),
    );
    let nnue = path.parent().unwrap().join("pikafish.nnue");
    let fingerprint = engine::fingerprint(&path, Some(&nnue)).await.unwrap();
    let mut r = request();
    r.goal = None;
    r.target_mate_moves = Some(2);
    r.starting_fen = "4k4/3R5/R3P4/9/9/9/9/9/9/4K4 w - - 0 1".into();
    let board = Board::from_fen(&r.starting_fen).unwrap();
    let mut passed = 0;
    for mv in board
        .legal_moves()
        .into_iter()
        .filter(|mv| won(&board.apply_move(*mv).unwrap(), Color::Red))
        .take(2)
    {
        r.candidate = mv.to_iccs();
        let (out, e) = engine::run(&r, path.clone(), Some(nnue.clone()), fingerprint.clone()).await;
        assert!(out.completed, "{}: {}", r.candidate, out.message);
        assert!(!e.lines.is_empty());
        passed += 1;
    }
    assert_eq!(passed, 2);
    r.candidate = "a7a6".into();
    r.target_mate_moves = Some(1);
    let (out, _) = engine::run(&r, path.clone(), Some(nnue.clone()), fingerprint.clone()).await;
    assert_eq!(out.outcome, "wrong");
    // At fixed depth 26, evaluate both restricted and unrestricted searches
    // with identical settings. Slow hardware may correctly remain pending.
    let (out, e) = engine::run(&request(), path, Some(nnue), fingerprint).await;
    assert!(
        !matches!(out.outcome.as_str(), "illegal" | "wrong"),
        "{}",
        out.message
    );
    assert!(e.lines.contains_key("candidate"));
    if out.outcome != "pending_review" {
        assert!(e
            .lines
            .values()
            .all(|line| line.depth >= 26 && line.bound.as_ref().is_none_or(|b| b.is_empty())));
    }
}
