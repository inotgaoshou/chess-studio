# 棋理三部曲原则卡与棋谱分析模型

本文定义从《赵鑫鑫棋理三部曲》OCR 结果到棋谱/Pikafish 分析的中间模型。它不保存书本长文本，只描述短原则卡、局面特征和引擎信号如何关联。

## 1. 数据分层

```text
PDF 扫描页
  -> OCR 页级文本缓存
  -> 待人审候选卡
  -> 已确认短原则卡
  -> 棋谱节点解释 / 复习任务 / 训练题
```

只有“已确认短原则卡”可以进入应用判断。OCR 原文只用于本地复核，不作为自动结论直接展示。

## 2. 原则卡字段

```ts
type QiliPrincipleCard = {
  id: string;
  phase: "opening" | "middle" | "endgame" | "all";
  title: string;
  summary: string;
  appliesWhen: string;
  risk: string;
  tags: string[];
  engineCorrelation: EngineCorrelation[];
  source: {
    label: "赵鑫鑫棋理三部曲";
    book: string;
    lessonNo?: number;
    lessonTitle?: string;
    pageStart: number;
    pageEnd: number;
    review: "已确认";
  };
};
```

`summary`、`appliesWhen`、`risk` 必须是短摘要，不照搬长段原文。

## 3. 引擎信号

```ts
type EngineCorrelation =
  | "opening_deviation"
  | "plan_without_counterplay_check"
  | "development_lag"
  | "wrong_battlefield"
  | "missed_candidate"
  | "missed_tactic"
  | "line_control"
  | "pin_or_restraint"
  | "exchange_miscalculation"
  | "endgame_theoretical_win_draw"
  | "pawn_efficiency"
  | "king_position";
```

这些信号由棋谱节点和 Pikafish 分析共同生成：

- `opening_deviation`：开局阶段脱离已学体系，且后续计划标签缺失。
- `wrong_battlefield`：开局或中局主动在不利侧翼/线路决战，Pikafish 评价下降。
- `plan_without_counterplay_check`：PV 显示对手有直接反击、将军、吃子或抢先。
- `missed_candidate`：当前着法与引擎首选差距大，且候选线主题可归类。
- `missed_tactic`：出现漏杀、漏捉、牵制、抽将、闪击等战术信号。
- `exchange_miscalculation`：兑子后评价明显变差，或残局理论结果改变。
- `endgame_theoretical_win_draw`：残局阶段评价和子力形态提示理论胜/和/负需要核验。

## 4. 阶段匹配

### 开局

重点解释：

- 是否有明确战略方向；
- 子力是否协调；
- 是否只背变化而没有检查对方反击；
- 是否在错误战场过早开战；
- 是否因求快而忽略“选择是否正确”。

适合标签：

```text
开局, 战略, 决战方向, 子力协调, 反击条件, 以快打慢, 布局类型
```

### 中局

重点解释：

- 是否漏算候选着；
- 是否未控制关键线路；
- 是否没有形成局部以多打少；
- 是否忽视牵制、拦截、底线和将军手段；
- 进攻子力是否足够。

适合标签：

```text
中局, 候选着, 计算, 线路控制, 牵制, 以多打少, 先手, 攻防转换
```

### 残局

重点解释：

- 子力是否达到理论胜和临界；
- 兵卒效率是否够；
- 将位是否支持进攻/防守；
- 兑子是否改变胜和结果；
- 是否存在等招、牵制、拦截。

适合标签：

```text
残局, 理论胜和, 兵卒效率, 将位, 兑子, 等招, 牵制, 临界点
```

## 5. 节点解释模板

```text
第 N 手：{side} {playedMove}

引擎证据：
- Pikafish 建议：{bestMove}
- 评价变化：{beforeScore} -> {afterScore}
- 主变：{pv}

棋理解释：
- 命中原则：{card.title}
- 为什么相关：{card.appliesWhen}
- 本手风险：{card.risk}

复习定位：
- {card.source.book}，第 {pageStart}-{pageEnd} 页
- 标签：{tags}

训练任务：
- 开局 / 计算 / 残局 / 复盘 中选择薄弱项
- 生成 1-3 道同主题错题
```

## 6. 当前样例可提炼方向

根据已经 OCR 的布局书开篇样页，可先形成以下“待确认方向”，等待 OCR 完成后用页码范围复核：

- 布局不是单纯背变化，而是先确定战略和决战方向。
- 学布局要把“选择正确”放在“速度快”之前。
- 开局计划必须检查对手反击条件，不能只看己方出子。
- 复杂变化应归纳到原则和类型，再回到具体着法验证。

这些还不是正式卡；正式进入应用前，需要人工确认标题、摘要、适用条件、风险和页码范围。
