# 安卓平板练习入口与卡片样式验收

日期：2026-10-19（北京时间）。本记录对应当前工作树；未发布安装包或部署服务。

## 问题与修复

- 浏览器平板场景可稳定复现：日练创建请求挂起后，17 秒仍停留在“正在创建练习…”，没有错误和重试，平台专题同时被全局忙碌状态禁用。
- 今日计划的布局只定义在 `phone-webview` 下，800px 平板上按钮实测约 228px、容器 370px，圆角为 0。
- 练习请求现有 15 秒整体期限，包含 capabilities、401 后鉴权刷新、响应正文读取；超时或取消后忽略迟到结果，不自动重放超时 POST。
- 创建入口共用同步锁，专题浏览保持可用。切页、浏览器返回、切账号会取消创建，旧操作不能释放新操作的锁。
- 棋盘、历史和草稿准备完毕后才提交页面状态。初始化失败或超时后，重试复用已创建会话；题目顺序、草稿、提示和错误次数保留。
- 专题 URL 保留专题 ID，刷新和历史导航可恢复专题。
- 今日计划使用独立浅绿圆角卡片，整行可点；分区标题和副标题在手机及平板共用布局。

## 自动验证

| 验证 | 结果 |
| --- | --- |
| 移动端单元测试 | 25 项通过 |
| TypeScript + Vite 构建 | 通过；存在原有大 chunk 提示 |
| `scripts/test-mobile-practice-recovery.cjs` | 13 组通过 |
| 原有 `scripts/test-mobile-practice-ui.cjs` | 390px / 1024px 主流程、四组作业草稿恢复、学生导入权限和账号守卫通过 |
| Android `:app:assembleDebug` | 通过 |
| `git diff --check` | 通过 |

新增浏览器回归覆盖：创建请求、JSON 正文、鉴权刷新、capabilities 和专题请求挂起；超时重试；双入口防重；切页和新旧请求锁竞争；初始化报错及本地读取挂起；返回和切账号；专题刷新恢复；390/800/1280px 卡片布局。

原练习脚本同步补齐 `/verify-move` 的模拟响应，按当前协议断言拒绝着法保留棋盘，并等待日历和判题请求完成。没有修改产品判题、质量分或评分规则。

复跑浏览器验证：

```bash
VITE_TEACHING_API_BASE=https://api-test.qixiapp.cn pnpm --filter xiangqi-endgame-training exec vite --host 127.0.0.1 --port 1448 --strictPort
node scripts/test-mobile-practice-recovery.cjs
PRACTICE_URL=http://127.0.0.1:1448 node scripts/test-mobile-practice-ui.cjs
pnpm --filter xiangqi-endgame-training test
VITE_APP_ENV=test pnpm --filter xiangqi-endgame-training build
```

## Android 原生验收

使用 Android 15 / ARM64 模拟器的只读临时运行实例 `emulator-5582`，不修改原 AVD 保存的数据。使用当前源码构建的测试环境 debug APK，所有 API 流量均由测试脚本拦截，未创建真实账号或真实服务端练习。

原生能力保持真实：Capacitor 安全会话、SQLite 历史读取、WASM 棋规和棋盘、正常的 Pikafish 停止调用。只有专门的阻塞用例模拟不返回的 `Pikafish.cancel` 回调。

- 竖屏：800×1232 CSS px，原生 `tablet-webview`；横屏：1280×752 CSS px，原生 `tablet-webview`。
- 顶部开始、今日计划卡片、平台专题详情→开始训练，均显示包含 32 枚棋子的真实棋盘。
- 创建请求挂起后出现超时与重试，入口重新可用，重试可进入棋盘。
- 引擎停止回调挂起时，初始化超时并释放入口；重试复用同一会话，没有新增 POST。
- 今日计划卡片在横竖屏均与容器等宽，圆角 8px；截图已视觉检查。

复跑原生测试前，在隔离模拟器安装当前 debug APK 并启动应用，设置 density=320、尺寸为 1600×2560 或 2560×1600，然后重启应用，使 WebView 按真实平板配置初始化：

```bash
PRACTICE_ANDROID_SERIAL=emulator-5582 node scripts/test-android-practice-recovery.cjs
PRACTICE_ANDROID_SERIAL=emulator-5582 PRACTICE_ANDROID_LAYOUT=landscape node scripts/test-android-practice-recovery.cjs
```

截图：[竖屏](assets/practice-recovery-20261019/android-portrait.png)、[横屏](assets/practice-recovery-20261019/android-landscape.png)、[原生棋盘](assets/practice-recovery-20261019/android-solver.png)。

此轮验证覆盖原生模拟器及模拟接口，未在用户的实体平板或真实后端网络条件下重新复现；不将此结果描述为线上发布或实体设备验收。
