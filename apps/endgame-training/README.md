# 棋析 Android 与 iPhone 应用

独立 Android/iOS 应用，显示名称为“棋析”，包名为 `cn.xiangqi.endgame.training`，可与 Xiangqi Studio 主应用并存。它提供离线 CBL 导入与残局训练；题库和答题记录写入该应用的私有 SQLite，安装包不包含任何 CBL 或用户数据。

Android 目标为 Android 10+ 的 `arm64-v8a` 平板和手机，首要验收设备是荣耀平板 X10 Pro 8GB+128GB。iOS 为 iPhone/iPad 通用包，最低 iOS 14；窄屏时目录和控制栏会变为抽屉，确保棋盘保持完整可点。

无论 Android 还是 iOS，题库、题目、答案树、答题记录和累计用时都存于应用私有 SQLite。APK/IPA 不包含 CBL 或这些本地数据；卸载应用会清除它们。

Android APK 与 iPhone/iPad IPA 都内置 Pikafish 2026-09-06 arm64 引擎和固定 `pikafish.nnue`。默认“云库 + 皮卡鱼”模式优先使用 ChessDB，未命中或网络失败时由本地 Pikafish 应手；“本地 AI 对练”模式全程离线调用 Pikafish。切题、重来、结束和退出会取消仍在运行的引擎搜索。

Android 版还提供“AI 拆棋”：对当前局面进行本地 MultiPV 分析，候选数量可在 1–4 条之间选择，并以红方视角显示编号箭头、深度、节点、NPS、局面分和中文后续变化。拆棋结果仅用于临时预览，不会落子、写入 SQLite、修改题解树或生成真实变招；局面变化后旧结果会自动清除。

内置资源位于 `android/app/src/main/jniLibs/arm64-v8a/libpikafish.so` 和 `android/app/src/main/assets/pikafish/`。发布脚本会校验固定 SHA-256，许可证和资源清单随 APK 分发。由于引擎仅提供 arm64 版本，纯 32 位 ARM 设备与 x86 模拟器不受支持。

分发任何内置 Pikafish/NNUE 的 APK 或 IPA 前，必须补齐并核对 GPLv3 材料：Pikafish `Copying.txt`、`NNUE-License.md`、`RESOURCE-MANIFEST.txt`、`THIRD_PARTY_NOTICES.md`、Pikafish 版本、源码提交、对应源码获取方式、构建脚本说明和资源 SHA-256。发布说明、支持页和应用内关于信息应与这些材料保持一致。不能混入 Fairy-Stockfish、其他 NNUE、未知来源引擎或构建时网络下载的替换引擎。

## 开发

需要 Node 22+、Rust/WASM 工具链、Android SDK API 35，以及 JDK 21：

```bash
pnpm --dir apps/endgame-training mobile:build
pnpm --dir apps/endgame-training android:sync
```

调试 APK：

```bash
cd apps/endgame-training/android
JAVA_HOME=/path/to/jdk-21 ./gradlew :app:assembleDebug
```

正式签名 APK 需要 `ANDROID_KEYSTORE_PATH`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`，然后执行：

```bash
pnpm --dir apps/endgame-training android:apk
```

产物为 `android/app/build/outputs/apk/release/app-release.apk`，同时保留带版本号的副本。在平板或手机上可通过 Android Studio、`adb install -r` 或文件管理器安装。

## iPhone / iPad

iOS 工程位于 `ios/App/App.xcodeproj`，采用 Swift Package Manager，不依赖 Android SQLite 插件或 CocoaPods。`TrainingStorePlugin.swift` 用 iOS 系统 `SQLite3`，并保持与 Android 相同的 `TrainingStore` 接口。

iOS 版将 Pikafish 静态链接到 App 进程，绝不启动子进程或下载/替换可执行代码。引擎源工程默认位于仓库同级的 `../pikafish-ios`，也可在 Xcode 构建时设置 `PIKAFISH_IOS_ROOT` 覆盖；该工程会校验并构建固定版本，再将 NNUE、GPLv3、NNUE 许可证、README 和作者信息放进 IPA。Pikafish 为 GPLv3，向用户分发 IPA 前必须按 GPLv3 提供对应源代码与许可文本。

开发机需要完整 Xcode（Command Line Tools 不足）：

```bash
pnpm --dir apps/endgame-training ios:sync
bash scripts/build-endgame-training-ios.sh open
```

在 Xcode 的 `App` target 中选择自己的 Team、连接 iPhone 后点 Run，即可安装测试版。免费 Apple ID 的个人签名通常只适合短期真机测试，且会过期；长期分发请使用 Apple Developer Program 的开发/Ad Hoc/TestFlight 流程。项目不保存 Apple 证书、私钥或 Team ID。

配置付费 Apple Developer 团队和设备/分发证书后，可用下列命令生成 IPA。默认是 Ad Hoc；产物写入构建目录，文件名包含生成时间，不覆盖旧包：

```bash
bash scripts/build-endgame-training-ios.sh ipa
```

可用 `IOS_EXPORT_METHOD=app-store` 生成上传 App Store Connect/TestFlight 所需的导出包，或用 `IOS_EXPORT_METHOD=development` 生成供已登记设备开发测试的包。免费 Apple ID 应在 Xcode 连接 iPhone 后直接点 Run，不应将导出的包作为可分发 IPA。

安装后点击右上角“导入 CBL”，在 iPhone 的“文件”选择器中选择 `.CBL` 文件即可。文件会被解析后写入应用私有数据库，原始 CBL 不会被打进安装包。
