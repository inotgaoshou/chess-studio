# Third-party notices

本项目参考 `sojourners/public-Xiangqi`（TCHESS）的公开功能与 GPL-3.0 实现，主要涉及 UCI/UCCI 引擎交互、FEN/ICCS 表示、棋谱变例和开局库的功能组织。

桌面图标复制自该项目的 `src/main/resources/image/icon.png`；桌面棋盘、棋子和选中框素材复制自该项目的 `src/main/resources/ui/`。原项目许可证为 GNU General Public License v3.0，本项目同样以 GPL-3.0-only 发布。

任何随应用分发的第三方象棋引擎、NNUE 文件或开局库不自动继承本项目授权；发布者必须分别核查并遵守其许可证。

## Bundled engine

桌面包可随应用分发 `apps/desktop/src-tauri/resources/pikafish/` 与 `apps/desktop/src-tauri/resources/fairy-stockfish/` 两个引擎资源目录。Pikafish 与 Fairy-Stockfish 必须分目录放置，不能混用 `.nnue`；Fairy-Stockfish 在应用内会按中国象棋模式配置为 `UCI_Variant=xiangqi`。Fairy 的独立网络为官方 [Fairy-Stockfish-NNUE](https://github.com/fairy-stockfish/Fairy-Stockfish-NNUE) 的 `xiangqi-c07e94a5c7cb.nnue`，与 Fairy 可执行文件一起打包。象棋旋风、象眼及其他引擎仅支持用户从“引擎设置”手动添加；若用户自行分发这些外部引擎或对应 `.nnue` 文件，必须随包保留其许可证、README 和源码获取方式。Fairy-Stockfish 项目采用 GPL-3.0；分发时须同时遵守 NNUE 仓库和发布说明中适用的许可与源码义务。

## Built-in opening reference

`apps/desktop/src-tauri/resources/openings/xiangqi-openings-v1.json` 是本项目整理的离线开局识别种子库，采用 CC0-1.0 方式提供。首版包含 30 个常见布局分类和 120 条短线路；内容仅包含传统公开象棋布局名称和经 `xiangqi-core` 校验的 ICCS 着法序列，不包含第三方专有注释、评分或云端开局库数据。
