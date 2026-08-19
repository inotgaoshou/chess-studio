# 赵鑫鑫公开棋谱本地训练集

目标：从公开可访问页面整理赵鑫鑫棋谱，生成本地 PGN/JSONL/局面样本，用于“赵鑫鑫风格启发”的候选着重排器。

## 边界

- 只采集公开网页，不绕过登录、付费、人机验证或反爬。
- 广象网可从赵鑫鑫棋手棋谱页抓取公开索引，再解析单局 `MOVE_STR` 棋谱。
- xqipu 若返回人机验证，只记录为索引源，不自动解析正文。
- 东萍若连接超时或页面不可稳定访问，只记录为可选来源。
- 输出只能标注为“赵鑫鑫风格启发”，不能冒充赵鑫鑫本人。
- 原始网页和完整棋谱库默认只用于个人本地学习，不打包发布。

## 采集

```bash
node tools/zhao-public-games.mjs collect --max-games=50
```

输出目录：

```text
.theory-work/zhao-games/
  zhao-games.index.jsonl       # 来源索引、失败/跳过原因
  zhao-games.normalized.jsonl  # 去重后的结构化棋谱
  zhao-pikafish-jobs.jsonl     # 旧版赵鑫鑫实战着局面样本
  style-profile.json           # 初版风格画像
  training-report.md           # 人工查看报告
  pgn/*.pgn                    # 统一 ICCS PGN
```

可追加公开入口：

```bash
node tools/zhao-public-games.mjs collect \
  --seed-url=https://www.xiangqiqipu.com/Category/View-42812.html \
  --max-games=100
```

广象网赵鑫鑫棋手页已经是默认源。如果只想从广象网验证一小批：

```bash
node tools/zhao-public-games.mjs collect \
  --seed-url=http://www.gdchess.com/xqgame/xqpgame.asp?pid=0074 \
  --seed-only \
  --max-games=20 \
  --gdchess-index-pages=1
```

广象网页面显示赵鑫鑫全部棋谱约 1742 盘、每页 20 盘、共 88 页。若想尽量拉全本地索引，可在确认网络稳定、仅个人学习使用的前提下提高参数：

```bash
node tools/zhao-public-games.mjs collect \
  --seed-url=http://www.gdchess.com/xqgame/xqpgame.asp?pid=0074 \
  --seed-only \
  --max-games=1800 \
  --gdchess-index-pages=88 \
  --delay-ms=800
```

参数说明：

- `--max-games`：最多解析并保存多少盘去重后的棋谱。
- `--seed-url` / `--seed-only`：指定入口；加 `--seed-only` 时只抓指定入口，适合单独验证广象网。
- `--gdchess-index-pages`：最多翻多少页广象网赵鑫鑫个人棋谱列表。
- `--delay-ms`：每次请求后的等待毫秒数，建议保留温和访问。

## 画像重建

如果已经有 `zhao-games.normalized.jsonl`：

```bash
node tools/zhao-public-games.mjs profile
```

画像会统计：

- 赵鑫鑫执红/执黑比例；
- 结果分布；
- 高频开局；
- 按开局/中局/残局的赵鑫鑫实战着样本；
- 子力走动倾向。

## 后续接 Pikafish

新版统一走 `.theory-work/master-style/master-pikafish-jobs.jsonl`，每行是一条赵鑫鑫实战着样本：

```json
{
  "beforeFen": "...",
  "playedMove": "c3c4",
  "phase": "opening",
  "zhaoSide": "red"
}
```

后续批量分析时，对每个 `beforeFen` 跑 Pikafish MultiPV：

```bash
node tools/zhao-pikafish-analyze.mjs \
  --jobs=.theory-work/master-style/master-pikafish-jobs.jsonl \
  --out=.theory-work/master-style/master-style-analysis.jsonl \
  --depth=24 \
  --multipv=5 \
  --limit=20
```

输出：

```text
.theory-work/master-style/master-style-analysis.jsonl
```

```text
正例：playedMove
对比：同局面 Pikafish MultiPV 其它候选
目标：在引擎可接受范围内，重排出更接近赵鑫鑫公开棋谱的候选。
```

推荐公式：

```text
推荐分 = 引擎分 + 风格相似分 + 棋理卡匹配分 - 风险惩罚
```

棋力仍以 Pikafish 为底座，风格分只做候选重排。
