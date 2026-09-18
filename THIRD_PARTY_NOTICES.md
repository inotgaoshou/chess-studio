# Third-party notices

本项目参考 `sojourners/public-Xiangqi`（TCHESS）的公开功能与 GPL-3.0 实现，主要涉及 UCI/UCCI 引擎交互、FEN/ICCS 表示、棋谱变例和开局库的功能组织。

桌面图标复制自该项目的 `src/main/resources/image/icon.png`；桌面棋盘、棋子和选中框素材复制自该项目的 `src/main/resources/ui/`。原项目许可证为 GNU General Public License v3.0，本项目同样以 GPL-3.0-only 发布。

任何随应用分发的第三方象棋引擎、NNUE 文件或开局库不自动继承本项目授权；发布者必须分别核查并遵守其许可证。

## Bundled engine

桌面包随应用分发 `apps/desktop/src-tauri/resources/pikafish/` 中的 Pikafish 与固定版本 `pikafish.nnue`；独立残局训练 Android arm64 APK 也随包分发 `apps/endgame-training/android/app/src/main/` 中的对应引擎和 NNUE。当前固定发布为 `Pikafish-2026-09-06`，源码仓库为 `https://github.com/official-pikafish/Pikafish`，源码提交为 `4c17cee11f888ae1d48a9494f2e2239f019f0a1f`，Android arm64 引擎 SHA-256 为 `6c06b8752e10c1ed605fa836d2c9bbf885e9c402b216023040ddf4586f4320b1`，桌面与移动共用 NNUE SHA-256 为 `7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e`。

分发任何内置 Pikafish/NNUE 的 APK、IPA、DMG 或 NSIS 安装包时，必须同时包含或随附：GPLv3 许可文本、Pikafish `Copying.txt`、`NNUE-License.md`、本 `THIRD_PARTY_NOTICES.md`、资源 `RESOURCE-MANIFEST.txt`、Pikafish 版本、源码提交、可复现的源码获取方式、构建脚本和资源 SHA-256。桌面构建脚本为 `scripts/build-pikafish-from-source.sh` 与 `scripts/prepare-pikafish-resource.sh`；独立残局训练 iOS 版由 `PIKAFISH_IOS_ROOT` 指向的 `pikafish-ios` 源工程执行固定版本构建和资源嵌入。

发布页、支持页、应用内关于页和本通知必须保持同一组版本、源码提交、哈希与许可说明。发布前的资源校验脚本会拒绝缺少许可材料、源码/构建材料说明、哈希不一致、Fairy-Stockfish、其他 NNUE、未知来源引擎或网络下载混入的引擎文件。Fairy-Stockfish、象棋旋风、象眼及其他第三方引擎不随应用分发。

## Built-in opening reference

`apps/desktop/src-tauri/resources/openings/xiangqi-openings-v1.json` 是本项目整理的离线开局识别种子库，采用 CC0-1.0 方式提供。首版包含 30 个常见布局分类和 120 条短线路；内容仅包含传统公开象棋布局名称和经 `xiangqi-core` 校验的 ICCS 着法序列，不包含第三方专有注释、评分或云端开局库数据。

## Move feedback audio

行棋、吃子与鼓点/破风提示音由应用运行时通过 Web Audio API 合成。`apps/desktop/public/audio/move.wav`、`capture.wav`、`check.wav` 和 `checkmate.wav` 是 Xiangqi Studio 分发的原创反馈资源；其中后 3 段使用本机离线语音合成生成“吃！”、“将军！”与“绝杀！”，不是从其他应用或游戏复制的录音。上述素材均不包含第三方音频素材。
