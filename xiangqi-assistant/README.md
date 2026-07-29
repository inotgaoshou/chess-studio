# Xiangqi Studio

桌面优先、离线可用的中国象棋打谱与本地引擎分析软件。项目参考 TCHESS 的功能组织，采用 GPL-3.0 发布，并以 Rust/Tauri 重新划分棋规、棋谱、引擎、存储和同步模块。

## 当前能力

- Windows、macOS、Linux 的 Tauri 2 桌面壳与 React 工作台
- Rust 中国象棋规则、FEN、ICCS、将军与将帅照面校验
- UUID 棋谱树、节点导航、同级变例、评论、主线切换和 tombstone 删除
- 桌面棋谱工作流：新局、文件打开/保存、局面编辑、FEN/棋谱剪贴板交换和分支排序
- PGN ICCS/中文着法、RAV 变例、注释、自定义 FEN、UTF-8 BOM 与 GB18030/GBK 回退
- UCI/UCCI 自动握手、MultiPV、固定时间/深度/节点/无限分析、强制变招与停止控制
- Pikafish 执红/执黑、固定每步时间、立即出招和可选后台思考
- 落子与节点切换后的自动分析、中文候选棋谱、红方视角优劣分和历史趋势
- 私教复盘报告：关键转折定位、失误/漏杀统计、红黑质量总结、五维能力图和一键回到问题着法前推演
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

桌面端会自动查找 `PIKAFISH_PATH`、TCHESS macOS 安装目录、应用资源目录及系统 `PATH` 中的 Pikafish。也可以从“引擎 -> 引擎设置”选择可执行文件；保存前会完成 UCI/UCCI 握手。`pikafish.nnue` 应放在可执行文件同目录。默认参数为 2 线程、256 MB Hash 和 MultiPV 3。

本机已验证的引擎路径为 `/path/to/Pikafish.2026-01-02/MacOS/pikafish-apple-silicon`。对应 `pikafish.nnue` 必须位于 `MacOS` 目录中，或以软链接指向发布包根目录的同名文件。

## 可选服务端

账号同步和 Web 云端分析才需要 MySQL 8.0+ 与 Axum 服务端，开发阶段不要求 Docker：

```bash
cp .env.example .env
mysql -uroot -p -e 'CREATE DATABASE xiangqi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;'
mysql -uroot -p xiangqi < apps/server/migrations/0001_initial.sql
cargo run -p xiangqi-server
```

根据本机账号修改 `.env` 中的 `DATABASE_URL`。服务端资源上限由 `ENGINE_MAX_CONCURRENT`、`ENGINE_TIMEOUT_MS`、`ENGINE_THREADS` 和 `ENGINE_HASH_MB` 控制。

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
