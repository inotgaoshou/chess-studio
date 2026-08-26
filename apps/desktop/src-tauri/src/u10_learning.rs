use std::collections::BTreeMap;

use chrono::{DateTime, Datelike, Duration, Utc};
use local_store::{GuidedAnalysisSubmission, LearningProfile, TrainingAttempt, TrainingTask};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuidedEngineLine {
    pub depth: Option<u32>,
    pub score_cp: Option<i32>,
    pub mate: Option<i32>,
    pub multipv: u32,
    #[serde(default)]
    pub notation: Vec<String>,
    #[serde(default)]
    pub pv: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GuidedAnalysisResultDto {
    pub session_id: Uuid,
    pub result_kind: String,
    pub result_label: String,
    pub score: u32,
    pub chosen_rank: Option<u32>,
    pub missed_counterplay: bool,
    pub score_cp: Option<i32>,
    pub mate: Option<i32>,
    pub lines: Vec<GuidedEngineLine>,
    pub theory_signals: Vec<String>,
    pub training_advice: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyPlanItemDto {
    pub task_id: Option<Uuid>,
    pub source: String,
    pub title: String,
    pub minutes: u32,
    pub due: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyPlanSegmentDto {
    pub key: String,
    pub title: String,
    pub minutes: u32,
    pub target_tags: Vec<String>,
    pub completion_hint: String,
    pub items: Vec<DailyPlanItemDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyTrainingPlanDto {
    pub date: String,
    pub week: u32,
    pub phase_title: String,
    pub total_minutes: u32,
    pub personal_ratio: u32,
    pub thematic_ratio: u32,
    pub segments: Vec<DailyPlanSegmentDto>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyLearningReportDto {
    pub week_start: String,
    pub week_end: String,
    pub attempts: usize,
    pub average_score: Option<u32>,
    pub hint_free_rate: Option<u32>,
    pub average_seconds: Option<u32>,
    pub mastered_tasks: usize,
    pub result_counts: BTreeMap<String, usize>,
    pub weak_tags: Vec<String>,
    pub parent_summary: String,
    pub next_focus: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpeningSample {
    pub game_id: Uuid,
    pub side: String,
    pub opening_name: String,
    pub updated_at: String,
    #[serde(default)]
    pub average_quality: Option<u8>,
    #[serde(default)]
    pub typical_deviation: Option<String>,
    #[serde(default)]
    pub outcome: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpeningSystemDto {
    pub name: String,
    pub games: u32,
    pub wins: u32,
    pub draws: u32,
    pub losses: u32,
    pub average_quality: Option<u8>,
    pub recent_trend: String,
    pub typical_deviation: Option<String>,
    pub training_mode: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpeningRepertoireDto {
    pub sampled_games: usize,
    pub red: Vec<OpeningSystemDto>,
    pub black: Vec<OpeningSystemDto>,
    pub enough_data: bool,
    pub note: String,
}

pub fn classify_submission(
    session_id: Uuid,
    submission: &GuidedAnalysisSubmission,
    mut lines: Vec<GuidedEngineLine>,
) -> GuidedAnalysisResultDto {
    lines.sort_by_key(|line| line.multipv);
    let chosen_rank = lines
        .iter()
        .find(|line| {
            line.pv
                .first()
                .is_some_and(|mv| mv == &submission.chosen_move)
        })
        .map(|line| line.multipv);
    let selected = chosen_rank.and_then(|rank| lines.iter().find(|line| line.multipv == rank));
    let expected_reply = selected.and_then(|line| line.pv.get(1));
    let missed_counterplay = expected_reply.is_some_and(|reply| {
        submission.predicted_line.get(1) != Some(reply)
            && !submission
                .predicted_line
                .iter()
                .skip(1)
                .any(|mv| mv == reply)
    });
    let (result_kind, result_label, score, training_advice) =
        match (chosen_rank, missed_counterplay) {
            (Some(1), false) if submission.predicted_line.len() >= 4 => (
                "correct",
                "计算正确",
                92,
                "主候选与主要反击均命中；复练时尝试在相同时间内多算两个半回合。",
            ),
            (Some(1..=3), false) => (
                "direction",
                "方向正确",
                82,
                "候选方向可靠；下一次把预测线补足到 4–8 个半回合。",
            ),
            (Some(1..=3), true) => (
                "missedCounterplay",
                "漏算反击",
                68,
                "首选有道理，但漏掉了对方主要强制应手；落子前再做一次将军、吃子、捉双检查。",
            ),
            _ => (
                "principle",
                "原则问题",
                48,
                "首选未进入前三候选；回到威胁扫描、最差子和候选着比较重新拆解。",
            ),
        };
    let mut theory_signals = Vec::new();
    if missed_counterplay {
        theory_signals.extend(["强制着".into(), "反击检查".into()]);
    }
    if chosen_rank.is_none() {
        theory_signals.extend(["候选着".into(), "最差子".into()]);
    }
    if submission.candidates.len() < 3 {
        theory_signals.extend(["候选不足".into(), "候选着计算".into()]);
    }
    if missed_counterplay {
        theory_signals.push("战术漏算".into());
    }
    if submission.threats.trim().is_empty() || submission.forcing_moves.trim().is_empty() {
        theory_signals.push("威胁扫描".into());
    }
    theory_signals.sort();
    theory_signals.dedup();
    GuidedAnalysisResultDto {
        session_id,
        result_kind: result_kind.into(),
        result_label: result_label.into(),
        score,
        chosen_rank,
        missed_counterplay,
        score_cp: selected.and_then(|line| line.score_cp),
        mate: selected.and_then(|line| line.mate),
        lines,
        theory_signals,
        training_advice: training_advice.into(),
    }
}

pub fn phase_title(week: u32) -> &'static str {
    match week.clamp(1, 12) {
        1..=2 => "基线诊断与计算习惯",
        3..=5 => "强制着、候选着与反击检查",
        6..=8 => "个人红黑布局体系与常见偏离",
        9..=10 => "优势转化、兑子与残局",
        11 => "限时比赛模拟",
        _ => "同类局面复测与阶段总结",
    }
}

pub fn daily_plan(
    profile: &LearningProfile,
    tasks: &[TrainingTask],
    attempts: &[TrainingAttempt],
    now: DateTime<Utc>,
) -> DailyTrainingPlanDto {
    let mut due_task_ids = attempts
        .iter()
        .filter(|attempt| {
            !attempt.mastered
                && attempt
                    .next_review_at
                    .as_deref()
                    .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                    .is_some_and(|date| date.with_timezone(&Utc) <= now)
        })
        .map(|attempt| attempt.task_id)
        .collect::<Vec<_>>();
    due_task_ids.extend(tasks.iter().filter(|task| {
        !task.mastered
            && task
                .next_review_at
                .as_deref()
                .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                .is_some_and(|date| date.with_timezone(&Utc) <= now)
    }).map(|task| task.id));
    due_task_ids.sort();
    due_task_ids.dedup();
    let due_tasks: Vec<DailyPlanItemDto> = tasks
        .iter()
        .filter(|task| due_task_ids.contains(&task.id))
        .take(2)
        .map(|task| DailyPlanItemDto {
            task_id: Some(task.id),
            source: "间隔复习".into(),
            title: task.title.clone(),
            minutes: 4,
            due: true,
        })
        .collect();
    let own_game = tasks.iter().find(|task| task.task_type == "critical");
    let thematic = tasks.iter().find(|task| task.task_type == "reinforcement");
    let segments = vec![
        DailyPlanSegmentDto {
            key: "endgame-foundation".into(),
            title: "残局打底".into(),
            minutes: 10,
            target_tags: vec!["残局打底".into(), "残局处理".into()],
            completion_hint: "完成 1 个基础残局判断：先说理论胜和，再说限制、推进和兑换顺序。"
                .into(),
            items: vec![DailyPlanItemDto {
                task_id: None,
                source: "内置专题".into(),
                title: "基础残局：限制、改善、推进".into(),
                minutes: 10,
                due: false,
            }],
        },
        DailyPlanSegmentDto {
            key: "tactical-scan".into(),
            title: "战术漏算".into(),
            minutes: 8,
            target_tags: vec!["战术漏算".into()],
            completion_hint: "每题按将军、吃子、捉双、强制兑子扫完双方手段。".into(),
            items: vec![DailyPlanItemDto {
                task_id: thematic.map(|task| task.id),
                source: "内置专题".into(),
                title: thematic
                    .map(|task| task.title.clone())
                    .unwrap_or_else(|| "强制着与防漏检查".into()),
                minutes: 8,
                due: false,
            }],
        },
        DailyPlanSegmentDto {
            key: "guided-analysis".into(),
            title: "引导拆棋".into(),
            minutes: 12,
            target_tags: vec!["候选着计算".into(), "深度复盘".into()],
            completion_hint: "提交前先列首选加备选，预测 2-8 个半回合；不足三候选也记录原因。"
                .into(),
            items: due_tasks
                .into_iter()
                .chain(std::iter::once(DailyPlanItemDto {
                    task_id: own_game.map(|task| task.id),
                    source: "个人棋谱".into(),
                    title: own_game
                        .map(|task| task.title.clone())
                        .unwrap_or_else(|| "导入最近比赛棋谱后生成关键拆棋".into()),
                    minutes: 12,
                    due: false,
                }))
                .collect(),
        },
        DailyPlanSegmentDto {
            key: "opening-system".into(),
            title: "开局体系".into(),
            minutes: 7,
            target_tags: vec!["专属布局".into(), "开局失误".into()],
            completion_hint: "只背本周主线和一个备选，重点说清为什么进入自己的先后手体系。".into(),
            items: vec![DailyPlanItemDto {
                task_id: None,
                source: "学习开局库".into(),
                title: "专属武器库：先手/后手各复盘 1 条主线".into(),
                minutes: 7,
                due: false,
            }],
        },
        DailyPlanSegmentDto {
            key: "training-note".into(),
            title: "训练笔记".into(),
            minutes: 3,
            target_tags: vec!["心态管理".into(), "慢棋训练".into()],
            completion_hint: "只记录一个状态标签：专注、急躁、优势放松或劣势抗压。".into(),
            items: vec![DailyPlanItemDto {
                task_id: None,
                source: "训练总结".into(),
                title: "写下今天最大漏算点和下一次慢棋提醒".into(),
                minutes: 3,
                due: false,
            }],
        },
    ];
    DailyTrainingPlanDto {
        date: now.date_naive().to_string(),
        week: profile.current_week,
        phase_title: phase_title(profile.current_week).into(),
        total_minutes: segments.iter().map(|segment| segment.minutes).sum(),
        personal_ratio: 60,
        thematic_ratio: 40,
        segments,
    }
}

pub fn weekly_report(
    attempts: &[TrainingAttempt],
    tasks: &[TrainingTask],
    now: DateTime<Utc>,
) -> WeeklyLearningReportDto {
    let weekday = now.weekday().num_days_from_monday() as i64;
    let week_start = (now - Duration::days(weekday)).date_naive();
    let week_end = week_start + Duration::days(6);
    let current = attempts
        .iter()
        .filter(|attempt| {
            DateTime::parse_from_rfc3339(&attempt.created_at)
                .ok()
                .is_some_and(|date| {
                    let date = date.date_naive();
                    date >= week_start && date <= week_end
                })
        })
        .collect::<Vec<_>>();
    let average_score = (!current.is_empty())
        .then(|| current.iter().map(|attempt| attempt.score).sum::<u32>() / current.len() as u32);
    let hint_free_rate = (!current.is_empty()).then(|| {
        current
            .iter()
            .filter(|attempt| attempt.submission.hints_used == 0)
            .count() as u32
            * 100
            / current.len() as u32
    });
    let average_seconds = (!current.is_empty()).then(|| {
        current
            .iter()
            .map(|attempt| attempt.submission.elapsed_seconds)
            .sum::<u32>()
            / current.len() as u32
    });
    let mut result_counts = BTreeMap::new();
    for attempt in &current {
        *result_counts
            .entry(attempt.result_kind.clone())
            .or_insert(0) += 1;
    }
    let mut weak_tags = tasks
        .iter()
        .filter(|task| {
            current
                .iter()
                .any(|attempt| attempt.task_id == task.id && attempt.score < 80)
        })
        .flat_map(|task| task.tags.clone())
        .collect::<Vec<_>>();
    weak_tags.sort();
    weak_tags.dedup();
    weak_tags.truncate(5);
    let mastered_tasks = current.iter().filter(|attempt| attempt.mastered).count();
    let parent_summary = match average_score {
        None => "本周还没有完成 U10 拆棋，先完成一次 40 分钟训练建立基线。".into(),
        Some(score) => format!(
            "本周完成 {} 次作答，平均 {} 分，无提示完成率 {}%。",
            current.len(),
            score,
            hint_free_rate.unwrap_or(0)
        ),
    };
    let next_focus = if result_counts.get("missedCounterplay").copied().unwrap_or(0) > 0 {
        "下周优先训练落子前的将军、吃子和强制反击检查。"
    } else if !weak_tags.is_empty() {
        "下周围绕薄弱标签做个人棋谱与同类专题交叉复练。"
    } else {
        "继续保持先列候选、再计算主要反击的作答顺序。"
    };
    WeeklyLearningReportDto {
        week_start: week_start.to_string(),
        week_end: week_end.to_string(),
        attempts: current.len(),
        average_score,
        hint_free_rate,
        average_seconds,
        mastered_tasks,
        result_counts,
        weak_tags,
        parent_summary,
        next_focus: next_focus.into(),
    }
}

pub fn infer_opening_repertoire(mut samples: Vec<OpeningSample>) -> OpeningRepertoireDto {
    samples.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    samples.truncate(20);
    fn systems(samples: &[OpeningSample], side: &str) -> Vec<OpeningSystemDto> {
        let mut grouped = BTreeMap::<String, Vec<&OpeningSample>>::new();
        for sample in samples.iter().filter(|sample| sample.side == side) {
            grouped.entry(sample.opening_name.clone()).or_default().push(sample);
        }
        let mut result = grouped
            .into_iter()
            .filter(|(_, games)| games.len() >= 3)
            .map(|(name, games)| {
                let qualities = games.iter().filter_map(|sample| sample.average_quality).collect::<Vec<_>>();
                let average_quality = (!qualities.is_empty()).then(|| {
                    (qualities.iter().map(|score| u32::from(*score)).sum::<u32>() / qualities.len() as u32) as u8
                });
                let typical_deviation = games.iter().rev().find_map(|sample| sample.typical_deviation.clone());
                let training_mode = if typical_deviation.is_some() { "opening-deviation" } else { "standard-route" };
                let wins = games.iter().filter(|sample| {
                    matches!((sample.side.as_str(), sample.outcome.as_deref()), ("red", Some("1-0")) | ("black", Some("0-1")))
                }).count() as u32;
                let draws = games.iter().filter(|sample| sample.outcome.as_deref() == Some("1/2-1/2")).count() as u32;
                let losses = games.iter().filter(|sample| {
                    matches!((sample.side.as_str(), sample.outcome.as_deref()), ("red", Some("0-1")) | ("black", Some("1-0")))
                }).count() as u32;
                let recent = games.iter().take(2).filter_map(|sample| sample.average_quality).collect::<Vec<_>>();
                let earlier = games.iter().skip(2).filter_map(|sample| sample.average_quality).collect::<Vec<_>>();
                let recent_trend = match (recent.is_empty(), earlier.is_empty()) {
                    (false, false) => {
                        let latest = recent.iter().map(|score| i32::from(*score)).sum::<i32>() / recent.len() as i32;
                        let previous = earlier.iter().map(|score| i32::from(*score)).sum::<i32>() / earlier.len() as i32;
                        if latest - previous >= 8 { "improving" } else if previous - latest >= 8 { "declining" } else { "stable" }
                    }
                    _ => "stable",
                };
                OpeningSystemDto {
                    name,
                    games: games.len() as u32,
                    wins,
                    draws,
                    losses,
                    average_quality,
                    recent_trend: recent_trend.into(),
                    typical_deviation,
                    training_mode: training_mode.into(),
                }
            })
            .collect::<Vec<_>>();
        result.sort_by(|left, right| {
            right
                .games
                .cmp(&left.games)
                .then(left.name.cmp(&right.name))
        });
        result
    }
    let red = systems(&samples, "red");
    let black = systems(&samples, "black");
    let enough_data = !red.is_empty() || !black.is_empty();
    OpeningRepertoireDto {
        sampled_games: samples.len(),
        red,
        black,
        enough_data,
        note: if enough_data {
            "仅显示最近 20 盘中至少出现 3 次的红黑布局体系。".into()
        } else {
            "个人棋谱样本不足，暂用内置常见布局专题，不生成个人薄弱结论。".into()
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answer_classification_detects_rank_and_missed_reply() {
        let submission = GuidedAnalysisSubmission {
            chosen_move: "h2e2".into(),
            predicted_line: vec!["h2e2".into(), "a9a8".into()],
            ..Default::default()
        };
        let result = classify_submission(
            Uuid::nil(),
            &submission,
            vec![GuidedEngineLine {
                depth: Some(22),
                score_cp: Some(86),
                mate: None,
                multipv: 1,
                notation: vec![],
                pv: vec!["h2e2".into(), "h9g7".into()],
            }],
        );
        assert_eq!(result.chosen_rank, Some(1));
        assert_eq!(result.result_kind, "missedCounterplay");
        assert!(result.missed_counterplay);
    }

    #[test]
    fn daily_plan_is_forty_minutes_and_keeps_the_sixty_forty_contract() {
        let plan = daily_plan(&LearningProfile::u10_default(), &[], &[], Utc::now());
        assert_eq!(plan.total_minutes, 40);
        assert_eq!(
            plan.segments
                .iter()
                .map(|segment| segment.minutes)
                .collect::<Vec<_>>(),
            vec![10, 8, 12, 7, 3]
        );
        assert_eq!(plan.segments[0].target_tags, vec!["残局打底", "残局处理"]);
        assert!(plan.segments[2].completion_hint.contains("不足三候选"));
        assert_eq!((plan.personal_ratio, plan.thematic_ratio), (60, 40));
    }

    #[test]
    fn answer_classification_tags_candidate_shortage_without_blocking() {
        let submission = GuidedAnalysisSubmission {
            chosen_move: "h2e2".into(),
            candidates: vec!["h2e2".into()],
            predicted_line: vec!["h2e2".into(), "h9g7".into()],
            ..Default::default()
        };
        let result = classify_submission(
            Uuid::nil(),
            &submission,
            vec![GuidedEngineLine {
                depth: Some(18),
                score_cp: Some(20),
                mate: None,
                multipv: 1,
                notation: vec![],
                pv: vec!["h2e2".into(), "h9g7".into()],
            }],
        );
        assert!(result.theory_signals.contains(&"候选不足".into()));
        assert!(result.theory_signals.contains(&"候选着计算".into()));
    }

    #[test]
    fn opening_repertoire_requires_three_occurrences_per_side() {
        let samples = [
            ("red", "仙人指路"),
            ("red", "仙人指路"),
            ("red", "仙人指路"),
            ("black", "卒底炮"),
            ("black", "卒底炮"),
        ]
        .into_iter()
        .map(|(side, name)| OpeningSample {
            game_id: Uuid::new_v4(),
            side: side.into(),
            opening_name: name.into(),
            updated_at: "2026-08-11".into(),
            average_quality: Some(72),
            typical_deviation: None,
            outcome: None,
        })
        .collect();
        let profile = infer_opening_repertoire(samples);
        assert_eq!(profile.red[0].name, "仙人指路");
        assert!(profile.black.is_empty());
    }
}
