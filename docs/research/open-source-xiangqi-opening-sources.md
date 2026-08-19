# 可随包分发的开源象棋开局资源调研

调研日期：2026-08-09。

目标是筛选能随棋研桌面版发布、且可用于后续商业分发的开局数据。仅“可下载”、
“GitHub 公开”或“个人免费使用”不构成可再分发授权。

## 可用候选：Xiangqi PWA Offline 开局局面集

- 上游仓库：[dffge552/xiangqi-pwa-offline](https://github.com/dffge552/xiangqi-pwa-offline)
- 授权：MIT；上游根目录的 `LICENSE` 明确许可使用、修改、分发和商业使用，但必须保留
  版权与许可文本。
- 锁定提交：`3ff21f4502a03f30bb0df55db6f3814ceeb989f5`（2026-05-09）。接入时必须固定到
  提交，不直接引用会变化的 `main` 分支。
- 数据文件：`opening-repertoire.json`，264 条，约 63 KB。
- 格式：`fen`、中文 `name`、`result`、`bestMove`、`timestamp`。其中 `bestMove` 大多为空，
  因而它适合“布局/FEN 识别与开局入口”，不应伪装成带胜率、频率或引擎推荐的统计开局库。
- 适用方式：转换为棋研的离线开局识别条目；保留上游 LICENSE、副本 SHA-256、来源 URL、
  锁定提交和本文件中的归属说明。

上游 README 对其全仓声明 MIT，并明确要求归属。README 还将部分题库来源致谢给
“从宽象棋”频道；本次只建议使用单独的 `opening-repertoire.json`，在发布前仍应保留其
上游声明与归属，不混入其题库或视频内容。

## 不可作为随包开局库的来源

| 来源 | 原因 | 可行处理 |
| --- | --- | --- |
| 五代梨花针、华丽象棋库、小冰裸奔天规库 | 未找到公开仓库或明确数据许可证。 | 仅允许用户本地选择导入；不纳入 Git、DMG、同步或公开下载。 |
| `nguyenpham/MRXqOpeningBook` | 是开局库生成工具，但 GitHub 未标注许可证。 | 不复制代码或数据；获得作者书面许可后再评估。 |
| `chasoft/community-xiangqi-games-database` | 包含大量 `.dpxq` 对局集合，但 GitHub 的仓库许可证字段为 `null`，README 也未给出可再分发许可。 | 不随包使用；可联系维护者确认数据授权。 |
| `hieunguyen/tuongky` | 根仓库为 MIT，但内容是网站程序与数据模型，没有可用棋局/开局数据文件。 | 可参考其公开接口设计，不作为数据源。 |

## 建议的接入顺序

1. 继续随包使用项目自有的 CC0 开局识别种子库。
2. 把本候选作为第二个、带 MIT 归属的“开局局面扩展包”，先接入布局识别，不显示虚假的
   胜率或推荐着法。
3. 大型统计开局库改由项目自行从**明确授权**的 PGN/XQF 数据构建：保存源清单、许可、
   SHA-256 和构建脚本，再发布衍生库。
4. 保留用户本地 XQB/OBK 导入通道，并在界面明确标为“外部本地棋库，授权由用户负责”。

## 一手来源

- [上游仓库与 MIT LICENSE](https://github.com/dffge552/xiangqi-pwa-offline)
- [锁定版本的开局数据](https://raw.githubusercontent.com/dffge552/xiangqi-pwa-offline/3ff21f4502a03f30bb0df55db6f3814ceeb989f5/opening-repertoire.json)
- [上游 README 的授权与归属说明](https://github.com/dffge552/xiangqi-pwa-offline/blob/3ff21f4502a03f30bb0df55db6f3814ceeb989f5/README.md)
- [本项目第三方资源要求](../../THIRD_PARTY_NOTICES.md)
