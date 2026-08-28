# AGENTS.md

本文件给后续 Codex/agent 使用，目标是快速理解当前项目能力、主要代码入口、验证命令和工作注意事项。除非子目录另有更近的 `AGENTS.md`，本说明适用于整个仓库。

## 项目定位

`Xiangqi Studio` 是桌面优先、离线可用的中国象棋打谱、拆棋、引擎分析和复盘报告工具。

核心原则：

- 桌面端优先，Tauri 2 + React 前端 + Rust 本地能力。
- 本地 SQLite 是桌面端主存储，打谱、分支、注释和分析缓存都应先保证本地可靠。
- Web/PWA 是实验方向，主要用于轻量打谱和 IndexedDB 离线缓存，不在手机本地运行 Pikafish。
- 引擎分析只通过 UCI/UCCI 进程边界交互；React 不直接解析引擎原始输出。
- 棋谱节点以 UUID 树保存，回退/跳转必须是非破坏性导航，不能删除后续主线、变招或分支。

## 技术栈与模块

```text
apps/desktop           React + Tauri 2 桌面端 UI
apps/server            Axum + MySQL 同步服务与服务端分析
crates/xiangqi-core    中国象棋规则、FEN、ICCS、中文着法
crates/manual          UUID 棋谱树、主线、变招、tombstone 删除
crates/manual-format   PGN/中文棋谱导入导出，XQF/CBR 检测边界
crates/web-core        Web/PWA 的 WASM 适配层
crates/engine-protocol UCI/UCCI 引擎进程协议适配
crates/local-store     SQLite、本地 outbox、分析缓存、同步投影
crates/sync-protocol   客户端/服务端共享同步 DTO
```

重要前端入口：

- `apps/desktop/src/App.tsx`：主工作台、桌面偏好、棋谱/引擎/报告/导出总编排。
- `apps/desktop/src/DesktopDialogs.tsx`：引擎设置、同步、订阅、训练任务等弹窗。
- `apps/desktop/src/ManualTrackView.tsx`：当前默认的高级分支树棋谱、当前局面完整棋谱弹窗。
- `apps/desktop/src/ManualTreeView.tsx`：备用传统树棋谱。
- `apps/desktop/src/ManualMoveRows.tsx`：历史着法、后续保留和同级分支行展示。
- `apps/desktop/src/CandidateLine.tsx`、`CandidatePreviewSteps.tsx`、`coachInsights.ts`：候选线、推演预览和私教讲解。
- `apps/desktop/src/MultiEngineComparison.tsx`：多引擎对比展示。
- `apps/desktop/src/GameReportView.tsx`、`gameReport.ts`、`analysisView.ts`：整局报告展示、评分模型和局势图。
- `apps/desktop/src/styles.css`：当前大部分 UI 样式集中在这里，简洁/专业模式隔离也主要在这里。

重要 Tauri/Rust 入口：

- `apps/desktop/src-tauri/src/main.rs`：Tauri commands、桌面状态、引擎分析、报告生成、同步、导出命令。
- `apps/desktop/src-tauri/src/manual_pdf.rs`：手机/微信友好的棋谱 PDF 导出。
- `apps/desktop/src-tauri/src/pdf_report.rs`：整局复盘报告 PDF 导出。
- `apps/desktop/src-tauri/src/gif_export.rs`：棋谱 GIF 回放导出。

## 当前功能清单

### 棋盘与打谱

- 中国象棋标准初始局面、FEN 局面、局面编辑。
- ICCS 着法、中文着法、将军与将帅照面校验。
- 新建棋谱、打开 PGN、保存/另存 PGN。
- FEN 复制、棋谱复制、中文文本/PGN/东萍文本导出。
- 非破坏性导航：上一步、选择旧着法、跳转节点只改变当前节点，不删除后续棋谱。
- 从旧节点新走一步时，原后续主线应保留为分支，不得覆盖或丢失。
- 当前节点支持注释、设为主线、分支排序、显式删除分支。
- 本地自动保存状态包括：本地草稿、保存中、已保存、保存失败/重试。

### 棋谱视图与分支

- 默认棋谱视图为“分支树”，保留“传统树”切换。
- 分支树采用 Git/XMind 风格：主线固定在左侧主干，分支短暂横向展开。
- 当前路径从根到当前节点高亮，非当前路径降权。
- 当前局面下有多个下一着时显示“变招”选择器；点击任一变招立即跳转并收起选择器。
- 选中变招后，如果下一局面还有新的多分支，再显示新的变招选择器。
- 支持“下变”跳到当前路径后续的下一个分支点。
- 棋盘上的分支箭头默认仅在有当前局面可选分支时展示，并支持颜色配置与预览。
- “当前局面”底栏提供紧凑入口查看“从开始到当前局面”的完整路径。
- 完整棋谱弹窗支持：
  - 从起点到当前节点的完整走法；
  - 每步红/黑标识、中文着法、质量分/等级或局面分；
  - 复制；
  - 下载当前路径文本；
  - Esc、遮罩和关闭按钮退出。

### 引擎分析

- 支持本地 UCI/UCCI 引擎探测、握手、`position`/`go`/`bestmove` 流程。
- 仅内置 Pikafish 与固定版本的中国象棋 NNUE；Fairy-Stockfish 不再随应用分发或提供专用适配。
- 内置引擎是应用资源，不应作为用户可删除档案；外部引擎档案可删除，删除只移除档案，不删除本机文件。
- 引擎设置项包括：
  - 线程；
  - Hash；
  - MultiPV；
  - 后续走法半回合数；
  - 搜索模式：固定时间、固定深度、固定节点、持续分析；
  - 搜索限制；
  - 整局复盘深度；
  - 分支箭头颜色；
  - 每步时间；
  - ChessDB 云库开关和地址。
- 默认偏好当前以简洁模式为主，MultiPV 默认 3，整局复盘深度默认 26，每步时间默认 2 秒。
- 自动分析会在落子或节点切换后刷新；停止分析后保留最后一次完整候选。
- 强制变招可排除当前第一候选后重搜。
- 持续分析表示引擎一直算当前局面，直到用户停止或局面切换；自动分析不应默认无限搜索。

### 候选线、推演与私教建议

- MultiPV 候选按用户设置显示，紧凑模式尽量展示 5～10 个后续着法。
- 每条候选显示首着、分数、深度、NPS、Hash、后续 PV 中文着法。
- 候选线私教讲解包括：
  - 当前想法；
  - 可能性；
  - 风险；
  - 后续推演。
- 推演预览是手动触发：
  - 点击某个候选的预览后，只预览该分支；
  - 使用临时棋盘模拟落子；
  - 不写 SQLite；
  - 不修改棋谱树；
  - 不生成真实变招；
  - 退出后恢复真实当前局面。
- 候选推演步数由设置里的“后续走法（半回合）”控制。

### 多引擎对比

- 支持“仅主引擎”和“主引擎 + 对比”两种模式。
- 主引擎负责默认箭头、总评、人机和报告。
- 对比引擎只参与并行对比，不改变主引擎判断。
- 多引擎面板支持收起、弹出和悬浮展示。
- 内置分析只使用 Pikafish；旧版保存的内置 Fairy 标识会迁移回 Pikafish。

### 云库 / 开局库

- 支持 ChessDB 云开局库查询，可配置地址。
- 云库会发送当前 FEN 查询候选着法；网络失败不影响本地棋谱和本地引擎。
- 支持本地 XQB 开局库导入入口和开关列表；具体本地库能力需要按实际样例继续验收。
- 整局报告中有内置经典开局/官着识别能力：
  - 只对标准初始局面参与识别；
  - 官着只增加标记和开局说明；
  - 官着不修改 Pikafish 质量分。

### 人机对弈

- Pikafish/当前主引擎可执红或执黑。
- 支持每步固定时间、立即出招、后台思考。
- 引擎 bestmove 必须再次经过 Rust 棋规校验，然后走普通落子和 SQLite 自动保存流程。
- 新局、导入、局面编辑、节点跳转或停止操作会中断当前引擎对弈。

### 整局复盘报告

- 桌面端使用本地 Pikafish/主引擎生成整局报告。
- 默认报告深度为 26，可在高级设置中调为 8–40。
- 报告进度显示目标深度、当前深度、缓存数量、完成数量等。
- 报告缓存键应区分实际深度、线程、Hash 和引擎指纹，避免不同配置互相覆盖。
- 报告可过期查看：棋谱线路变化后应标记“线路已变化，报告已过期”。
- 报告内容包括：
  - 棋局信息；
  - 实际深度、引擎版本、总耗时、缓存命中；
  - 红黑综合评价；
  - 私教总结；
  - 五维能力雷达图；
  - 局势走势图；
  - 阶段评分；
  - 五档统计；
  - 漏杀统计；
  - 关键问题着法；
  - 评分标准说明。

### 评分体系

- 质量等级统一为五档：`优 / 良 / 中 / 差 / 错`。
- 分档边界固定：
  - `80–100`：优；
  - `60–79`：良；
  - `40–59`：中；
  - `20–39`：差；
  - `0–19`：错。
- 漏杀：质量分固定 0，等级为“错”，同时额外显示“漏杀”标记并进入独立统计。
- `局面分` 是 Pikafish 原始 cp/杀棋信息，正数表示红方占优。
- `质量分` 是该着相对引擎评价造成损失后折算的 0–100 分。
- `综合分` 是一方所有有效着法质量分平均值。
- 局势图使用整数局面分，并说明近似换算：
  - `1000≈一车`；
  - `500≈一马或炮`；
  - `200≈过河兵`；
  - `100≈一兵`；
  - `±50` 内视为可忽略均势区。

### 局势图与评估展示

- 局势图以红方视角显示整数局面分。
- 上方为红优，下方为黑优。
- 评估条红黑比例使用统一换算函数，不应简单用绝对值互换。
- 超出显示范围的分数可钳制到边缘，但 tooltip/文字应保留真实值。
- 当前节点、趋势点、问题着法点击后应定位棋盘和棋谱。

### 导出与分享

- 棋谱文本：PGN、中文文本、东萍棋谱文本。
- 棋谱 PDF：手机/微信友好的棋谱 PDF，不是思维导图；按“主线棋谱 / 变招分支 / 说明”分区展示。
- 当前局面完整路径：弹窗内可复制或下载 `.txt`。
- 变招图 SVG：这是单独功能，表示完整分支图；不要和普通棋谱 PDF 混用。
- GIF：生成当前分支或完整主线动态图。
- 整局复盘报告 PDF：原生 A4 多页 PDF，嵌入 Noto Sans SC 中文字体，包含图表、评分、关键着法和说明。
- PDF/报告导出不得包含引擎路径、SQLite 路径、JWT、同步账号等本机敏感信息。

### 皮肤、布局与窗口

- 支持专业模式和简洁模式；默认偏向简洁模式。
- 专业模式应保留暗色工作台风格；简洁模式应保持浅色、紧凑、类似传统象棋软件布局。
- 专业与简洁样式必须尽量隔离，避免暗黑背景、按钮色、底色互相污染。
- 支持棋盘皮肤和棋子皮肤；皮肤应以文件夹作为目标进行管理。
- 棋子 hover 边框等强提示已被要求弱化/去除，避免干扰棋盘。
- 简洁模式中的引擎分析、棋谱、云库/评估信息支持收起、弹出、悬浮和拖拽。
- 系统级独立浮动窗口需要通过 Tauri 子窗口/浮动窗口实现；返回主窗口时应销毁外部弹窗/浮动内容，避免残留。

### 同步、账号与训练

- 桌面端支持同步账号注册、登录、退出、解绑和服务地址设置。
- JWT 存系统钥匙串，不进入 React DTO，不写 SQLite。
- 本地棋谱库首次登录后绑定账号和同步服务器，不能随意切换。
- SQLite outbox 支持幂等同步。
- 服务端提供 Axum + MySQL 的注册、登录、JWT、同步和服务端 Pikafish 分析。
- 训练任务入口已存在，可从历史报告生成/完成训练任务。

### Web/PWA

- Web/PWA 使用 Rust/WASM 棋规和 IndexedDB。
- 支持离线打谱、缓存和待同步操作。
- Web 不运行本地 Pikafish，整局本地复盘和桌面 PDF 等能力应提示不支持或走浏览器下载 fallback。
- 移动端不会下载或执行本地引擎。

### 打包与发布

- 本地 macOS 可用 `scripts/build-macos-release.sh` 打包。
- 正式 macOS DMG 分发需要 Developer ID 签名和 Apple 公证，否则普通用户可能看到“已损坏/无法打开”。
- GitHub Actions Release 当前构建 Windows x64 和 macOS Apple Silicon。
- Windows x64 Release 内置 Pikafish SSE4.1/POPCNT 和固定版本 `pikafish.nnue`。
- macOS Apple Silicon Release 内置 Apple Silicon Pikafish 和固定版本 `pikafish.nnue`。
- Linux 在 GitHub Release 暂未启用打包，等需要时再启用。
- Pikafish 必须从独立资源目录打包：

```text
apps/desktop/src-tauri/resources/pikafish/
```

- 构建前必须通过 `scripts/verify-embedded-engine-resources.sh <platform>` 校验对应平台引擎和 NNUE，避免缺引擎或混用网络文件的安装包流出。

- 安装包不得包含 Fairy-Stockfish、Fairy NNUE 或非目标平台的 Pikafish 二进制。
- 分发第三方引擎、NNUE、字体时必须保留相应许可证和 `THIRD_PARTY_NOTICES.md`。

## 重要偏好默认值

当前关键默认偏好在 `apps/desktop/src/App.tsx` 的 `defaultDesktopPreferences`：

- `threads`: 2
- `hashMb`: 256
- `multipv`: 3
- `candidateLineMoves`: `DEFAULT_CANDIDATE_LINE_MOVES`
- `searchMode`: `infinite`
- `moveTimeMs`: 2000
- `autoAnalyze`: true
- `layoutMode`: `compact`
- `manualViewMode`: `track`（UI 文案为“分支树”）
- `colorTheme`: `dark`
- `reportDepth`: 26
- `cloudBookEnabled`: true
- `cloudBookUrl`: `https://www.chessdb.cn/chessdb.php`
- `analysisEngineMode`: `single`

修改偏好时同步检查：

- `apps/desktop/src/platform/types.ts`
- `apps/desktop/src/App.tsx`
- `apps/desktop/src/DesktopDialogs.tsx`
- 相关测试里的默认偏好 fixture

## 常用命令

桌面开发：

```bash
./scripts/dev-desktop.sh
```

不要用 `cargo run -p xiangqi-desktop` 作为桌面开发启动方式；它可能加载上一次嵌入的前端构建。`scripts/dev-desktop.sh` 会选择 Node 22+ 并使用 Tauri 的开发流程，使 Rust 壳连接当前 Vite 源码。

前端：

```bash
node /Users/chenyubin/.cache/node/corepack/pnpm/11.7.0/bin/pnpm.cjs --filter xiangqi-desktop-ui test
node /Users/chenyubin/.cache/node/corepack/pnpm/11.7.0/bin/pnpm.cjs --filter xiangqi-desktop-ui build
```

Rust：

```bash
cargo check -p xiangqi-desktop
cargo check -p xiangqi-server
cargo test --workspace
```

Web/PWA：

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
node /Users/chenyubin/.cache/node/corepack/pnpm/11.7.0/bin/pnpm.cjs --filter xiangqi-desktop-ui web:build
```

发布：

```bash
PNPM_BIN=pnpm SIGN_AND_NOTARIZE=0 ./scripts/build-macos-release.sh
git tag v1.0.0
git push origin v1.0.0
```

## Agent 工作注意事项

- 当前工作树经常有大量未提交改动。不要用 `git reset --hard`、`git checkout -- .` 或批量覆盖。
- 修改代码前先用 `rg` 定位，不要盲目改样式大块区域。
- 涉及代码理解时优先用 CodeGraph；写代码前再读具体文件片段。
- UI 迭代通常要重启 Tauri 桌面端验证，旧进程占用 1420 时先精准查 PID，再只结束对应进程。
- 用户偏好是“直接可见、紧凑、少遮挡”，特别是简洁模式。
- 棋谱/分支相关改动不能破坏非破坏性导航和 SQLite 自动保存。
- 任何“预览/推演”必须明确不落子、不写 SQLite、不修改棋谱树。
- 引擎路径、JWT、SQLite 路径、同步账号等敏感信息不得写入 PDF/报告/日志文档。
- Web 端不支持的桌面能力应给明确提示，不要静默失败。
- 修改偏好字段时必须考虑旧偏好默认反序列化。
- 修改 Rust Tauri command 时同时检查 `platform/types.ts` 和 `platform/index.ts`。
- 修改 PDF、GIF、导出时优先做原子写入，失败不能留下损坏文件。

## 验收建议

按改动范围选择最小有效验证：

- 棋谱视图/分支：`pnpm --filter xiangqi-desktop-ui test -- ManualMoveRows ManualTrackView ManualTreeView branchNavigation`
- 引擎面板/设置：`pnpm --filter xiangqi-desktop-ui test -- DesktopDialogs MultiEngineComparison analysisStream`
- 评分/报告：`pnpm --filter xiangqi-desktop-ui test -- analysisView gameReport GameReportView`
- 导出 PDF：`cargo test -p xiangqi-desktop manual_pdf pdf_report`
- 桌面命令/存储：`cargo test -p xiangqi-desktop`、`cargo test -p local-store`
- 最终前端：`pnpm --filter xiangqi-desktop-ui build`
- 最终 Rust：`cargo check -p xiangqi-desktop -p xiangqi-server`

## 当前限制与容易误解点

- “变招图 SVG”是分支图/结构图，不是普通棋谱 PDF。
- 棋谱 PDF 是面向微信/手机阅读的棋谱文档，不应做成思维导图。
- 本地库和自动出步相关入口仍需继续按真实样例完善；不要在说明中夸大为完整成熟能力。
- XQF/CBR 仍处于格式识别/边界状态，没有真实样例验证前不要开放为完整导入能力。
- macOS 普通用户分发必须签名和公证；`xattr` 绕过只适合内测。
