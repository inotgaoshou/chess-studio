# 飞刀/布局陷阱专题库来源说明

## 已整理文件

- `feidao-layout-traps-starter.pgn`
  - 12 局入门专题，来源于公开网页里的 `DhtmlXQ_movelist` 坐标串。
  - 已转换为 Xiangqi Studio 当前可导入的 PGN/ICCS 主线格式。
  - 只保留棋步事实和来源链接，不复制原站长篇讲解。

## 主要来源

1. 象棋谱 / xqipu
   - 飞刀搜索页：https://www.xqipu.com/search/qipu?keyword=%E9%A3%9E%E5%88%80
   - 站点搜索结果显示“飞刀”相关棋谱约 49 页，并有“飞刀谱”等专题分类。
   - 单谱页有人机验证，不适合无授权批量机器抓取正文。

2. 象棋棋谱网 / xiangqiqipu
   - 公开页面常带 `DhtmlXQ_movelist`，可以安全转换为 ICCS/PGN 主线。
   - 示例来源已写入 PGN 的 `[Source "..."]` 标签中。

3. GitHub 开放棋局数据库
   - https://github.com/chasoft/community-xiangqi-games-database
   - 数据格式为 `.dpxq`，不是 Xiangqi Studio 当前直接导入格式。
   - 后续可写 `.dpxq -> PGN` 转换器，再按开局/分差筛选“疑似飞刀”。

4. 鲨鱼象棋开局库生态
   - 官网：https://www.sharkchess.com/
   - 支持 `.obk/.xqb` 等开局库生态，可作为未来 Xiangqi Studio 支持本地飞刀库导入的兼容目标。

## 不建议直接下载/运行的资源

- 论坛或网盘里的“飞刀助手整合包”“强软+库+授权破解器”。
- `.exe/.dmg/.pkg` 等不明程序。
- 无来源说明、无校验、只在下载站搬运的 `.obk/.bin` 压缩包。

如果一定要试这类库，建议只提取纯数据文件，并放在隔离目录，不运行任何附带程序。
