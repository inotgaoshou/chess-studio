# Xiangqi Studio

桌面优先、离线可用的中国象棋打谱与本地引擎分析软件，以 Rust/Tauri 重新划分棋规、棋谱、引擎、存储和同步模块。

## 当前能力

### 三种工作模式与能力边界

- **复盘（默认）**：导入或录入棋谱、归档、整局报告、关键着法与训练任务。棋谱和报告始终保存在本机 SQLite，不会因切换模式丢失变例或注释。
- **研究**：实时引擎、多引擎对比、开局库、飞刀、大师棋谱和变例研究。引擎能力会明确提示“需配置引擎”；大师库需要登录；窗口识别与连线是 macOS 实验功能。
- **训练**：U10 引导拆棋、训练任务、间隔复习、家长周报与学习档案。它复用当前复盘棋局和报告，关闭拆棋后仍停留在训练上下文。

桌面核心能力以 Windows x64 与 macOS Apple Silicon 为发布基线。Web/PWA 仅承诺离线棋谱、基础变例和待同步操作；不显示为可用的桌面本地引擎、报告 PDF、训练、资料库或窗口连线功能。完整人工验收项见 [跨平台验收矩阵](docs/PLATFORM_ACCEPTANCE_MATRIX.md)。

- Windows、macOS、Linux 的 Tauri 2 桌面壳与 React 工作台
- Rust 中国象棋规则、FEN、ICCS、将军与将帅照面校验
- UUID 棋谱树、节点导航、同级变例、评论、主线切换和 tombstone 删除
- 桌面棋谱工作流：新局、文件打开/保存、局面编辑、FEN/棋谱剪贴板交换和分支排序
- PGN ICCS/中文着法、RAV 变例、注释、自定义 FEN、UTF-8 BOM 与 GB18030/GBK 回退
- UCI/UCCI 自动握手、MultiPV、固定时间/深度/节点/无限分析、强制变招与停止控制
- Pikafish 执红/执黑、固定每步时间、立即出招和可选后台思考
- 落子与节点切换后的自动分析、中文候选棋谱、红方视角优劣分和历史趋势
- 私教复盘报告：关键转折定位、失误/漏杀统计、红黑质量总结、五维能力图和一键回到问题着法前推演
- 复盘报告弹窗与原生 A4 PDF 导出；PDF 内嵌 OFL-1.1 授权的 Noto Sans SC 中文字体
- SQLite 本地棋谱、桌面偏好、分析结果、远端操作投影和幂等 outbox
- 桌面同步账号注册/登录、系统钥匙串 JWT 和单账号棋谱库绑定
- 实验中的移动 Web/PWA，使用 Rust/WASM 棋规和 IndexedDB 离线打谱
- Axum + MySQL 8.0 的注册、登录、JWT、同步和服务端 Pikafish 分析

## 本地运行

桌面端只需要 Rust stable、Node.js 20+ 和 pnpm 11+。SQLite 已嵌入应用，不需要单独安装；本地打谱和 Pikafish 分析也不需要 MySQL、Docker或 Axum 服务端。

```bash
pnpm install
PIKAFISH_PATH=/absolute/path/to/pikafish-apple-silicon \
  pnpm --filter xiangqi-desktop-ui tauri dev
```

桌面端会自动查找 `PIKAFISH_PATH`、TCHESS macOS 安装目录、应用资源目录及系统 `PATH` 中的 Pikafish。也可以从“引擎 -> 引擎设置”使用内置 Fairy-Stockfish（自动设置 `UCI_Variant=xiangqi`），或选择外部 Fairy-Stockfish、象眼、旋风等 UCI/UCCI 引擎；保存前会完成握手。`.nnue` 必须与对应外部引擎放在同一目录，不能混用不同引擎的网络。默认参数为 2 线程、256 MB Hash 和 MultiPV 3。

本地引擎路径示例为 `/path/to/Pikafish.2026-01-02/MacOS/pikafish-apple-silicon`。对应 `pikafish.nnue` 必须位于 `MacOS` 目录中，或以软链接指向发布包根目录的同名文件。

## 可选服务端

账号同步和 Web 云端分析才需要 MySQL 8.0+ 与 Axum 服务端，开发阶段不要求 Docker：

```bash
cp .env.example .env
mysql -uroot -p < apps/server/migrations/0000_bootstrap_schema.sql
mysql -uroot -p xiangqi < apps/server/migrations/0001_initial.sql
cargo run -p xiangqi-server
```

根据本机账号修改 `.env` 中的 `DATABASE_URL`。服务端资源上限由 `ENGINE_MAX_CONCURRENT`、`ENGINE_TIMEOUT_MS`、`ENGINE_THREADS` 和 `ENGINE_HASH_MB` 控制。

本地开发可使用脚本启动：`./scripts/dev-server.sh start`、`./scripts/dev-server.sh restart`、`./scripts/dev-server.sh logs`、`./scripts/dev-desktop.sh`，或使用 `./scripts/dev-all.sh` 一次启动服务端和桌面端。桌面脚本固定使用 NVM 的 Node 24.14.0 与 Corepack，避免系统 Node 版本不兼容 pnpm。

移动 Web/PWA 目前使用独立构建入口，不影响默认桌面构建：

```bash
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
pnpm --filter xiangqi-desktop-ui web:dev
```

生产 Web 构建会先生成 Rust/WASM 绑定，并在 HTTPS 部署后支持“添加到主屏幕”：

```bash
pnpm --filter xiangqi-desktop-ui web:build
pnpm --filter xiangqi-desktop-ui exec vite preview --host 0.0.0.0 --port 4173
```

Web 端使用 IndexedDB 保存棋谱、变例、评论、分析缓存和待同步操作。离线时可以继续打谱并查看已缓存分析；联网且填写 JWT 后可同步并调用服务端 Pikafish。移动端不会下载或执行本地引擎。

XQF、CBR 已接入统一格式检测入口，但解析器需要真实样例验证具体版本、编码、注释和变例结构。桌面文件对话框目前只显示完整支持的 PGN，不提供 XQF/CBR 入口。

启动服务端后，从桌面“同步”菜单注册或登录。JWT 只保存在操作系统钥匙串，不返回 React，也不写入 SQLite；退出登录不会删除本地棋谱或 outbox。一个本地棋谱库首次登录后绑定该账号，不能切换到其他账号或同步服务器。

## 发布打包

本地 macOS Apple Silicon 内置 Pikafish / Fairy-Stockfish 打包：

```bash
pnpm release:macos
```

需要正式签名和公证时使用 `pnpm release:macos:signed`，并提前配置 Apple 证书与公证环境变量。

如果要使用项目相邻目录中的新版 Pikafish 与 NNUE，可以运行：

```bash
pnpm release:macos:latest-pikafish
```

Windows x64 的 GitHub Release 构建会直接使用仓库中提交的 `apps/desktop/src-tauri/resources/pikafish/pikafish.exe` 和 `pikafish.nnue`。本地只想刷新 Windows 资源时可以运行：

```bash
pnpm prepare:windows:latest-pikafish
```

Pikafish 引擎和 `pikafish.nnue` 会提交到 `apps/desktop/src-tauri/resources/pikafish/`，GitHub Release 构建直接使用仓库中的资源。后续更新时覆盖该目录中的 `pikafish`、`pikafish.exe` 和 `pikafish.nnue` 后提交即可。`scripts/prepare-pikafish-resource.sh` 仍保留为本地更新资源的辅助脚本，必要时可通过 `PIKAFISH_NNUE_SOURCE` 或 `PIKAFISH_NNUE_URL` 指定权重来源。

产物位于 `target/release/bundle/`。默认会读取 `PIKAFISH_RELEASE_DIR` 指向的 Pikafish 发布目录；未设置时使用项目相邻目录的 `../Pikafish.2026-01-02`。该目录中的 Apple Silicon Pikafish 与 `pikafish.nnue` 会被内置到 macOS 安装包。Fairy-Stockfish 使用 Apple Silicon 可执行文件与其独立的官方中国象棋网络 `xiangqi-c07e94a5c7cb.nnue`；两者均会进入 `resources/fairy-stockfish/`。资源不存在时，macOS 构建脚本会构建 Fairy 源码；资源准备脚本会从 [Fairy-Stockfish-NNUE](https://github.com/fairy-stockfish/Fairy-Stockfish-NNUE) 的官方源下载并校验该文件。运行时强制使用 `UCI_Variant=xiangqi` 和 Fairy 目录中的该网络，绝不复用 `pikafish.nnue`。Windows x64 发布物同样携带各自的 Fairy 可执行文件和这份 NNUE。

GitHub Release 打包通过 `.github/workflows/release.yml` 完成；当前构建 Windows x64 和 macOS Apple Silicon，Linux 暂不在 GitHub Actions 打包。推送版本标签即可触发草稿 Release：

```bash
git tag v1.0.0
git push origin v1.0.0
```

GitHub Actions 会尝试构建：

- Windows x64：安装包，内置 Pikafish SSE4.1/POPCNT 和 Fairy-Stockfish largeboard x64
- macOS Apple Silicon：DMG / App，内置 Apple Silicon Pikafish、Fairy-Stockfish 和各自 NNUE
- Linux：本轮 GitHub Release 暂不打包，后续需要时再启用

构建前会运行 `scripts/verify-embedded-engine-resources.sh` 校验对应平台资源：Windows 必须有 `.exe` 引擎，macOS 必须有 macOS 可执行文件；Pikafish 必须携带 `pikafish.nnue`，Fairy-Stockfish 必须携带独立的 `xiangqi-c07e94a5c7cb.nnue`，并拒绝两个引擎目录混用网络文件。

如果要让 macOS 包正式签名和公证，需要在 GitHub 仓库 `Settings -> Secrets and variables -> Actions` 中配置：

- `APPLE_CERTIFICATE`
- `APPLE_CERTIFICATE_PASSWORD`
- `APPLE_SIGNING_IDENTITY`
- `APPLE_ID`
- `APPLE_PASSWORD`
- `APPLE_TEAM_ID`

完整的 Apple Developer 账号、证书导出、GitHub Secrets、本地签名公证和验收步骤见 [macOS 正式签名、公证与 GitHub Release](docs/MACOS_RELEASE.md)。

## 验证

```bash
cargo test --workspace
pnpm --filter xiangqi-desktop-ui build
cargo check -p xiangqi-desktop
wasm-pack test --headless --chrome crates/web-core
```

## 项目结构

```text
apps/desktop           React + Tauri 2 桌面端
apps/server            Axum + MySQL 同步服务
crates/xiangqi-core    棋规与局面
crates/manual          棋谱变例树
crates/manual-format   PGN 与旧棋谱格式适配层
crates/web-core        浏览器 WASM 适配层
crates/engine-protocol UCI/UCCI 进程适配
crates/local-store     SQLite 与 outbox
crates/sync-protocol   客户端/服务端共享数据类型
```

详细的数据流和接口约束见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。
