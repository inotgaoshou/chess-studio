# 棋析 Android 与 iPhone 应用

独立 Android/iOS 应用，显示名称为“棋析”，包名为 `cn.xiangqi.endgame.training`，可与 Xiangqi Studio 主应用并存。它提供离线 CBL 导入与残局训练；题库和答题记录写入该应用的私有 SQLite，安装包不包含任何 CBL 或用户数据。

Android 目标为 Android 10+ 的 `arm64-v8a` 平板和手机，首要验收设备是荣耀平板 X10 Pro 8GB+128GB。iOS 为 iPhone/iPad 通用包，最低 iOS 14；窄屏时目录和控制栏会变为抽屉，确保棋盘保持完整可点。

无论 Android 还是 iOS，题库、题目、答案树、答题记录和累计用时都存于应用私有 SQLite。APK/IPA 不包含 CBL 或这些本地数据；卸载应用会清除它们。

Android APK 与 iPhone/iPad IPA 都内置 Pikafish 2026-09-06 arm64 引擎和固定 `pikafish.nnue`。默认“云库 + 皮卡鱼”模式优先使用 ChessDB，未命中或网络失败时由本地 Pikafish 应手；“本地 AI 对练”模式全程离线调用 Pikafish。切题、重来、结束和退出会取消仍在运行的引擎搜索。

Android 版还提供“AI 拆棋”：对当前局面进行本地 MultiPV 分析，候选数量可在 1–4 条之间选择，并以红方视角显示编号箭头、深度、节点、NPS、局面分和中文后续变化。拆棋结果仅用于临时预览，不会落子、写入 SQLite、修改题解树或生成真实变招；局面变化后旧结果会自动清除。

内置资源位于 `android/app/src/main/jniLibs/arm64-v8a/libpikafish.so` 和 `android/app/src/main/assets/pikafish/`。发布脚本会校验固定 SHA-256，许可证和资源清单随 APK 分发。由于引擎仅提供 arm64 版本，纯 32 位 ARM 设备与 x86 模拟器不受支持。

分发任何内置 Pikafish/NNUE 的 APK 或 IPA 前，必须补齐并核对 GPLv3 材料：Pikafish `Copying.txt`、`NNUE-License.md`、`RESOURCE-MANIFEST.txt`、`THIRD_PARTY_NOTICES.md`、Pikafish 版本、源码提交、对应源码获取方式、构建脚本说明和资源 SHA-256。发布说明、支持页和应用内关于信息应与这些材料保持一致。不能混入 Fairy-Stockfish、其他 NNUE、未知来源引擎或构建时网络下载的替换引擎。

## 安装包环境

`VITE_APP_ENV=test|production` 同时决定登录弹窗的“测试版／正式版”标识与默认服务域名。普通构建和本地发行默认 `production`，固定连接 `https://api.qixiapp.cn`，不提供环境切换；测试包默认连接 `https://api-test.qixiapp.cn`，未登录时可选择测试或线上环境，选择会保留。TestFlight 工作流的 `app_env` 默认 `test`。

连接地址不在弹窗中显示，也不能输入自定义域名。切换环境需先退出登录，切换后重新登录；本地棋谱和按服务器隔离的作业缓存保留。旧版未记录服务器归属的安全会话需重新登录。

```bash
VITE_APP_ENV=test pnpm --dir apps/endgame-training android:apk
VITE_APP_ENV=test bash scripts/build-endgame-training-ios.sh archive
```

本地 Vite 开发默认标识为测试版，测试环境使用 `http://127.0.0.1:8090`，可通过 `VITE_TEACHING_API_BASE` 指定开发网关；此变量不影响发行包域名。发行包不再读取 `VITE_ALLOW_TEACHING_SERVER_OVERRIDE` 或旧版自定义地址。

环境与会话回归检查：`node --test scripts/test-mobile-environment.mjs`。

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

Android 构建默认版本为 `1.0.4 / 10020`，前端显示版本取自本项目 `package.json`。本版启用 Capacitor 的 Android 15 系统区域自动避让，修复设置入口连续点击和方向偏好保存。锁横屏允许左右横屏，自动模式跟随系统旋转设置。

设置触摸回归：启动本项目 Vite 后运行 `node scripts/test-mobile-settings-ui.cjs`（从仓库根目录运行，默认端口 1440，可用 `SETTINGS_URL` 指定地址）。模拟器验收使用 `scripts/test-mobile-settings-android.py --adb <adb路径> --serial emulator-5554 --output <结果目录> --cycles 20`；该脚本会调整模拟器的系统旋转及导航设置，只接受模拟器序列号。

输入布局由 `inputViewport.ts` 统一监听 Capacitor Keyboard 和浏览器可见视口。iPhone 恢复系统键盘辅助栏的“完成”入口，结束输入不提交表单，多行说明仍可回车换行。作业正文独立滚动，底部操作区占用自己的布局行；键盘打开时隐藏底部导航、正文与作业操作条进入同一个滚动区域，不重新创建输入框。不足 200px 的可见区域暂时隐藏应用顶栏，保存弹窗改为整体滚动，避免正文被操作区压到无法输入。触摸设备文字输入字号至少 16px。键盘收起后恢复正常布局，不清空表单。

教师逐题回放保留当前棋盘，下一题的数据、着法和皮肤图片准备好后一起切换，失败保留原题并可重试。题号默认收起，本设备的展开选择保存在 `xiangqi-teacher-problem-navigation-expanded-v1`，不覆盖已有底部／侧边导航偏好。

输入及切题回归从仓库根目录运行：

```bash
node scripts/test-mobile-input-analysis.cjs
node scripts/test-mobile-input-occlusion.cjs
node scripts/test-mobile-teacher-switching.cjs
node scripts/test-mobile-teacher-navigation.cjs
node scripts/test-mobile-teacher-results.cjs
```

输入脚本默认访问 1440 端口，教师脚本默认访问 1441 端口及测试环境；先启动对应 Vite 服务。输入遮挡检查覆盖文字区域的命中检测、移动端横竖屏和原生事件模拟，但不能代替 Android 原生软键盘及 iPhone 中文九宫格、英文、数字键盘真机验收。

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
