//! One verdict policy for server, Tauri and WASM. Engine PVs guide mate proofs;
//! a PV alone never establishes coverage of defensive moves.
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use xiangqi_core::{Board, Color, GameStatus, Move, PieceKind, Square};

#[cfg(feature = "engine")]
pub mod engine;
pub const VERSION: &str = "training-multisolution-v1";
pub const DEPTH: u32 = 26;
/// Bump the policy version if these verification settings change.
pub const SEARCH_CONFIG: &str = "depth=26;threads=2;hash=128;multipv=1;candidateMs=6000;bestMs=6000;mateMs=1500;proofMs=2000;proofNodes=100000";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Node {
    pub iccs: String,
    #[serde(default)]
    pub comment: String,
    #[serde(default)]
    pub children: Vec<Node>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Criteria {
    #[serde(default = "default_horizon")]
    pub horizon_plies: usize,
    #[serde(default = "default_loss")]
    pub max_cp_loss: i32,
    pub min_material_gain: Option<i32>,
    pub min_score_cp: Option<i32>,
}
fn default_horizon() -> usize {
    12
}
fn default_loss() -> i32 {
    50
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub kind: String,
    #[serde(default)]
    pub description: String,
    pub solver_side: String,
    #[serde(default)]
    pub review_method: String,
    pub verification: Option<Criteria>,
}
impl Goal {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(
            self.kind.as_str(),
            "mate" | "gain_material" | "draw" | "endgame_win"
        ) || !matches!(self.solver_side.as_str(), "w" | "b")
        {
            return Err("无效的解题目标或解题方".into());
        }
        if let Some(c) = &self.verification {
            if !(2..=40).contains(&c.horizon_plies)
                || c.horizon_plies % 2 != 0
                || !(0..=50).contains(&c.max_cp_loss)
                || (self.kind == "gain_material"
                    && !c.min_material_gain.is_some_and(|v| v > 0 && v <= 10000))
                || (matches!(self.kind.as_str(), "draw" | "endgame_win")
                    && !c
                        .min_score_cp
                        .is_some_and(|v| (-30000..=30000).contains(&v)))
            {
                return Err(
                    "请确认验证范围（2–40 偶数半回合）、最大损失（0–50 cp）和达标阈值".into(),
                );
            }
        }
        Ok(())
    }
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub starting_fen: String,
    #[serde(default)]
    pub path: Vec<String>,
    pub candidate: String,
    #[serde(default)]
    pub solution: Vec<Node>,
    pub goal: Option<Goal>,
    pub target_mate_moves: Option<u32>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Search {
    pub key: String,
    pub fen: String,
    pub search_moves: Vec<String>,
    pub depth: u32,
    pub move_time_ms: u64,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub depth: u32,
    pub score_cp: Option<i32>,
    pub mate: Option<i32>,
    #[serde(default)]
    pub bound: Option<String>,
    #[serde(default)]
    pub pv: Vec<String>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    #[serde(default)]
    pub lines: HashMap<String, Line>,
    #[serde(default)]
    pub engine_fingerprint: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultDto {
    pub outcome: String,
    pub message: String,
    pub path: Vec<String>,
    pub auto_moves: Vec<String>,
    pub completed: bool,
    pub hint_move: Option<String>,
    pub review_kind: Option<String>,
    pub verifier_version: String,
    #[serde(default)]
    pub evidence_id: Option<String>,
    #[serde(default)]
    pub local_only: bool,
}
fn result(r: &Request, outcome: &str, message: &str) -> ResultDto {
    ResultDto {
        outcome: outcome.into(),
        message: message.into(),
        path: r.path.clone(),
        auto_moves: vec![],
        completed: false,
        hint_move: None,
        review_kind: None,
        verifier_version: VERSION.into(),
        evidence_id: None,
        local_only: false,
    }
}
pub fn pending(r: &Request, message: &str) -> ResultDto {
    result(r, "pending_review", message)
}
pub fn board_at(r: &Request) -> Result<Board, String> {
    if r.path.len() >= 512 {
        return Err("走子路径超过上限".into());
    }
    let mut board = Board::from_fen(&r.starting_fen).map_err(|_| "初始局面无效")?;
    for text in &r.path {
        if terminal(&board) {
            return Err("终局后不能继续走棋".into());
        }
        board = play(&board, text)?;
    }
    if let Some(goal) = &r.goal {
        goal.validate()?;
        let expected = if Board::from_fen(&r.starting_fen)
            .map_err(|_| "初始局面无效")?
            .side_to_move()
            == Color::Red
        {
            "w"
        } else {
            "b"
        };
        if goal.solver_side != expected {
            return Err("题目作答方与初始局面不符".into());
        }
    }
    Ok(board)
}
fn play(b: &Board, text: &str) -> Result<Board, String> {
    b.apply_move(Move::from_iccs(text).map_err(|_| "非法着法")?)
        .map_err(|_| "非法着法".into())
}
fn terminal(b: &Board) -> bool {
    matches!(b.status(), GameStatus::Checkmate | GameStatus::Stalemate)
}
fn won(b: &Board, solver: Color) -> bool {
    terminal(b) && b.side_to_move() != solver
}
fn known(r: &Request) -> Option<&Node> {
    let mut children = &r.solution;
    for text in &r.path {
        children = &children.iter().find(|n| &n.iccs == text)?.children;
    }
    children.iter().find(|n| n.iccs == r.candidate)
}
pub fn searches(r: &Request) -> Result<Vec<Search>, String> {
    let board = board_at(r)?;
    let initial = Board::from_fen(&r.starting_fen).map_err(|_| "初始局面无效")?;
    if terminal(&board) || board.side_to_move() != initial.side_to_move() {
        return Err("当前不能继续解题方走法".into());
    }
    play(&board, &r.candidate)?;
    let mate = r.target_mate_moves.is_some();
    if !mate
        && r.goal
            .as_ref()
            .and_then(|g| g.verification.as_ref())
            .is_none()
    {
        return Ok(vec![]);
    }
    let mut plans = vec![Search {
        key: "candidate".into(),
        fen: board.to_fen(),
        search_moves: vec![r.candidate.clone()],
        depth: DEPTH,
        move_time_ms: if mate { 1500 } else { 6000 },
    }];
    if !mate {
        plans.push(Search {
            key: "best".into(),
            fen: board.to_fen(),
            search_moves: vec![],
            depth: DEPTH,
            move_time_ms: 6000,
        });
    }
    Ok(plans)
}

pub fn verify(r: &Request, evidence: &Evidence) -> ResultDto {
    let mut legal_request = r.clone();
    legal_request.goal = None;
    if let Err(error) = searches(&legal_request) {
        return if known(r).is_some() {
            rejected(r, &error, true)
        } else {
            result(r, "illegal", &error)
        };
    }
    if let Some(goal) = &r.goal {
        if goal.validate().is_err() || board_at(r).is_err() {
            let mut out = pending(r, "待复核：题目目标条件无效，需要内容审核确认");
            out.review_kind = Some("missing_conditions".into());
            return out;
        }
    }
    if let Err(error) = searches(r) {
        return result(r, "illegal", &error);
    }
    let board = board_at(r).expect("validated");
    let solver = board.side_to_move();
    let next = play(&board, &r.candidate).expect("validated");
    if let Some(target) = r.target_mate_moves {
        return verify_mate(r, evidence, &board, &next, solver, target);
    }
    let Some(goal) = &r.goal else {
        return legacy(r, &next);
    };
    let Some(criteria) = &goal.verification else {
        return legacy(r, &next);
    };
    if evidence.engine_fingerprint.is_empty() {
        return pending(r, "待复核：皮卡鱼证据不可用");
    }
    let Some(best) = evidence.lines.get("best").filter(|l| exact(l)) else {
        return pending(r, "待复核：最佳着搜索深度或分数证据不足");
    };
    let Some(candidate) = evidence
        .lines
        .get("candidate")
        .filter(|l| exact(l) && l.pv.first() == Some(&r.candidate))
    else {
        return pending(r, "待复核：候选着搜索深度或分数证据不足");
    };
    let loss_ok = match (best.mate, candidate.mate, best.score_cp, candidate.score_cp) {
        (Some(b), Some(c), _, _) => b > 0 && c > 0,
        (None, Some(c), _, _) => c > 0,
        (None, None, Some(b), Some(c)) => {
            i64::from(b) - i64::from(c) <= i64::from(criteria.max_cp_loss)
        }
        _ => false,
    };
    if !loss_ok {
        return rejected(r, "该走法明显逊于皮卡鱼最佳着", known(r).is_some());
    }
    let mut projected = board.clone();
    let mut seen = HashSet::from([position_key(&projected)]);
    let mut count = 0;
    for text in candidate.pv.iter().take(criteria.horizon_plies) {
        if terminal(&projected) {
            return pending(r, "待复核：引擎线路在终局后仍有着法");
        }
        let Ok(next) = play(&projected, text) else {
            return pending(r, "待复核：引擎线路含非法着法");
        };
        projected = next;
        count += 1;
        if !seen.insert(position_key(&projected)) {
            return pending(r, "待复核：验证线路出现循环");
        }
    }
    if count < criteria.horizon_plies && !terminal(&projected) {
        return pending(r, "待复核：后续推演长度不足");
    }
    // Negative/positive mate scores are never converted to artificial centipawns.
    let score_ok = |min| {
        candidate
            .mate
            .map(|m| m > 0)
            .unwrap_or_else(|| candidate.score_cp.is_some_and(|v| v >= min))
    };
    let goal_ok = if won(&projected, solver) {
        true
    } else if terminal(&projected) {
        false
    } else {
        match goal.kind.as_str() {
            "gain_material" => {
                material(&projected, solver)
                    - material(
                        &Board::from_fen(&r.starting_fen).expect("validated"),
                        solver,
                    )
                    >= criteria.min_material_gain.unwrap_or(i32::MAX)
            }
            "draw" | "endgame_win" => score_ok(criteria.min_score_cp.unwrap_or(i32::MAX)),
            _ => return pending(r, "待复核：杀棋题缺少规定步数"),
        }
    };
    if !goal_ok {
        return rejected(r, "该走法未达到题目目标", known(r).is_some());
    }
    let mut out = accepted(
        r,
        &next,
        candidate.pv.get(1).cloned(),
        candidate.pv.get(2).cloned(),
    );
    // A forecast is not actual completion. Require the played position to meet
    // the objective, or the configured actual horizon, never an empty saved tree.
    let final_board = out
        .path
        .iter()
        .try_fold(
            Board::from_fen(&r.starting_fen).expect("validated"),
            |b, m| play(&b, m),
        )
        .expect("checked reply");
    out.completed = won(&final_board, solver)
        || match goal.kind.as_str() {
            "gain_material" => {
                material(&final_board, solver)
                    - material(
                        &Board::from_fen(&r.starting_fen).expect("validated"),
                        solver,
                    )
                    >= criteria.min_material_gain.unwrap_or(i32::MAX)
            }
            _ => out.path.len() >= criteria.horizon_plies,
        };
    if out.completed {
        out.outcome = "completed".into();
        out.message = "皮卡鱼复核通过，已达到题目目标".into();
    }
    out
}
fn exact(l: &Line) -> bool {
    l.depth >= DEPTH
        && l.bound.as_ref().is_none_or(|b| b.is_empty())
        && (l.score_cp.is_some() ^ l.mate.is_some())
        && !l.pv.is_empty()
}
fn rejected(r: &Request, message: &str, annotated: bool) -> ResultDto {
    if annotated {
        let mut out = pending(r, "待复核：标注答案与皮卡鱼判断存在矛盾，已记录审核");
        out.review_kind = Some("suspect_answer".into());
        out
    } else {
        result(r, "wrong", message)
    }
}
fn legacy(r: &Request, next: &Board) -> ResultDto {
    let Some(node) = known(r) else {
        let mut out = pending(r, "待复核：题目缺少可计算的目标条件，错误次数未增加");
        out.review_kind = Some("missing_conditions".into());
        return out;
    };
    let reply = node.children.first();
    let mut out = if reply.is_none() && !terminal(next) {
        let mut out = result(r, "completed", "已完成审核题解");
        out.path.push(r.candidate.clone());
        out
    } else {
        accepted(
            r,
            next,
            reply.map(|n| n.iccs.clone()),
            reply
                .and_then(|n| n.children.first())
                .map(|n| n.iccs.clone()),
        )
    };
    if out.outcome == "pending_review" {
        return out;
    }
    out.completed = if let Some(reply) = reply {
        reply.children.is_empty()
    } else {
        true
    };
    out.review_kind = Some("missing_conditions".into());
    out.message = "沿已审核题解继续；该题其他解法需要补充目标条件".into();
    if out.completed {
        out.outcome = "completed".into();
    }
    out
}
fn accepted(r: &Request, next: &Board, reply: Option<String>, hint: Option<String>) -> ResultDto {
    let mut out = result(r, "correct", "皮卡鱼复核通过，请继续");
    out.path.push(r.candidate.clone());
    out.hint_move = hint;
    if !terminal(next) {
        let Some(reply) = reply else {
            return pending(r, "待复核：缺少对方应手");
        };
        if play(next, &reply).is_err() {
            return pending(r, "待复核：对方应手不合法");
        }
        out.path.push(reply.clone());
        out.auto_moves.push(reply);
    } else {
        out.completed = true;
        out.outcome = "completed".into();
    }
    if known(r).is_none() {
        out.review_kind = Some("alternative_solution".into());
        out.message = "皮卡鱼确认另一种正确解法，请继续".into();
    }
    out
}
fn material(b: &Board, solver: Color) -> i32 {
    (0..10)
        .flat_map(|row| (0..9).map(move |col| Square { row, col }))
        .filter_map(|s| b.piece_at(s))
        .map(|p| {
            let value = match p.kind {
                PieceKind::King => 0,
                PieceKind::Rook => 1000,
                PieceKind::Horse | PieceKind::Cannon => 500,
                PieceKind::Advisor | PieceKind::Elephant => 200,
                PieceKind::Pawn => 100,
            };
            if p.color == solver { value } else { -value }
        })
        .sum()
}
pub fn position_key(b: &Board) -> String {
    b.to_fen()
        .split_whitespace()
        .take(2)
        .collect::<Vec<_>>()
        .join(" ")
}

/// Completion predicate over actual played moves, independent of a cached PV.
pub fn actual_goal_reached(r: &Request, moves: &[String]) -> bool {
    let Ok(initial) = Board::from_fen(&r.starting_fen) else {
        return false;
    };
    let solver = initial.side_to_move();
    let Ok(board) = moves.iter().try_fold(initial.clone(), |b, m| play(&b, m)) else {
        return false;
    };
    if terminal(&board) {
        return won(&board, solver);
    }
    let Some(goal) = &r.goal else {
        return false;
    };
    let Some(c) = &goal.verification else {
        return false;
    };
    if goal.kind == "gain_material" {
        material(&board, solver) - material(&initial, solver)
            >= c.min_material_gain.unwrap_or(i32::MAX)
    } else {
        moves.len() >= c.horizon_plies
    }
}

/// Offline engines may choose a different equally strong defence. Never grade
/// a cooperative, client-invented reply using the server's unrelated forecast.
pub fn verify_defence(
    r: &Request,
    board: &Board,
    candidate: &str,
    e: &Evidence,
) -> Result<(), String> {
    let Some(goal) = &r.goal else {
        return Err("待复核：原题解以外的应手缺少目标条件".into());
    };
    let Some(c) = &goal.verification else {
        return Err("待复核：原题解以外的应手缺少目标条件".into());
    };
    let Some(best) = e.lines.get("best").filter(|line| exact(line)) else {
        return Err("待复核：实际应手的最佳评估证据不足".into());
    };
    let Some(line) = e
        .lines
        .get("candidate")
        .filter(|line| exact(line) && line.pv.first().is_some_and(|text| text == candidate))
    else {
        return Err("待复核：实际应手的评估证据不足".into());
    };
    if e.engine_fingerprint.is_empty() {
        return Err("待复核：实际应手缺少引擎证据".into());
    }
    match (best.score_cp, line.score_cp, best.mate, line.mate) {
        (Some(best), Some(score), None, None)
            if i64::from(best) - i64::from(score) <= i64::from(c.max_cp_loss) => {}
        (_, _, Some(best), Some(score)) if best.signum() == score.signum() => {}
        _ => return Err("待复核：本机应手与服务端最佳防守不一致".into()),
    }
    let initial = Board::from_fen(&r.starting_fen).map_err(|_| "待复核：初始局面无效")?;
    let solver = initial.side_to_move();
    let mut projected = board.clone();
    let mut count = 0;
    let mut seen = HashSet::from([position_key(&projected)]);
    for text in line.pv.iter().take(c.horizon_plies) {
        projected = play(&projected, text)?;
        count += 1;
        if !seen.insert(position_key(&projected)) {
            return Err("待复核：实际应手的推演出现循环".into());
        }
        if terminal(&projected) {
            break;
        }
    }
    if count < c.horizon_plies && !terminal(&projected) {
        return Err("待复核：实际应手的后续推演不足".into());
    }
    let reached = won(&projected, solver)
        || (!terminal(&projected)
            && match goal.kind.as_str() {
                "gain_material" => {
                    material(&projected, solver) - material(&initial, solver)
                        >= c.min_material_gain.unwrap_or(i32::MAX)
                }
                "draw" | "endgame_win" => line.mate.map(|mate| mate < 0).unwrap_or_else(|| {
                    line.score_cp.is_some_and(|score| {
                        -i64::from(score) >= i64::from(c.min_score_cp.unwrap_or(i32::MAX))
                    })
                }),
                _ => false,
            });
    if reached {
        Ok(())
    } else {
        Err("待复核：实际应手后的目标尚未达成".into())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Verdict {
    Win,
    Loss,
    Unknown,
}
struct Proof {
    solver: Color,
    nodes: usize,
    deadline: f64,
    memo: HashMap<(String, u32), Verdict>,
    hints: HashMap<String, Vec<String>>,
}
#[cfg(target_arch = "wasm32")]
fn now() -> f64 {
    js_sys::Date::now()
}
#[cfg(not(target_arch = "wasm32"))]
fn now() -> f64 {
    static START: std::sync::OnceLock<std::time::Instant> = std::sync::OnceLock::new();
    START
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_secs_f64()
        * 1000.0
}
impl Proof {
    fn evaluate(&mut self, b: &Board, plies: u32) -> Verdict {
        if self.nodes == 0 || now() >= self.deadline {
            return Verdict::Unknown;
        }
        self.nodes -= 1;
        let key = (position_key(b), plies);
        if let Some(v) = self.memo.get(&key) {
            return *v;
        }
        let mut moves = b.legal_moves();
        if moves.is_empty() {
            return if b.side_to_move() != self.solver {
                Verdict::Win
            } else {
                Verdict::Loss
            };
        }
        if plies == 0 {
            return Verdict::Loss;
        }
        let hints = self.hints.get(&key.0);
        moves.sort_by_key(|m| {
            hints
                .and_then(|h| h.iter().position(|t| t == &m.to_iccs()))
                .unwrap_or(usize::MAX)
        });
        let attacking = b.side_to_move() == self.solver;
        let mut unknown = false;
        for mv in moves {
            let v = self.evaluate(&b.apply_move(mv).expect("legal"), plies - 1);
            if (attacking && v == Verdict::Win) || (!attacking && v == Verdict::Loss) {
                self.memo.insert(key, v);
                return v;
            }
            unknown |= v == Verdict::Unknown;
        }
        let v = if unknown {
            Verdict::Unknown
        } else if attacking {
            Verdict::Loss
        } else {
            Verdict::Win
        };
        if v != Verdict::Unknown {
            self.memo.insert(key, v);
        }
        v
    }
}
fn verify_mate(
    r: &Request,
    e: &Evidence,
    board: &Board,
    next: &Board,
    solver: Color,
    target: u32,
) -> ResultDto {
    if target == 0 || target > 255 || r.path.len() >= (target * 2 - 1) as usize {
        return rejected(r, "超过规定杀法步数", known(r).is_some());
    }
    if won(next, solver) {
        let mut out = accepted(r, next, None, None);
        out.message = "正确，已在规定步数内杀成".into();
        return out;
    }
    if e.engine_fingerprint.is_empty() {
        return pending(r, "待复核：皮卡鱼暂时不可用");
    }
    let Some(line) = e
        .lines
        .get("candidate")
        .filter(|l| l.pv.first() == Some(&r.candidate))
    else {
        return pending(r, "待复核：皮卡鱼未返回候选着线路");
    };
    let mut hints = HashMap::<String, Vec<String>>::new();
    let mut b = board.clone();
    for text in &line.pv {
        let Ok(next) = play(&b, text) else {
            return pending(r, "待复核：引擎线路不合法");
        };
        hints
            .entry(position_key(&b))
            .or_default()
            .push(text.clone());
        b = next;
    }
    let mut proof = Proof {
        solver,
        nodes: 100_000,
        deadline: now() + 2000.0,
        memo: HashMap::new(),
        hints,
    };
    let remaining = target * 2 - 2 - r.path.len() as u32;
    match proof.evaluate(next, remaining) {
        Verdict::Unknown => pending(r, "待复核：全部防守验证预算耗尽，错误次数未增加"),
        Verdict::Loss => rejected(
            r,
            "无法在规定步数内应对全部合法防守并杀成",
            known(r).is_some(),
        ),
        Verdict::Win => {
            let reply = line
                .pv
                .get(1)
                .filter(|m| play(next, m).is_ok())
                .cloned()
                .or_else(|| next.legal_moves().first().map(|m| m.to_iccs()));
            let mut out = accepted(r, next, reply, line.pv.get(2).cloned());
            let after = out.auto_moves.first().and_then(|m| play(next, m).ok());
            out.completed |= after.as_ref().is_some_and(|b| won(b, solver));
            if out.completed {
                out.outcome = "completed".into();
            }
            out
        }
    }
}

#[cfg(test)]
mod tests;
