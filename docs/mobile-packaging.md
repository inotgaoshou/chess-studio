# APK 与 iPhone 打包方案

本项目的移动端是轻量版：复用现有 Web/PWA 工作台，不把桌面 Tauri/Rust 后端、Pikafish、NNUE、YOLO 连线模型或系统窗口能力搬到手机里。这样 APK/IPA 的体积和审核风险都可控，手机端主要承担打谱、分支树、IndexedDB 离线缓存、云端分析、同步和大师棋谱查询。

本轮选择 Capacitor 作为移动壳，而不是直接启用 Tauri mobile。原因是当前桌面后端已经绑定 SQLite、本地 keyring、ONNX/YOLO、截图/窗口控制、PDF/GIF、本地引擎进程等桌面能力；移动端目标是复用 Web/PWA，而不是把这些 Rust 桌面能力裁剪到 iOS/Android。等后端领域拆分稳定后，如果确实需要原生移动 Rust 能力，再评估 Tauri mobile。

## 能力边界

移动端保留：

- WASM 棋规、FEN、UUID 棋谱树和非破坏性导航；
- IndexedDB 本地缓存与同步 outbox；
- 云端 `/api/v1/analysis` 引擎分析；
- 账号、订阅、同步和大师棋谱查询的服务端 API；
- 浏览器/系统 WebView 能支持的复制、导入、下载与分享。

移动端禁用：

- 内置 Pikafish 与 `pikafish.nnue`；
- 本地引擎进程、人机本地引擎对弈和本地竞技场；
- YOLO 连线识别模型；
- 桌面截图、外部窗口点击和系统级浮窗；
- NSIS/DMG 桌面打包资源。

移动端不展示桌面 PDF/GIF 导出入口；当前保留文本、棋谱文件、FEN 和变招 SVG 等浏览器下载能力。若后续要在手机生成 PDF/GIF，应接服务端生成或浏览器原生下载流程，而不是调用桌面 Rust 导出命令。

## 构建入口

先安装依赖：

```bash
corepack enable
pnpm install --frozen-lockfile
```

只构建并校验移动 Web payload：

```bash
pnpm --dir apps/desktop mobile:build
pnpm --dir apps/desktop mobile:report
```

`mobile:build` 会设置 `VITE_XIANGQI_MOBILE=1`，强制使用 `WebPlatform` 和移动工作台，并拒绝把 `pikafish`、`.nnue`、`fairy`、`stockfish`、`.onnx`、`yolo`、`.exe` 等桌面资源放进 `dist`。

移动端默认服务地址为 `https://api.xiangqi.studio`。如果内测、私有部署或本机联调，请在构建时覆盖：

```bash
VITE_XIANGQI_SERVER_URL=https://your-api.example.com pnpm --dir apps/desktop mobile:build
```

真机不能使用 `http://127.0.0.1:8080` 作为默认服务地址，因为那会指向手机自己。服务端默认 CORS 已包含 `https://localhost` 和 `capacitor://localhost`；正式部署仍建议通过 `ALLOWED_ORIGINS` 显式配置生产域名。

`mobile:report` 和 `scripts/build-mobile-release.sh` 都会在仓库根目录生成同名报告：

```text
mobile-package-size-report.json
mobile-package-size-report.md
```

## Android

Android 本地构建需要 Android Studio 或 Android SDK，并保证 `ANDROID_HOME` 指向有效 SDK；或者在 `apps/desktop/android/local.properties` 中配置 `sdk.dir=/path/to/android-sdk`。GitHub Actions 的 `Mobile` workflow 会自动安装 SDK。

首次初始化原生工程：

```bash
pnpm --dir apps/desktop android:init
```

打开 Android Studio：

```bash
pnpm --dir apps/desktop android:open
```

构建测试 APK：

```bash
PNPM_BIN=pnpm ./scripts/build-mobile-release.sh android-apk
```

构建上架 AAB：

```bash
PNPM_BIN=pnpm ./scripts/build-mobile-release.sh android-aab
```

`android-apk` 默认生成 debug APK，适合真机安装测试。`android-aab` 在没有签名环境变量时会生成 unsigned release AAB；正式上架 Google Play 前，需要在 Android Studio 或 CI 中配置 release signing keystore：

```bash
export ANDROID_KEYSTORE_PATH=/path/to/release.keystore
export ANDROID_KEYSTORE_PASSWORD=...
export ANDROID_KEY_ALIAS=...
export ANDROID_KEY_PASSWORD=...
PNPM_BIN=pnpm ./scripts/build-mobile-release.sh android-aab
```

默认建议先只面向现代 64 位设备；如果后续要兼容旧机，再增加 32 位 ABI。

## iPhone / iOS

iOS 必须在 macOS + Xcode 环境构建。首次初始化：

```bash
brew install cocoapods
pnpm --dir apps/desktop ios:init
```

同步并打开 Xcode：

```bash
PNPM_BIN=pnpm ./scripts/build-mobile-release.sh ios-open
```

构建 App Store Connect 导出包：

```bash
PNPM_BIN=pnpm ./scripts/build-mobile-release.sh ios-app-store
```

正式 TestFlight/App Store 分发需要 Apple Developer Program、`cn.xiangqi.studio` Bundle ID、签名证书、provisioning profile、隐私说明和审核材料。没有签名时，只能在模拟器或已配置开发签名的真机上验证。

## 体积预期

当前策略不内置引擎、NNUE 和 YOLO：

- Android APK：预计 `20-45 MiB`；
- Android AAB：上传包可能略大，但 Google Play 会按设备拆分；
- iOS IPA：预计 `25-60 MiB`。

如果把 Pikafish NNUE 放进手机包，会额外增加约 `49 MiB`；如果把 YOLO 模型放进去，会额外增加约 `10 MiB`。本项目默认不这样做。

## CI

Android 手动 workflow：

```text
.github/workflows/mobile.yml
```

进入 GitHub Actions 后运行 `Mobile`，可选择 `apk`、`aab` 或 `both`。iOS 暂不新增 GitHub macOS runner，因为 TestFlight/App Store 需要开发者账号与签名材料。

## 验收清单

移动 Web：

```bash
pnpm --dir apps/desktop mobile:build
pnpm --dir apps/desktop exec vitest run src/mobileEnvironment.test.ts
```

Android：

- GitHub Actions 运行 `Mobile` workflow，选择 `apk`、`aab` 或 `both`；
- 模拟器安装 APK；
- 真机安装 APK；
- 验证新建棋谱、走子、回退、分支、注释和 IndexedDB 恢复；
- 验证云端分析、游客 token、登录 token、同步和大师棋谱查询；
- 检查 `mobile-package-size-report.md`，确认没有 Pikafish、NNUE、YOLO 或桌面安装包资源。

iPhone：

- iOS Simulator 验证基础 UI、IndexedDB 和网络请求；
- 真机或 TestFlight 验证登录、同步、文件导入/下载；
- App Store 前补齐隐私说明、账号说明、网络接口说明和审核截图。

服务端：

- `/api/v1/auth/guest`
- `/api/v1/analysis`
- `/api/v1/sync/push`
- `/api/v1/sync/pull`
- `/api/v1/master/*`
