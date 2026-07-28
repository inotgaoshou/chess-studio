# Xiangqi Studio

桌面优先、离线可用的中国象棋打谱与本地引擎分析软件。项目参考 TCHESS 的功能组织，采用 GPL-3.0 发布，并以 Rust/Tauri 重新划分棋规、棋谱、引擎、存储和同步模块。

## 当前能力

- Windows、macOS、Linux 的 Tauri 2 桌面壳与 React 工作台
- Rust 中国象棋规则、FEN、ICCS、将军与将帅照面校验
- UUID 棋谱树、同级变例、主线切换和 tombstone 删除
- UCI/UCCI 自动握手、MultiPV、固定时间/深度/无限分析
- SQLite 本地棋谱、分析结构和幂等 outbox
- Axum + MySQL 8.0 的注册、登录、JWT、`sync/push` 和 `sync/pull`

## 本地运行

需要 Rust stable、Node.js 20+、pnpm 11+。服务端还需要 MySQL 8.0+。

```bash
cp .env.example .env
docker compose up -d mysql
cargo run -p xiangqi-server
```

另开终端运行桌面端：

```bash
pnpm install
pnpm --filter xiangqi-desktop-ui tauri dev
```

仅查看前端：

```bash
pnpm --filter xiangqi-desktop-ui dev
```

注册并获取桌面同步所需令牌：

```bash
curl -X POST http://127.0.0.1:8080/api/v1/auth/register \
  -H 'content-type: application/json' \
  -d '{"email":"user@example.com","password":"change-me-now"}'
```

将返回的 `token` 填入桌面端左下角“个人同步”。

## 验证

```bash
cargo test --workspace
pnpm --filter xiangqi-desktop-ui build
cargo check -p xiangqi-desktop
```

## 项目结构

```text
apps/desktop           React + Tauri 2 桌面端
apps/server            Axum + MySQL 同步服务
crates/xiangqi-core    棋规与局面
crates/manual          棋谱变例树
crates/engine-protocol UCI/UCCI 进程适配
crates/local-store     SQLite 与 outbox
crates/sync-protocol   客户端/服务端共享数据类型
```

详细的数据流和接口约束见 [ARCHITECTURE.md](docs/ARCHITECTURE.md)。
