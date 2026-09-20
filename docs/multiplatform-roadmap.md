# Xiangqi Studio / 棋研 Roadmap Checklist

## Summary

把路线调整为：`v1.0.2` 是补齐版，不算完成基线；`v1.0.3` 做逻辑残棋；`v1.0.4` 做 iOS 大陆上架准备；`v1.1` 做多端稳定版。

## 当前几个端

- [x] 桌面主应用：`apps/desktop`，Tauri + React，完整复盘、录谱、Pikafish、本地库、报告、PDF/GIF/PGN。
- [x] 独立移动残局 App：`apps/endgame-training`，Capacitor iOS/Android，“棋研”，CBL 残局训练、本地 SQLite、移动 Pikafish、皮肤与自由拆棋。
- [x] 主应用移动轻量版：`apps/desktop` 的 Capacitor/Web 构建，轻量打谱、分支、离线缓存；不内置本地 Pikafish。
- [x] 服务端：`apps/server`，账号、同步、订阅、服务端分析、资料库能力；近期上架版默认不启用账号/付费。
- [x] 共享核心：`crates/*`，棋规、棋谱树、格式、WASM、引擎协议、本地存储、同步 DTO。

## Roadmap

### v1.0.2 补齐版：基础体验闭环

- [x] 增加桌面端与棋研移动端皮肤资源。
- [x] 增加棋研移动端皮肤目录与打包准备。
- [ ] 桌面端和棋研移动端统一棋盘/棋子皮肤选择、预览、恢复默认、持久化验收。
- [ ] 棋盘坐标、落子反馈、候选箭头、局面编辑棋盘全部跟随当前皮肤。
- [ ] 清理半成品皮肤：资源缺失、河界文字不可覆盖、棋子偏位、预览与实盘不一致。
- [ ] 桌面端补齐“新建手动录谱 → 走棋 → 自动保存 → 本地 Pikafish 分析 → 生成报告”闭环。
- [ ] 棋研自由拆棋保持轻量：可走棋、撤销、看候选、复制 FEN/棋谱。
- [ ] 分析结果只绑定当前 FEN/线路，线路变化后旧结果标记过期或清空。
- [ ] 桌面端局面编辑器完成增删棋子、切换行棋方、校验将帅照面、应用到棋盘。
- [ ] 棋研自由拆棋支持从标准局面、当前题局、手输 FEN 进入。
- [ ] 应用局面保持非破坏性：新建局面或新建拆棋，不覆盖已有棋谱分支。

### v1.0.3：逻辑残棋

- [x] 支持可选 `.logic.json` sidecar。
- [x] CBL 导入时可同时选择 `.cbl` 与 `.logic.json`。
- [x] 本地 SQLite 持久化逻辑残棋 JSON。
- [x] 训练题支持题型、战术主题、首着意图、关键防守、失败原因、复盘讲解。
- [x] 提示升级为三层：方向提示、战术点提示、首着提示。
- [x] 错误反馈支持具体错因：非法、未解将、丢先、未形成威胁、偏离主解但可行。
- [ ] 没有逻辑标注时，用题解树和 Pikafish 生成基础讲解。
- [x] 保持本地优先：不加账号、不加付费、不内置题库。

### v1.0.4：iOS 大陆上架准备

- [ ] iOS 优先，Android 和桌面继续安装包分发。
- [ ] 产品定位固定为“象棋学习工具”，避免在线对战、竞技运营、充值、排行榜。
- [ ] 补齐 App Store 元数据：隐私政策、支持页、审核说明、截图、许可说明。
- [ ] 补齐合规材料：Pikafish GPLv3、NNUE 许可、第三方通知、源码获取方式、构建哈希。
- [ ] 检查大陆上架要求：ICP备案/APP 备案、隐私政策、联网说明、第三方服务说明。

### v1.1：多端稳定版

- [ ] 桌面主应用：完整复盘中心，打磨报告、训练任务、导出、本地资料库。
- [ ] 棋研移动端：残局训练专项，打磨逻辑残棋、离线训练、Pikafish 拆棋。
- [ ] 主应用移动轻量版：只做随身打谱、分支树、云端分析、同步，不宣传本地引擎。
- [ ] 服务端：上架稳定后再恢复账号、同步、订阅、云端报告等能力。

## Test Plan

- [x] `pnpm --dir apps/endgame-training build`
- [x] `./gradlew :app:testDebugUnitTest`
- [x] `pnpm --dir apps/desktop test -- SkinShop PositionEditorBoard ReviewWorkspace analysisView`
- [ ] `pnpm --filter xiangqi-desktop-ui build`
- [ ] `cargo check -p xiangqi-desktop`
- [ ] `pnpm --dir apps/endgame-training ios:sync`
- [ ] `pnpm --dir apps/endgame-training android:apk`
- [ ] 发布前校验 Pikafish/NNUE 资源、许可证、隐私政策、支持页、版本号一致。

## Assumptions

- `v1.0.2` 当前不是完成态，而是需要继续补齐的基础版本。
- 大陆上架先走 iOS；Android 和桌面先包分发。
- 近期不加入账号、付费、题库下载、社区、排行榜。
- 棋研定位为象棋学习工具，不按在线游戏运营。
- 任何预览、拆棋、推演都不得写入真实棋谱树，除非用户明确点击“应用/落子/保存”。
