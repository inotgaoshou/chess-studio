# Pikafish 移动端与云端混合分析

## 当前实现

云端深度分析已经采用异步任务协议，旧的同步 `POST /api/v1/analysis` 暂时保留以兼容旧客户端。Web/Capacitor 客户端使用新的任务接口，并在停止、切换局面或取消分析时通知服务端终止对应 worker。

`engine-protocol` 提供平台无关的 `Engine` trait，统一以下能力：

- 加载后的状态查询；
- 线程、Hash、MultiPV 和 NNUE 配置；
- FEN、历史着法和搜索预算提交；
- 增量评分、PV、候选线和最终 bestmove；
- 取消与关闭。

Linux 服务端通过 `ProcessEngine` 实现该接口，每个运行中的任务使用独立 Pikafish 进程。任务并发由 `ENGINE_MAX_CONCURRENT` 控制，排队上限由 `ENGINE_MAX_QUEUED` 控制。超时、取消或 future 被丢弃时，子进程由 `kill_on_drop` 回收。

## 异步 API

创建任务：

```http
POST /api/v1/analysis/jobs
Authorization: Bearer <token>
Content-Type: application/json

{
  "fen": "rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1",
  "engineVersion": "Pikafish-2026-09-06",
  "nnueVersion": "sha256:7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e",
  "budget": { "mode": "depth", "value": 20 },
  "multiPv": 3
}
```

查询与取消：

```http
GET  /api/v1/analysis/jobs/{jobId}
POST /api/v1/analysis/jobs/{jobId}/cancel
```

任务状态为 `queued`、`running`、`completed`、`failed` 或 `cancelled`。任务只能由创建它的用户或游客令牌读取和取消。响应包含 `source`、Pikafish 版本、NNUE 版本、缓存标记和当前深度/候选数。

缓存键由棋规层规范化后的 FEN、服务端 Pikafish 版本、NNUE 版本、搜索模式、搜索值和 MultiPV 共同计算。缓存只保存成功结果，不保存用户身份或游客额度。当前缓存与任务状态在服务进程内存中；若需要跨服务重启保留结果，应把同一键和值迁移到 Redis 或 MySQL，HTTP 协议无需变化。

服务端版本配置：

```text
PIKAFISH_ENGINE_VERSION=Pikafish-2026-09-06
PIKAFISH_NNUE_VERSION=sha256:7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e
ENGINE_MAX_CONCURRENT=2
ENGINE_MAX_QUEUED=64
ENGINE_TIMEOUT_MS=12000
```

## 原生移动端构建门槛

主应用当前仍使用 Capacitor 壳，不是 Tauri mobile；`apps/desktop/ios` 也尚未生成。另一个残局训练应用已有 Android ARM64 Pikafish，但该文件是通过 `ProcessBuilder` 启动的 ELF 可执行文件，不是可供 JNI 调用的共享库。因此它只能作为 Android 真机和资源哈希的验证依据，不能作为本方案的 iOS 或 JNI 产物。

启用本地移动分析前必须同时完成：

1. 决定主应用迁移到 Tauri 2 mobile，或正式调整方案为 Capacitor native plugin；不能同时维护两套未共享状态的 WebView bridge。
2. 在固定提交 `4c17cee11f888ae1d48a9494f2e2239f019f0a1f` 上增加最小 C ABI，调用 Pikafish `Engine` 的 position、go、stop 和回调 API，不重定向全局 stdin/stdout。
3. Android 用 NDK 构建 ARM64 JNI `.so`；iOS/iPadOS 用同一 C ABI 构建静态库或 XCFramework，并通过 Objective-C++/Swift bridge 接入。
4. 两个平台都实现 Rust `Engine` trait 适配器，并把原生回调转换为 `EngineUpdate`；WebView 只能调用 Tauri command/event。
5. 把固定 NNUE、`Copying.txt`、NNUE 许可证、版权、修改说明、完整对应源码和构建脚本纳入 APK/IPA 校验。
6. 完成真机后台、取消、热状态、低电量和内存压力测试后，才移除当前移动构建的“本地引擎不打包”限制。

在这些门槛完成前，主应用移动版保持云端异步分析；离线时仍可打谱和查看已缓存结果，但不会宣称具备本地 Pikafish 分析。
