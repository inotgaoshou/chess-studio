# 象棋旋风资源与许可核查

> 核查日期：2026-08-02。本文记录可审计的工程结论，不构成法律意见。

## 结论

截至核查日，**没有找到象棋旋风作者或权利人发布的可核验官方下载页、许可证、源码仓库、NNUE 权重下载，或书面再分发许可**。因此不应把旋风可执行文件或任何声称配套的 NNUE 文件放进 Xiangqi Studio 的 Windows 或 macOS 安装包；也不应从第三方整合软件中提取后再发布。

| 目标 | 可核验结果 | 发布决定 |
| --- | --- | --- |
| Windows x64 旋风 | 存在第三方应用的 Windows x64 整合发行，但不是旋风作者的发布页，且未附旋风许可。 | 不嵌入；仅允许用户自行选择本机文件。 |
| macOS Apple Silicon 旋风 | 未找到官方或可核验的 arm64/macOS 构建。第三方整合项目明确写明其受引擎限制“只能运行在 Windows 平台”。 | 不支持内置或下载。 |
| 旋风 NNUE | 未找到作者发布的 `.nnue` 文件、兼容性说明或许可证。旋风是传统闭源引擎的公开生态印象不能代替权利人声明。 | 不下载、不随包分发、不可假定需要 NNUE。 |
| 再分发/商用 | 未找到允许再分发、修改或商用的许可文本。 | 视为**未获授权**，须先取得权利人的书面授权。 |

## 可追溯来源

### 第三方 Windows 集成，仅用于平台事实，不是授权来源

- 开源应用 [imbatony/electorn-chinese-chess](https://github.com/imbatony/electorn-chinese-chess) 的仓库说明称其内置四款引擎，包括“旋风(cyclone)”，并明确说明“由于引擎限制，只能运行在 Windows 平台”。该仓库的 [README 原文](https://github.com/imbatony/electorn-chinese-chess/blob/main/README.md) 可核验这一表述。
- 该项目的 [GitHub Releases](https://github.com/imbatony/electorn-chinese-chess/releases) 仅列 Windows 发布物。例如 v0.0.19 的 x64 ZIP 是 [windows-win32-x64-0.0.19.zip](https://github.com/imbatony/electorn-chinese-chess/releases/download/v0.0.19/windows-win32-x64-0.0.19.zip)。这是第三方应用完整安装包，不是象棋旋风作者的官方下载，也没有可单独核验的旋风许可。
- 该仓库 GitHub API 元数据的 `license` 字段为 `null`，且其公开文件树未提供旋风自身的 `LICENSE`、作者源码或 NNUE 权重来源：[repository metadata](https://api.github.com/repos/imbatony/electorn-chinese-chess)、[file tree](https://api.github.com/repos/imbatony/electorn-chinese-chess/git/trees/main?recursive=1)。这不能证明旋风“无版权”，只能说明不能从这里取得再分发授权。

### 本项目现状

- 工作区搜索未发现名称含 `cyclone`、`xuanfeng` 或“旋风”的可执行文件，亦未发现旋风 `.nnue` 文件。
- 已存在的网络仅属于 Pikafish 和 Fairy-Stockfish，分别在 `apps/desktop/src-tauri/resources/pikafish/` 与 `apps/desktop/src-tauri/resources/fairy-stockfish/`。它们不能与旋风混用。
- 项目的 [第三方声明](../../THIRD_PARTY_NOTICES.md) 已将“象棋旋风、象眼及其他引擎”限定为用户手动添加，并要求自行分发时保留许可证、README 和源码获取方式；在尚无旋风许可证时，此要求无法满足。

## 允许的产品策略

1. 保持“外部引擎”导入：Windows 用户可自行选择其合法获得的旋风可执行文件，由应用通过 UCCI 握手使用；应用不托管、不自动下载、不复制该文件。
2. 不显示“内置旋风”或“下载旋风”入口，也不承诺 macOS 可用。导入界面应提示旋风是否需要额外数据文件以该版本作者文档为准。
3. 若需要随包提供，先取得权利人针对 Windows x64 和 macOS Apple Silicon 的书面授权，授权须明确覆盖二进制、必要数据/权重、更新分发、免费/收费模式及地域；同时获得相应 arm64/macOS 构建。拿到文件后再核验哈希、许可证和运行时协议。

## 未找到的官方链接

本次面向公开网页和 GitHub 的核查未找到以下“旋风官方 URL”，故不能提供或使用：

- 作者/权利人的官方下载页；
- Windows x64 独立引擎下载页；
- macOS 或 Apple Silicon 下载页；
- NNUE 权重下载页；
- 许可、EULA、再分发或商业授权条款。

因此，以上第三方 GitHub 链接只能作为“某第三方 Windows 程序曾集成旋风”的佐证，**绝不能作为下载、提取、重新托管或打包旋风的授权依据**。
