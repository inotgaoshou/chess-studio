# 象棋开局库数据许可核查

> 核查日期：2026-08-09。本文记录可审计的工程结论，不构成法律意见。

## 结论

| 候选 | 可核验事实 | 可否作为随包商业开局库 |
| --- | --- | --- |
| `五代梨花针`、`华丽象棋库`、`小冰裸奔天规库` | 未找到作者发布页、数据仓库或许可证。 | 否。仅允许用户自行选择本机文件。 |
| [`hieunguyen/tuongky`](https://github.com/hieunguyen/tuongky) | 仓库代码为 MIT；没有随仓库提交的棋谱、开局库或数据导出。 | 不能把 MIT 代码许可视为其可能的线上 datastore 数据许可。 |
| [`xqbase/eleeye`](https://github.com/xqbase/eleeye) 的 `BOOK/BOOK.DAT` | 仓库顶层是 LGPL-2.1，且文件在仓库内；文档称其由 1990--2004 年约 8,000 盘专业对局汇编。没有针对这些源棋谱或数据库的独立来源/权利声明。 | 不作为本项目可确定商业随包的来源；须由维护者书面确认数据权利与 LGPL 对该数据文件的适用范围。 |
| 本项目 `xiangqi-openings-v1.json` | 文件明确声明 `CC0-1.0`，来源限定为传统公开布局术语及本项目校验的 ICCS 短线。 | 是，但它是开局识别种子库，不是大规模实战棋谱库。 |

## `tuongky`：MIT 代码，不是数据集

- [仓库元数据](https://api.github.com/repos/hieunguyen/tuongky) 标记为 MIT；[LICENSE 原文](https://raw.githubusercontent.com/hieunguyen/tuongky/master/LICENSE) 允许使用、复制、修改、发布、分发、再许可和销售软件副本，保留版权与许可声明即可。
- [完整文件树](https://api.github.com/repos/hieunguyen/tuongky/git/trees/master?recursive=1) 只有 Java/App Engine 应用、datastore 模型/DAO、前端和少量练习 JSON；没有 `.pgn`、`.xqf`、`.cbr`、`.obk`、开局书或对局数据导出。
- [README](https://github.com/hieunguyen/tuongky/blob/master/README.md) 仅称其为 “Chinese Chess knowledge database”，未说明线上或用户录入数据的来源和许可证。

因此可以参考或按 MIT 条款复用其代码（仍需保留声明），但不能导出、复制或再分发未知来源的实际数据库内容。

## ElephantEye：有开局书文件，但数据权利仍不清楚

- [仓库元数据](https://api.github.com/repos/xqbase/eleeye) 标记为 LGPL-2.1；[LICENSE 原文](https://raw.githubusercontent.com/xqbase/eleeye/master/LICENSE) 是 GNU LGPL v2.1。
- [文件树](https://api.github.com/repos/xqbase/eleeye/git/trees/master?recursive=1) 包含 `BOOK/BOOK.DAT`、制作工具和若干 PGN。
- [开局库文档](https://raw.githubusercontent.com/xqbase/eleeye/master/DOC/eleeye_book.htm) 说明 `BOOK.DAT` 是 ElephantEye 的开局书，并称其由约 8,000 盘 1990--2004 年专业对局汇编而来。

仓库整体 LGPL 不足以单独证明每一盘源棋谱及汇编数据库均有清晰的商业再分发授权。若要使用该文件，先联系项目维护者取得覆盖 `BOOK.DAT`、源棋谱、修改及收费分发的书面确认；在确认前不把它放入 DMG、同步服务或公开下载。

## 已可随包的 CC0 种子库

[`apps/desktop/src-tauri/resources/openings/xiangqi-openings-v1.json`](../../apps/desktop/src-tauri/resources/openings/xiangqi-openings-v1.json) 的元数据明确为 `CC0-1.0`。它包含 30 个常用布局分类和 120 条从标准初始局面校验过的短 ICCS 线路；[第三方声明](../../THIRD_PARTY_NOTICES.md) 也记录其不包含第三方专有注释、评分或云端开局数据。

该文件可作为当前唯一的默认离线开局识别/推荐种子库。若需要大库，产品应提供用户本机导入，并在文件条目上保存来源与许可；只有获得数据作者明确的 CC0、MIT、CC-BY 或其他覆盖商业再分发的许可后，才升级为随包数据。

## 产品决策

1. 继续支持外部 `.obk`、`.xqb`、PGN 等本地导入，但默认不上传、不同步、不打包。
2. 在“开局库”界面区分“内置 CC0 种子库”和“用户本地库”，显示本地库的来源/许可证由用户负责。
3. 不使用名称、GitHub 仓库可见性或项目代码许可证来推定外部棋谱数据可再分发。
