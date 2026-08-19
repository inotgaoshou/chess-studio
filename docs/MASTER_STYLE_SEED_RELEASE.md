# 大师风格画像随包发布与个人数据边界

## 目标

安装包可以随带一份干净的系统种子数据，让新用户首次打开 App 时离线拥有大师风格启发能力；用户自己的棋谱、复盘、反馈、收藏和训练记录仍只保存在本地 SQLite，按用户需要备份或导出。

## 随包发布的数据

随包资源目录：

```text
apps/desktop/src-tauri/resources/master-style/
  seed-manifest.json
  master-style-profiles.json
  master-style-samples.jsonl
  master-style-analysis.jsonl
  README.md
```

当前种子包含 4 位大师画像：

- 赵鑫鑫
- 许银川
- 王天一
- 郑惟桐

这些文件只包含公开棋谱结构化样本、Pikafish 摘要和画像统计，不包含原始网页 HTML，也不包含用户个人数据。

## 用户本地数据

App 的用户库仍是：

```text
~/Library/Application Support/cn.xiangqi.studio/xiangqi.sqlite3
```

其中：

- `master_style_profiles` / `master_style_samples`：系统种子导入后的大师画像与样本。
- `master_style_matches`：用户复盘时产生的命中记录，属于个人数据。
- `games` / `move_nodes` / `game_reports` / `training_tasks` / `theory_card_feedback` 等：用户个人棋谱、报告、训练和反馈。

发布安装包时不要直接打包某台机器上的 `xiangqi.sqlite3`。应只打包 `resources/master-style` 里的干净 seed。

## 构建和更新 seed

训练更多大师或补算更多样本后，运行：

```bash
pnpm seed:master-style
```

脚本会从 `.theory-work/master-style` 重新生成随包资源，并更新 `seed-manifest.json` 的 `seedId`、计数和文件校验。

App 启动时会读取 bundled `seed-manifest.json`：

1. 如果本地 `sync_state.builtin_master_style_seed_id` 已等于当前 `seedId`，跳过导入。
2. 如果 `seedId` 变化，自动 upsert `master_style_profiles` 和 `master_style_samples`。
3. 不清空、不覆盖用户个人棋谱、报告、反馈、训练记录。

## 备份建议

用户个人数据备份以本地 SQLite 为主：

```text
~/Library/Application Support/cn.xiangqi.studio/xiangqi.sqlite3
```

后续可以在 App 内增加“导出个人数据”入口，导出内容应包含用户私有棋谱、报告、训练和反馈；系统 seed 可通过安装包恢复，不必放进个人备份。
