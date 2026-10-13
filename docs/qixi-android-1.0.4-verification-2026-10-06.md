# Android 设置及方向适配验收

版本：1.0.4 / versionCode 10020；包名：`cn.xiangqi.endgame.training`；正式环境，ARM64，minSdk 29 / targetSdk 35。未部署后台或发布平台题目。

## 修复

- Capacitor Android `adjustMarginsForEdgeToEdge: auto`，SDK 35 起由原生 WebView 避让系统栏和刘海，旧系统沿用原生窗口布局。
- 右上角问号触摸区域 44×44；手机顶部栏内容高度 48px，避免按钮被裁切。
- 移除全局快速 `touchend` 拦截，保留 viewport、手势缩放限制和控件 `touch-action`；共享棋盘仍使用原来的触摸处理。
- 设置层级高于顶部栏和底部导航，方向设置放在版本信息之前，矮横屏滚动，关闭按钮固定在弹窗底部。
- 原生方向插件成功返回空载荷时不再误报失败；同步防重入，成功后保存，失败在弹窗内显示具体原因。
- 锁横屏允许左右横向，锁竖屏限定竖向；自动使用系统旋转设置。浅色系统区域使用深色状态栏和导航图标。

## 已完成的验证

- 手机前端 TypeScript 检查、WASM 构建、Vite 正式构建、Capacitor Android 同步、Gradle Release 编译及 lint 成功。
- 相关 Vitest：40 项通过（34 项共享棋盘、3 项方向偏好、3 项原生桥接）。覆盖轻点、拖动、取消、兼容点击去重、分析刷新、空载荷成功、失败重试、防重入、成功保存和重启恢复。
- 浏览器触摸脚本：390×844、960×432、740×300 通过。每个尺寸连续打开/关闭设置 20 次，验证连续点击、失败提示、重试、弹窗遮挡、短横屏滚动和方向偏好恢复。
- 既有练习 UI 脚本通过：手机和平板练习、页面切换、设置持久化、离线重试、答题进度恢复及未登录访问保护。测试使用隔离 API mock，不提交真实学习数据。
- Android 原生单元测试 6 项通过。
- Android 15 ARM64 最终签名包：三键和手势导航、左右横屏系统区域避让、锁横屏/锁竖屏/跟随系统、重启恢复全部通过；连续打开设置、切换方向、关闭设置 20 次全部通过。
- 平板浏览器实际验证“我的 → 设置与外观 → 导航布局”，左侧/底部选择可用，底部偏好刷新后保留。定位截图：`artifacts/qixi-android-1.0.4/tablet-navigation-settings.png`。

首次 `pnpm test -- ...` 实际执行了全量测试，出现 11 项超时及 2 个 worker 启动超时；本次未将该结果视为全量通过。独立执行相关 40 项测试后全部通过。

Android 15 模拟器最终验收及截图见 `artifacts/qixi-android-1.0.4/android15/verification.json`。截图和 JSON 中记录了 WebView 可操作区域与问号实际边界，确认入口未落入原生系统栏。

## 安装包

`artifacts/qixi-android-1.0.4/qixi-1.0.4-10020-production.apk`，约 79.36 MiB。

- APK SHA256：`7d8300aa7f81988ee1d476406da64562f084f729571204c2226b2c37b37e8b82`
- 签名证书 SHA256：`55e945c2d2e907a450e5c94dbde36b3e99b93551b2a7bf33c0f5bc89f904fe57`，与已有 1.0.3 / 10019 正式包一致。
- APK 内回读确认 `adjustMarginsForEdgeToEdge: auto`；原生版本、前端版本均为 1.0.4；内置 Pikafish、NNUE 和许可文件校验通过。

## 尚需设备验收

- 原问题手机未连接：安装后连续开关设置并切换方向至少 20 次，检查三键/手势导航、棋盘轻点及拖动、页面滚动、底部导航和现有练习进度。
- Android 14 镜像下载停滞，已停止该下载；旧版 Android 无重复边距仍需设备实测。本次没有把源码中 SDK 条件判断当作旧设备验收。
- 模拟器使用 API 35 ARM64，800×1280 / 320dpi。已有 AVD 原为平板，测试前通过 `wm set-ignore-orientation-request false` 允许应用方向请求，避免平板兼容模式仅对应用进行横屏信箱显示。
