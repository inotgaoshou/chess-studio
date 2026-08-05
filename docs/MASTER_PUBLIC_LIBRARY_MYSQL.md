# 服务端 MySQL 大师公开棋谱库

服务端大师库采用“全局共享公开库 + 用户私有引用”的模型。公开棋谱只入库一次，用户收藏、训练引用和个人笔记通过用户关联表保存，不混入现有 `games + operations` 私有同步日志。

## 数据流

1. 采集器输入来源、棋手名和来源棋手 ID，例如 `gdchess.com / 赵鑫鑫 / 0074`。
2. 采集列表页和单局页，解析成统一 ICCS 着法数组。
3. 用棋手、日期、赛事和走法 hash 生成 `fingerprint`。
4. 写入 `master_players`、`master_games`、`master_game_sources`。
5. 展开每一手写入 `master_game_moves`，同时为大师实际走子写入 `master_position_samples`。
6. 后续 Pikafish MultiPV 分析写入 `master_position_analysis`。

## 主要表

- `master_players`：公开棋手索引，按 `(source_site, source_player_id)` 去重。
- `master_games`：棋谱主记录，保留 `moves_json` 便于导入导出，并用 `fingerprint` 全局去重。
- `master_game_sources`：同一棋谱的多个来源 URL。
- `master_game_moves`：逐步展开表，支持按局面、着法、阶段检索。
- `master_position_samples`：大师实际选择过的局面样本。
- `master_position_analysis`：Pikafish 对样本局面的 MultiPV 分析。
- `user_master_game_favorites`：用户收藏公开大师棋谱。
- `user_master_training_refs`：用户训练任务引用公开大师局面。

## 导入约束

- 不保存原始网页 HTML，只保存结构化棋谱、来源 URL 和许可说明。
- 重复采集同一页时，`master_games` 不重复；只更新来源和时间。
- 同一盘棋来自多个公开站点时，新增 `master_game_sources`，不新增重复棋谱。
- `moves_json` 与 `master_game_moves` 必须保持半回合数一致。

## 备份与导出

MySQL 层可单独备份大师库相关表：

```bash
mysqldump xiangqi \
  master_players \
  master_games \
  master_game_sources \
  master_game_moves \
  master_position_samples \
  master_position_analysis \
  user_master_game_favorites \
  user_master_training_refs \
  > master-public-library.sql
```

应用层建议导出为目录或 zip：

```text
master-library-export/
  manifest.json
  players.jsonl
  games.jsonl
  sources.jsonl
  moves.jsonl
  samples.jsonl
  analysis.jsonl
  pgn/
```

导入时使用这些键去重：

- `master_players`：`(source_site, source_player_id)`
- `master_games`：`fingerprint`
- `master_game_sources`：`source_url`
- `master_game_moves`：`(game_id, ply)`
- `master_position_samples`：`(master_player_id, game_id, ply)`
