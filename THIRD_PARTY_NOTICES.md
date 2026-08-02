# Third-party notices

本项目参考 `sojourners/public-Xiangqi`（TCHESS）的公开功能与 GPL-3.0 实现，主要涉及 UCI/UCCI 引擎交互、FEN/ICCS 表示、棋谱变例和开局库的功能组织。

桌面图标复制自该项目的 `src/main/resources/image/icon.png`；桌面棋盘、棋子和选中框素材复制自该项目的 `src/main/resources/ui/`。原项目许可证为 GNU General Public License v3.0，本项目同样以 GPL-3.0-only 发布。

任何随应用分发的第三方象棋引擎、NNUE 文件或开局库不自动继承本项目授权；发布者必须分别核查并遵守其许可证。

## Optional bundled engines

`apps/desktop/src-tauri/resources/pikafish/` 和 `apps/desktop/src-tauri/resources/fairy-stockfish/` 是可选的桌面引擎资源目录。每个引擎必须和自己的 NNUE 文件放在独立目录中：Pikafish 不复用 Fairy-Stockfish 的网络，Fairy-Stockfish 也不复用 `pikafish.nnue`。Windows/macOS 发布包可以内置 Fairy-Stockfish；Linux 包可以不内置 Fairy-Stockfish，仅保留外部引擎配置能力。若发布包包含 Pikafish、Fairy-Stockfish 或对应 `.nnue` 文件，发布者必须随包保留其许可证、README 和对应源码获取方式。Fairy-Stockfish 项目采用 GPL-3.0；Xiangqi NNUE 权重需按其来源许可证分别确认。

## Built-in opening reference

`apps/desktop/src-tauri/resources/openings/xiangqi-openings-v1.json` 是本项目整理的离线开局识别种子库，采用 CC0-1.0 方式提供。首版包含 30 个常见布局分类和 120 条短线路；内容仅包含传统公开象棋布局名称和经 `xiangqi-core` 校验的 ICCS 着法序列，不包含第三方专有注释、评分或云端开局库数据。
