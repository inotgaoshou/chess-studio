# 天天象棋分支格式研究记录

## 目的与结论

本文记录天天象棋 H5 `getQipuMoveStep` / `getMoveBranchKey` 到本地 ICCS 棋谱树的格式证据。结论只覆盖已经由东萍原始解析器、参考导出器和本机脱敏失败样本共同验证的行为，不把腾讯私有接口当成公开稳定协议。

1. `getQipuMoveStep` 主线与 `getMoveBranchKey` 分支都使用 DhtmlXQ 棋盘坐标：`xyxy` 中 `y=0` 位于网页棋盘顶部。转换成项目使用的 ICCS 时，两者都必须执行 `rank = 9 - y`。
2. 腾讯分支键 `A-B-C` 应解释为：`A` 是父路线 ID，`B` 是父路线内从 1 开始的分支首着序号，`C` 是当前路线 ID。
3. 本地挂接点为 `localAfterPly = B - 1`。嵌套路线的绝对挂接点为 `parentPrefixBeforeRoute + localAfterPly`，不能直接把 `B` 当成绝对半回合数。
4. 必须在精确挂接点逐着重放；父路线缺失、`B=0`、局部位置越界或着法非法都应拒绝该盘，不能扫描其他局面寻找“碰巧合法”的位置。

## 来源

### 1. 东萍 DhtmlXQ 原始解析器

- 公开页面：<https://www.wxf-xiangqi.org/DhtmlXQ/DhtmlXQ_www_dpxq_com_Eng.htm>
- 公开 JavaScript：<https://www.wxf-xiangqi.org/DhtmlXQ/DhtmlXQ_www_dpxq_com_Eng.js>
- 本次核对使用的本地快照：`/private/tmp/dhtmlxq-reference.js`（SHA-256 `b154ce64a7502f93b4c9f15b24373d095719944170b6ddd986e0d3171d0f57f7`）

以下行号均指该本地快照，函数名可以在公开 JavaScript 中直接检索：

- `initdata`（约 716-751 行）把 `[DhtmlXQ_movelist]` 规范化为主线 `[DhtmlXQ_move_0_1_0]`，并按每 4 位计一着。
- 初始化棋盘（约 758-764 行）把棋子放到 `left = x * qgdx`、`top = y * qgdx`，证明第二位是从页面顶部向下增长的屏幕纵坐标。
- `getMove`（约 843-918 行）把同一份四位 `PT` 直接追加到当前路线；创建变招时生成 `DhtmlXQ_move_<parentRouteId>_<nnum+1>_<routeId>`。主线和变招没有两套坐标系。
- `ShowVarText`（约 1040-1061 行）在当前绝对着序号 `nnum` 查找 `DhtmlXQ_move_<currentRouteId>_<nnum>_<childRouteId>`，并把分支值的前 4 位交给同一个 `getMovelistString`。
- `havevar`（约 1110-1112 行）和 `getTree`（约 1622-1663 行）沿用相同三段路线标签递归发现子分支。

因此，标准东萍标签三段的含义是“父路线 ID、标准棋谱中的绝对首着序号、当前路线 ID”。这里的第二段是东萍输出目标格式的绝对序号，不应直接等同于腾讯 `getMoveBranchKey` 的第二段。

### 2. 参考导出器

参考程序：`/Users/chenyubin/Documents/chess/QiPuDaoChu202607022101/resources/app.asar`（SHA-256 `ad171d2bef38a6a27f3b88793a53aa042d23fe7a1a02e92545d28200897d69f1`）。

其可读脚本常量显示了实际采集路径：

- 调用 `window.fdk.getModel("QipuModel").jumpQipuGame(...)` 切换棋谱；
- 从 `NOTIFY_QIPU_DATA[0].thisObj._boardControl` 读取数据；
- 主线读取为 `getQipuMoveStep.toString().replaceAll(',', '')`；
- 分支读取为 `getMoveBranchKey`；
- 备注容器通过 `findObjectA(boardControl, "msg")` 查找；
- 初始局面通过受限的 `findStringWithSlash(boardControl)` 结果一并传回。

这些字符串位于 `app.asar` 的可读注入脚本区域，使用 `strings -t d` 可在约 `280867-282164` 字节附近复核。输出组装区还包含 `temp_arr`、`steps`、`total_steps` 和 `[DhtmlXQ_move_` 常量（约 `326222-326331` 字节），与“先读取腾讯局部路线，再换算为标准东萍绝对路线标签”的行为一致。由于主转换逻辑被编译为 V8 字节码，本文不把这些变量名单独视为公式证明；具体换算还必须由下述真实样本合法重放确认。

### 3. 本机脱敏诊断样本

本机开发库 `ttxq_diagnostic_samples` 的记录 `139-145` 覆盖 7 盘失败棋谱。研究只使用其中的 `qipuId`、起始 FEN 是否存在、分支键和受限坐标样本；没有复制 Cookie、令牌、HTML 或完整网页 JSON。

| qipuId | 路线数 | 嵌套路线数 |
|---|---:|---:|
| `77610281933` | 7 | 3 |
| `77607093144` | 19 | 9 |
| `55610361457` | 22 | 16 |
| `73613612347` | 9 | 5 |
| `77610272440` | 15 | 11 |
| `77610266118` | 17 | 12 |
| `77720077944` | 4 | 0 |

关键反例：

| 腾讯键 | 原始首着 | 错误解释 | 正确解释 |
|---|---|---|---|
| `0-4-1` | `7082` | 挂在第 4 半回合后，且不翻转得到 `h0i2` | 挂在第 3 半回合后，DhtmlXQ 转为 `h9i7` |
| `0-11-1` | `1927` | 挂在第 11 半回合后，且不翻转得到 `b9c7` | 挂在第 10 半回合后，DhtmlXQ 转为 `b0c2` |
| `0-18-1` | `7274` | 挂在第 18 半回合后，不翻转得到 `h2h4` | 挂在第 17 半回合后，DhtmlXQ 转为 `h7h5` |

这些样本分别来自 `77610281933`、`77610272440` 和 `77720077944`。它们同时排除了“分支使用原生 ICCS 纵坐标”和“第二段已经是 after-ply”两种假设。其余四盘包含非零父路线键，验证嵌套分支必须先恢复父路线前缀，再应用父路线内的 `B - 1`。

## 确定性换算

### 坐标

每四位 DhtmlXQ 坐标 `fFile fY tFile tY` 转 ICCS：

```text
from = file(fFile) + (9 - fY)
to   = file(tFile) + (9 - tY)
```

其中 `file(0..8) = a..i`。主线和分支必须调用同一转换函数；字段来源决定是否按 DhtmlXQ 解析，不能根据某一着“看起来是否合法”动态猜坐标模式。

### 路线键

对腾讯键 `A-B-C`：

```text
parentRouteId       = A
localStartPly1Based = B
routeId             = C
localAfterPly       = B - 1
absoluteAfterPly    = parentPrefixBeforeRoute + localAfterPly
```

- `A=0` 时父路线是主线，`parentPrefixBeforeRoute=0`。
- `A!=0` 时必须先找到 ID 为 `A` 的已解码父路线；父路线完整路径由“进入父路线前的主线/祖先前缀 + 父路线自身走法”组成。
- 转为标准东萍标签时，绝对首着序号是 `absoluteAfterPly + 1`；递归本地 DTO 的 `afterPly` 则保持相对直接父路线的 `localAfterPly`。

## 路线局面注解

天天象棋右侧“棋谱注解”与“棋谱评论”是两类数据。参考导出器通过
`findObjectA(boardControl, "msg")` 读取前者；其中 `{ msg, time, uname }` 是注解正文、时间和显示作者，不能作为分支走法。

东萍解析器 `ShowCommentText` / `EditComment` 使用
`DhtmlXQ_comment<routeId>_<absolutePly>`：

- `routeId=0` 表示主线，腾讯分支键 `A-B-C` 的路线使用来源 ID `C`；
- `absolutePly` 是从整谱起点开始的绝对半回合，不是分支内局部序号；
- 起始局面和主线第 2 半回合分别为 `comment0_0`、`comment0_2`；
- 本地界面编号与来源 ID 分离：主线显示为 `1`，来源分支 `C` 显示为 `C + 1`。

腾讯注解容器还使用 `R-P` 简写，两个数字分别是来源路线 ID 和从开局起的
绝对半回合，不是“步号-界面路线号”。本机真实失败样本中的 `11-2`、
`11-13`、`18-6` 因此分别等价于 `comment11_2`、`comment11_13`、
`comment18_6`。先前将其换算为 `route=P-1 / ply=R+1` 的
`legacy-step-route` 规则会稳定产生路线不存在或位置越界，已废弃。

桥接继续兼容 `R_P`、主线纯步号和起始局面别名；所有格式必须先转换为
`sourceRouteId + absoluteAfterPly`，再通过已经解码的完整路线节点路径定位。
普通社交评论列表没有位置键，不进入棋谱节点。

注解容器与分支字段必须物理隔离：`findObjectA(boardControl, "msg")` 的父容器
只用于注解，容器中的同级数字或可序列化对象也不能作为分支候选。分支存在性
只由当前控制器 `getMoveBranchKey` 下合法的 `A-B-C` 坐标项声明；数字按钮、
空包装对象和普通元数据不声明分支。切盘时分支结构签名和注解签名分别计算，
注解内容相同不能触发 `previous-game-branch-signature`。

## 实现约束

- Collector 只读取上述棋谱字段及受限诊断摘要，不扩大远程页面权限。
- Collector 不通过路线按钮切换或主线流差分推测分支；缺少合法 `A-B-C` 数据时按无分支处理。
- Decoder 必须保留字段来源，分别识别 DhtmlXQ、明确 ICCS 和中文着法，禁止内容猜测。
- Importer 只有在主线和全部已声明分支都能在精确锚点合法重放时才写入棋谱树。
- 失败诊断只保留定位所需的键、坐标模式、局部/绝对锚点、转换后首着和短样本；不得进入 outbox 或云同步。

## 可复核命令

```bash
rg -n "function (initdata|ShowVarText|get_movetext|havevar|getMove|getTree)" /private/tmp/dhtmlxq-reference.js
strings -t d /Users/chenyubin/Documents/chess/QiPuDaoChu202607022101/resources/app.asar | rg "getQipuMoveStep|getMoveBranchKey|findObjectA|steps|total_steps"
```
