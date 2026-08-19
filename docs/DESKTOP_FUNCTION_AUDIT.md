# 桌面端功能审计

审计日期：2026-08-11。范围为桌面端所有可见菜单、工具栏、对话框与复盘工作台操作。审计方式是追踪前端入口、`ChessPlatform` 调用、Tauri command 和本地状态或 SQLite 结果；不对真实第三方窗口、账户或网络服务执行操作。

## 产品分层（2026-08-14）

- **复盘（默认）**：录谱、归档、整局报告、关键着法和训练闭环。
- **研究**：引擎、多引擎、开局库、飞刀、大师棋谱与变例；连线归入“研究实验”，持续采集和外部点击当前仅 macOS 实验。
- **训练**：U10、任务、间隔复习、家长周报和学习档案；与复盘共用本地棋谱和报告。

Windows x64 与 macOS Apple Silicon 的真实 Release 验收统一记录在 [跨平台验收矩阵](PLATFORM_ACCEPTANCE_MATRIX.md)。Web/PWA 是最小离线棋谱范围，不宣称支持桌面本地引擎、报告、训练、资料库或连线。

| 功能 | 状态 | 调用链与结果 | 验证方式 / 限制 |
| --- | --- | --- | --- |
| 新建、手动录谱、走子、注释、变招、设主线、删除 | 已本地验证 | `App.tsx` -> `platform/index.ts` -> `new_game`、`play_move`、`update_comment`、`set_mainline`、`delete_node` -> SQLite 棋谱树 | 删除有二次确认；结构变更会取消报告并重新读取，防止旧报告错用。 |
| 棋谱导航、播放、下变、分支下拉 | 已本地验证 | `navigate_to` 与前端 `goToNextBranchPoint`；只改变当前路径 | 不改主线排序或内容。 |
| PGN 打开、文本/FEN 粘贴、PGN/文本/PDF/GIF/SVG 导出 | 已本地验证 | dialog 插件选路径后调用 `open_document`、`import_text`、各 `export_*` command | Finder 取消时不写文件；导出操作有忙碌禁用。 |
| 文件夹、收藏、标签与棋谱库 | 已本地验证 | `list/create/rename/delete_library_folder`、`update_game_library` -> SQLite | 删除自定义文件夹会将棋谱回到未分类；系统文件夹不可删除。 |
| 当前局面分析、候选预览、强制变招、引擎执红/黑、立即出招、引擎擂台 | 已本地验证 | `analyze_position`、`preview_line`、`engine_play_move`、`move_now`、`run_engine_arena` | 未配置引擎、棋谱播放中或已有引擎任务时按钮禁用并提示原因。 |
| 整局报告、过期保护、PDF、关键问题推演 | 已本地验证 / 已修复 | `generate_game_report`、`get_game_report`、`export_game_report_pdf`；报告绑定线路签名和引擎配置 | 过期报告不展示分数、趋势、错误或 PDF；生成中可取消。 |
| 飞刀生成、保存、打开练习 | 已本地验证 | `generate_flyknife_candidates`、`save_flyknife_plan`、`open_flyknife_practice` -> SQLite 与当前棋谱变例 | 候选基于当前 FEN，保存前由后端校验走法；关联当前棋局的方案会回传 `sourceGameId/sourceNodeId`，复盘路线据此显示“飞刀”已完成。 |
| 训练任务、完成状态、学习总结 | 已本地验证 | `generate_training_tasks`、`complete_training_task`、`save_study_session` -> SQLite | 训练只从当前有效报告生成；完成状态可重启恢复。 |
| U10 引导拆棋与学习档案 | 已本地验证 / 引擎条件验收 | `start_guided_analysis` -> 临时 `preview_line` -> 提交后 `analyze_position` -> `submit_guided_analysis` -> SQLite | 提交前不显示引擎答案；问题着法从前一局面开始；报告签名变化时拒绝提交；临时线路不改棋谱。真实 Pikafish 线路需在应用内手工完成一题。 |
| U10 40 分钟计划与间隔复习 | 已本地验证 | `generate_daily_training_plan`、`training_attempts`、`training_review_schedule` | 固定 5/15/10/5/5 分钟、60/40 来源；按 1/3/7 天复习；三次 80+ 且最近两次无提示才掌握。 |
| U10 家长周报与红黑布局画像 | 已本地验证 / 数据条件验收 | `get_weekly_learning_report`、`infer_opening_repertoire_command` | 周报读取本机作答；布局只取最近 20 盘“比赛复盘”，同侧同体系至少 3 次，不足时明确回退专题库。 |
| 云开局库与本地 XQB / ElephantEye | 条件验证 | `query_cloud_opening_book` 需要网络；导入走系统文件选择与 `import_*_opening_book` | 网络失败不影响棋谱；ElephantEye 数据的再分发许可见研究文档，当前只允许本地学习路径。 |
| 大师棋谱与同步账号 | 账号/网络门槛 | 菜单先检查登录状态，再进入 `MasterLibraryDialog` 或 `sync_now` | 未登录时禁用或引导登录；未对真实账号执行验收。 |
| 窗口连线、截图识别、自动走子 | 权限门槛 | `start_link_session`、稳定帧/棋规校验、`confirm_link_engine_move` | macOS 需屏幕录制；确认/自动走子还需辅助功能。低置信度、跳步、过期候选会暂停且不得入谱。真实第三方窗口仅手工验收。 |
| 桌面自动识别 | 条件验证 | `desktopDetect` -> 持续屏幕采集与 YOLO 棋盘识别 | 需屏幕录制和可审计模型；不同网站样式、缩放和反作弊页面仍是人工验收风险。 |
| 实体棋盘照片 | 已明确范围 | 本地文件选择 -> `recognize_link_image_file` | 已将 UI 从“实体棋盘相机”更正为“实体棋盘照片”；实时相机采集为后续阶段。 |
| 皮肤、布局、引擎与同步偏好 | 已本地验证 | `save_desktop_preferences` -> SQLite 偏好 | 重启恢复；复盘界面继承简洁/专业既有主题变量。 |
| 关于、版本、构建时间 | 已本地验证 | `get_app_info` -> About 对话框 | 不依赖网络。 |
| 紧凑浮窗 | 条件验证 | `open_compact_floating_panel` / `return_compact_floating_panel` | 依赖系统窗口置顶支持；进入复盘会先收回引擎浮窗，避免重复分析界面。 |

## 本轮修复

- 复盘工作台改为复用 `surface`、`text`、`border`、`accent` 等主题变量：简洁布局使用浅色面板，专业布局使用既有深色中性面板，不再使用独立墨绿视觉。
- 复盘洞察区从固定网格行改为弹性内容区。报告进度或“报告已过期”提示出现时，报告、趋势、问题和训练内容仍可滚动，不会被截断。
- 过期报告继续保留“重新生成”提示，但不再显示旧评分、趋势、错误、完整报告或 PDF 导出。
- 实体棋盘入口更正为“实体棋盘照片”；实时摄像头未实现，不再伪装为已可用。
- 飞刀方案的棋谱关联字段已透传至桌面端；复盘路线不再将已保存的当前棋局飞刀错误显示为未完成。
- 新增 U10 全国少年赛模板、12 张原创短棋理卡、先答后揭示拆棋、1/3/7 复习、家长周报和红黑布局画像；成人研究模式保持不变。

## 回归命令

```sh
cd apps/desktop
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run src/ReviewWorkspace.test.tsx src/LinkSessionDialog.test.tsx src/DesktopMenuBar.test.tsx src/DesktopDialogs.test.tsx
./node_modules/.bin/vite build

cd ../..
cargo check -p xiangqi-desktop
cargo test --workspace
```

2026-08-11 回归结果：前端 36 个测试文件、317 项测试全部通过，TypeScript 与 Vite 生产构建通过；Rust 工作区除账号 HTTP 回环测试在沙箱内被拒绝监听外全部通过。该测试在允许 `127.0.0.1` 临时端口后单独复跑通过。
