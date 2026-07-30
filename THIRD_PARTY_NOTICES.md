# Third-party notices

本项目参考 `sojourners/public-Xiangqi`（TCHESS）的公开功能与 GPL-3.0 实现，主要涉及 UCI/UCCI 引擎交互、FEN/ICCS 表示、棋谱变例和开局库的功能组织。

桌面图标复制自该项目的 `src/main/resources/image/icon.png`；桌面棋盘、棋子和选中框素材复制自该项目的 `src/main/resources/ui/`。原项目许可证为 GNU General Public License v3.0，本项目同样以 GPL-3.0-only 发布。

任何随应用分发的第三方象棋引擎、NNUE 文件或开局库不自动继承本项目授权；发布者必须分别核查并遵守其许可证。

## Built-in opening reference

`apps/desktop/src-tauri/resources/openings/xiangqi-openings-v1.json` 是本项目整理的离线开局识别种子库，采用 CC0-1.0 方式提供。首版包含 30 个常见布局分类和 120 条短线路；内容仅包含传统公开象棋布局名称和经 `xiangqi-core` 校验的 ICCS 着法序列，不包含第三方专有注释、评分或云端开局库数据。
