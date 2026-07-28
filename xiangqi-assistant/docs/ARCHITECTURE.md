# Architecture

## 本地编辑

React 只提交 ICCS 着法。Tauri command 调用 `xiangqi-core` 验证并生成新局面，再向 `ManualTree` 增加稳定 UUID 节点。SQLite 在一个事务中写入棋谱节点和 outbox 操作，界面不等待网络。

## 引擎分析

`EngineSession` 是 UCI/UCCI 的唯一外部 seam。它负责启动子进程、探测协议、发送 `position`/`go`、解析 `info`/`bestmove` 并在退出时回收进程。React 不解析引擎文本。

## 同步

桌面端从 SQLite 读取未上传操作，携带 JWT 调用 `POST /api/v1/sync/push`。服务端按 `op_id` 幂等插入 MySQL 并分配递增 `sequence_id`。桌面端再调用 `GET /api/v1/sync/pull?cursor=N`，保存远端操作和游标。

同一父节点下的并发 `add_move` 不冲突，而是形成两个变例。字段更新使用 `lamport + device_id` 的确定性顺序；删除保留 tombstone。当前版本已经保存远端操作，但跨设备操作投影回正在打开的棋谱仍属于下一阶段。

## 安全约束

- 客户端永不直连 MySQL。
- 密码使用 Argon2 哈希；同步接口要求 30 天有效期的 HS256 JWT。
- 服务端拒绝不属于当前用户棋谱的操作，并限制单批最多 500 条。
- 本地引擎路径由用户显式配置，进程仅通过 stdin/stdout 交互。
