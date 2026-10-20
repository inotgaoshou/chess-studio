# 手机题库精简验收 · 2026-10-20

本轮客户端实现提交 `2e9478a0`。仅调整手机／平板题库浏览模式；服务端接口、权限、题目、作业快照、成绩和线路学习数据未改动。

## 实现结果

- 学生、VIP 和老师的题库章节顶部只显示“返回＋章节名”；移除路径、目录／题名搜索、顶部题数及“查看说明”。首页无返回按钮。
- 移除手机题库的线路复现标签、说明和空状态；保留做题训练与教材讲解。首次进入训练模式，旧 rehearsal 缓存回到训练，隐藏搜索词清空。
- 目录内容内边距 10px、间距 8px、章节行最小 60px、模式切换及按钮最小 44px；筛选与模式切换同一行。题目保留棋盘、题名、先手、目标、验证步数及看题解。
- 账号隔离缓存保存各级目录的分页与滚动位置。离开练习再返回后仍可恢复父目录位置。翻页请求在离开目录时取消，过期请求不再占用新页面的 busy 状态。
- 教师布置作业的选题模式保留搜索、筛选、跨章节选择、去重、排序与批量操作。桌面和后台线路功能保留。

## 验收结果

| 检查 | 方法和范围 | 结果 |
|---|---|---|
| 窄屏与平板、三种角色 | 实际 App + 模拟 API；375/390/430/800px × 普通学生/VIP/老师 | 12 组通过；无横向溢出，长导航单行，按钮≥44px |
| 导航、分页与读题 | 逐级进入返回、题目分页、目录分页、父目录滚动恢复、看题解、教材切换、进入练习 | 通过 |
| 故障与缓存 | 500、重试、15 秒超时、加载中返回、迟到响应、连续返回、旧搜索/rehearsal 状态恢复 | 通过 |
| 角色分层 | 普通/VIP/过期VIP/老师/管理员；分类切换、权益收回 | 5 组通过 |
| 教师作业 | 390/1024px 完整布置向导；两章节各25/10题含5道重复题，选中去重30题、调整顺序、20/10分批、模拟发布 | 2 组通过；请求携带原题目版本、无重复 |
| 既有练习回归 | 390/800/1280px × 普通/VIP/老师；读题、答题、自动应手、完成、教师本地进度、超时重试 | 通过 |
| Android 原生模拟器 | 隔离包 `.practiceentry`；真实 WebView/SQLite/WASM + 模拟 API；目录分页、返回、过滤、读题及进入练习 | 通过 |
| Android 真实测试后端 | 无接口拦截；普通/VIP/老师专用账号；读题、正确完成、重来及返回 | 通过；学生/VIP各1会话1成绩，教师0学生会话0成绩 |
| iOS 原生模拟器 | iOS 18.6；签名的隔离包 `.compactcatalog`；真实测试后端、普通专用测试账号；目录、读题、模式切换、筛选、练习及返回 | XCTest 1项通过，36.77秒 |
| 自动测试与构建 | 36项前端测试、TypeScript、测试／正式环境Vite构建、Android Release、iOS Archive | 通过 |

iOS 模拟器使用临时工程副本，仅额外预置专用测试账号会话；正式源码和正式包不包含该预置逻辑。最初的未签名模拟器包未能装载钥匙串会话，改为本地签名后通过；XCTest 对 `aria-pressed` 按钮呈现为 Switch，已调整测试选择器。没有操作、重装或自动测试用户的物理 iPhone。

教师作业发布使用模拟 API；未在正式环境创建作业。本轮不将健康检查或UI测试视为所有接口1秒达标的证据，之前搜索接口的性能遗留项仍按原报告保留。

## 产物与状态

本地候选版本 **1.0.6（10042）**，正式 API：`https://api.qixiapp.cn`。本机已用构建号10041，本轮递增10042。

`artifacts/release-1.0.6-10042/` 保存同签名 APK、同一 Archive 导出的设备安装 IPA 与 App Store IPA，以及 `manifest.json`、`SHA256SUMS` 和 `evidence/`。

- APK实测版本10042、1.0.6；发布证书SHA-256与10040一致。
- 两种IPA实测版本10042、1.0.6、bundle ID一致；NNUE符合固定指纹。APK与两种IPA的前端JS哈希完全一致。
- 设备IPA使用已有开发签名方式（debugging/development），适用于已登记设备；不是任意设备分发包。
- 设备未安装此候选包，物理手机仍是10040，最终操作验收由用户执行。
- 未上传App Store Connect，未提审。浏览器工具返回 `unsupported Codex auth method: apikey`，本轮无法重新读取远端最大构建号；此前观察值10033仅为历史记录。10042必须在未来上传前重新核对占用情况，必要时重新统一递增打包。
- 无后端发布、数据库迁移、线上数据清理或新增备份；正式服务保持 `20261020-api-entry-v40r1`，binlog规则未改动。

## 复测入口

运行Vite时使用 `VITE_TEACHING_API_BASE=http://127.0.0.1:8090`，端口1452。以下脚本均不写正式环境：

```sh
node scripts/test-compact-catalog-ui.cjs
PRACTICE_URL=http://127.0.0.1:1452 node scripts/test-catalog-opening-ui.cjs
LIBRARY_URL=http://127.0.0.1:1452 node scripts/test-student-catalog-access.cjs
node scripts/test-compact-catalog-assignment.cjs
CATALOG_ANDROID=1 node scripts/test-compact-catalog-ui.cjs
PRACTICE_REAL_ACCOUNTS=/path/to/private-test-accounts.json node scripts/test-android-practice-real-api.cjs
```

真实后端脚本仅允许专用模拟器和测试账号；账号文件不纳入代码或证据。iOS验收Swift脚本、模拟器截图、浏览器截图及结果日志保存于本地 `evidence/`。
