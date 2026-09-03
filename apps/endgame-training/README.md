# 残局训练 Android 平板应用

独立 Android 应用，包名为 `cn.xiangqi.endgame.training`，可与 Xiangqi Studio 主应用并存。它只提供离线 CBL 导入与残局训练；题库和答题记录写入该应用的私有 SQLite，安装包不包含任何 CBL 或用户数据。

目标为 Android 10+ 的 `arm64-v8a` 平板，首要验收设备是荣耀平板 X10 Pro 8GB+128GB。横屏使用目录、棋盘、控制栏三栏布局；竖屏会堆叠为可滚动布局。

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

产物为 `android/app/build/outputs/apk/release/app-release.apk`。在平板上可通过 Android Studio、`adb install -r` 或文件管理器安装。
