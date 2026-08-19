# 赵鑫鑫棋理三部曲 PDF 本地整理流程

目标：把用户本地的《布局棋理48讲》《中局棋理48讲》《残局棋理48讲》扫描版 PDF，整理成可服务于棋谱复盘的“短原则卡”。原始 OCR 文本只保存在本机 `.theory-work/`，不进入应用源码、不导出、不上传。

## 输入

PDF 源文件位于：

```text
/Users/chenyubin/Documents/chess/qili/
```

当前三本书均为扫描版 PDF，没有可直接抽取的文本层，需要 OCR。

## 输出目录

```text
xiangqi-assistant/
  .theory-work/
    qili-pdf/
      manifest.json                    # 三本书的页数、来源、阶段
      ocr-pages/
        opening/0001.txt               # 布局棋理页级 OCR
        middle/0001.txt                # 中局棋理页级 OCR
        endgame/0001.txt               # 残局棋理页级 OCR
      card-candidates/
        qili-pdf-candidates.jsonl      # 待人工确认原则卡候选
        qili-pdf-candidates.md         # 便于阅读的人审稿
```

## OCR 命令

先跑小样：

```bash
node tools/qili-pdf-ocr.mjs --book=opening --from=10 --limit=3
node tools/qili-pdf-cards.mjs
```

分阶段跑完整三本，避免一次性耗电太猛：

```bash
node tools/qili-pdf-ocr.mjs --book=opening
node tools/qili-pdf-ocr.mjs --book=middle
node tools/qili-pdf-ocr.mjs --book=endgame
node tools/qili-pdf-cards.mjs
```

脚本默认单进程、可断点续跑；已存在的页级 OCR 会自动跳过。若某页 OCR 质量不佳，可用 `--force --from=<页码> --to=<页码>` 重跑。

常用参数：

- `--book=opening|middle|endgame|all`
- `--from=10`
- `--to=30`
- `--limit=5`
- `--dpi=180`
- `--psm=4`
- `--force`
- `--dry-run`

## 原则卡格式

最终进入应用的不是书本文字，而是人工确认后的短摘要卡：

```json
{
  "id": "qili-opening-001-strategy-battlefield",
  "phase": "opening",
  "title": "布局先定战略",
  "summary": "布局的重点不是背完整变化，而是判断主要决战方向、子力协调和反击条件。",
  "appliesWhen": "开局脱离熟悉定式，或候选着很多但计划不清时。",
  "risk": "只背招法而不判断对方反击，容易在变招后失去主动。",
  "tags": ["开局", "战略", "决战方向", "子力协调"],
  "source": {
    "label": "赵鑫鑫棋理三部曲",
    "book": "赵鑫鑫布局棋理48讲",
    "pageStart": 1,
    "pageEnd": 3,
    "review": "已确认"
  }
}
```

## 如何接到棋谱 / Pikafish 分析

棋谱复盘时，对每个节点生成三个层次的证据：

1. 局面事实：阶段、回合数、子力、将帅安全、兵线、车路/肋道/中路控制、是否有分支。
2. 引擎证据：Pikafish 首选、PV、分数变化、是否漏杀、交换后评分、深度。
3. 棋理匹配：用阶段和标签匹配已确认原则卡。

匹配规则建议：

- 开局：重点匹配“脱离体系、战略方向、子力协调、兵线/反击条件”。
- 中局：重点匹配“候选着、战术主题、以多打少、牵制、线路控制、先手反击”。
- 残局：重点匹配“理论胜和、兵卒效率、将位、牵制、等招、兑子后结果”。

输出给用户时采用这种结构：

```text
第 N 手：你的着法 X
引擎建议：Y，评价从 ... 变为 ...
棋理解释：这步的问题不是单纯亏分，而是违反了「原则卡标题」：短摘要。
复习定位：赵鑫鑫中局棋理48讲，第 A-B 页，标签：牵制 / 候选着 / 线路控制。
训练建议：生成 3 道同主题错题，加入“中局-计算”薄弱项。
```

这样应用可以把 PDF、视频字幕、自己的棋谱和 Pikafish 串起来，但真正参与自动判断的始终是“已确认短原则卡”，不是未校对 OCR 原文。

## 棋谱驱动的按需提炼流程

不建议先把 1146 页候选全部人工审核。更高效的流程是先拆自己的棋：

```bash
# 1. 从一个已生成的整局复盘 JSON 反查三本棋理 OCR 页
node tools/qili-game-driven.mjs --report=/path/to/game-report.json

# 或直接从桌面端 SQLite 读取最近 20 份整局复盘报告
node tools/qili-game-driven.mjs --db=/path/to/xiangqi.sqlite
```

输出：

```text
.theory-work/qili-pdf/game-driven/
  qili-demand-analysis.md          # 人工审核用：问题手、Pikafish 证据、召回页
  qili-demand-cards.draft.jsonl    # 待确认短原则卡草稿
```

审核时只改 `qili-demand-cards.draft.jsonl`：

- 保留原创短摘要，不复制长段 OCR；
- 把可信条目的 `reviewStatus` 从 `needs_review` 改成 `approved`；
- 精修 `title / summary / appliesWhen / risk / tags / engineCorrelations`；
- 确认 `source.book / pageStart / pageEnd` 能回到对应 PDF 页。

确认后导入 SQLite：

```bash
node tools/qili-pdf-import.mjs \
  --input=.theory-work/qili-pdf/game-driven/qili-demand-cards.draft.jsonl \
  --db=/path/to/xiangqi.sqlite
```

导入是幂等的：同一张卡使用稳定 `stableId`，重复导入不会重复生成；内容修改后会递增版本，旧复盘命中仍保留当时版本。
