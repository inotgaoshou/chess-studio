# Architecture

## 本地编辑

React 只提交 ICCS 着法。Tauri command 调用 `xiangqi-core` 验证并生成新局面，再向 `ManualTree` 增加稳定 UUID 节点。SQLite 在一个事务中写入棋谱节点和 outbox 操作，界面不等待网络。

Web/PWA 通过 `xiangqi-web-core` 的 wasm-bindgen API 复用同一套 `xiangqi-core` 和 `ManualTree`。浏览器适配器将快照、分析缓存、设备 ID、Lamport 时钟和 outbox 写入 IndexedDB；断网编辑不依赖服务端，恢复网络后沿用相同的 push/pull 协议。桌面适配器仍调用 Tauri command 和 SQLite，两种平台不共享存储实现。

## 引擎分析

`EngineSession` 是 UCI/UCCI 的唯一外部 seam。它负责启动子进程、探测协议、发送 `position`/`go`、解析 `info`/`bestmove` 并在退出时回收进程。React 不解析引擎文本。

桌面端直接启动本地 Pikafish。Web 端调用要求 JWT 的 `POST /api/v1/analysis`，服务端为每次请求创建独立引擎进程，并用信号量、超时、固定时间/固定深度范围和 MultiPV 上限约束资源。移动端离线时不发起新分析，只读取 IndexedDB 中已有缓存。

自动分析由前端监听当前棋谱节点变化触发。新局面到来时先停止仍在运行的旧搜索，并只排队最新节点；自动模式不会使用无限搜索。候选线路由 Rust 按当前 FEN 逐着转换为中文记谱，前端按红黑回合排版。趋势分数统一换算为红方视角，并复用 SQLite 中各节点的最新主线路分数。

## 同步

桌面端从 SQLite 读取未上传操作，携带 JWT 调用 `POST /api/v1/sync/push`。服务端按 `op_id` 幂等插入 MySQL 并分配递增 `sequence_id`。桌面端再调用 `GET /api/v1/sync/pull?cursor=N`，在同一 SQLite 事务中将远端操作投影到棋谱、保存操作日志并推进游标；当前打开的棋谱随后从本地投影重新加载。

同一父节点下的并发 `add_move` 不冲突，而是形成两个变例。服务端递增游标决定投影顺序，操作同时保留 `lamport` 和稳定 `device_id`，为后续字段级冲突策略保留上下文；删除保留 tombstone。

## 安全约束

- 客户端永不直连 MySQL。
- 密码使用 Argon2 哈希；同步接口要求 30 天有效期的 HS256 JWT。
- 服务端拒绝不属于当前用户棋谱的操作，并限制单批最多 500 条。
- 本地引擎路径来自用户配置的 `PIKAFISH_PATH`、界面输入或受控的应用目录/系统 `PATH` 自动发现；应用不下载引擎，进程仅通过 stdin/stdout 交互。
- 生产 CORS 只允许配置的 PWA HTTPS 来源；Service Worker 不缓存 API、Authorization 请求、令牌或动态分析响应。
