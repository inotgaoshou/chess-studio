# v1.0.6（10036）优化与验收

## 发布约束

按用户最新要求：先优化、验证及手机覆盖安装，暂不上传 App Store Connect、不提交审核。离线导出 App Store IPA 不代表上传或提审。

客户端运行时代码：`98f52c5bf892dc6760a3f04fb47445d5ebb35639`；`ccb435f1c5287525b09d01a306481ea71e5e56f1` 仅补充 WebKit 错误重试回归。

证据保存在主仓库 `.local/v106-appstore-20261019`（权限0700）。备份中的业务数据、会话和凭据不写入本记录。

## 用户问题及修复

1. 练习首页原先先等待离线记录补交，补交卡住会一直显示读取中。现在首页读取独立执行，沿用在线/可见性生命周期补交；首页、创建、恢复读取有15秒超时和可见重试。创建请求不自动重试，防止重复创建。
2. 开始按钮区分加载、创建、失败和无内容状态；已有首页内容后台刷新时仍可操作。
3. 题库页面按账号、权益及来源隔离缓存，返回时先恢复已读卡片和位置，再刷新；教师来源筛选贯穿首屏、分页和整章选题。
4. 后台练习创建先筛元信息，再分批读取最终题解，保留原抽题及已布置排序规则；兼容已有公开练习快照，不放宽新建权限。
5. 普通学生专题详情复用兼容成员快照，搜索在同一 RR 事务内探测别名；无别名时省略无关扩展，存在别名仍使用完整资格规则。
6. 学习打卡沿用本次合入的紧凑布局：任务优先、详情就地下展、说明与周进度折叠，保留草稿和提交防重。

## 已通过的自动化

| 范围 | 结果 | 证据文件 |
| --- | --- | --- |
| 移动端单元 | 28/28 | `mobile-unit-final.log` |
| 环境、会话、请求超时及补交隔离 | 38/38 | `mobile-environment-final.log` |
| 手机尺寸开始练习到可操作棋盘 | Chromium、WebKit通过 | `practice-loading-ui-final.log`、`practice-loading-webkit.log` |
| 首页503后手动重试再开始 | WebKit通过 | `practice-loading-retry-webkit.log` |
| 五角色目录权限、来源、教师选题与导航 | 通过 | `test-student-access-final.log`、`test-mobile-library-roles-final.log`、`test-student-navigation-final.log` |
| 打卡紧凑布局、草稿、提交防重 | 通过 | `test-checkin-compact-ui.cjs.log`、`test-mobile-checkin-ui.cjs.log` |
| WASM、移动端构建 | 通过 | `wasm-build.log`、`mobile-build-final.log` |
| 合并后后台单元 | 65通过、15集成测试单独运行 | `backend-unit-merged.log` |
| 合并后真实MySQL目录及权限/统计 | 通过 | `backend-catalog-mysql-merged.log` |
| 合并后真实MySQL答案复核 | 通过 | `backend-answer-mysql-merged.log` |
| 作业修订、待审核题解、杀法合集MySQL回归 | 通过 | `backend-mate-mysql-final.log` |
| 后台Web | 166通过、3跳过；构建通过 | `backend-web-final.log`、`backend-web-build-final.log` |

测试使用专用测试库；浏览器模拟通过不等于 iPhone 真机通过。

## 包校验

- Bundle ID：`cn.xiangqi.endgame.training`；Team：`US68YTUSG4`；版本1.0.6，构建10036。
- 同一 Release Archive 导出 development 和 App Store IPA，二者签名 deep/strict 校验通过。
- 皮卡鱼固定 `Pikafish-2026-09-06` / `4c17cee11f888ae1d48a9494f2e2239f019f0a1f`；NNUE SHA-256 `7d13d73569a9b571ba0eb20cf1596247bc2a42738967e61afef6482b231e900e`。
- 包内引擎和NNUE许可证与固定发行材料逐字节核对通过；无Fairy资源；照片、相机中文用途说明已核对。
- 安装包和校验文件位于主仓库 `artifacts/v1.0.6-production-10036`。

## 仍需完成

- 后台最终候选须含专题详情、搜索和连接释放修复。`20261019-v106-10036` 服务器构建仅含旧 `cb7ce82`，已过时，禁止提升。
- 正式规模性能基线中普通学生搜索1371ms，未达<1000ms。新候选必须实测首请求、重复请求、冷启动和统计重建，结果真实非空，不能用403或空响应替代。
- iPhone14当前多次CoreDevice连接超时，业务容器备份和10036覆盖安装尚未成功。保持10035原应用及数据；不可卸载后安装。
- 真机升级保留、登录、目录、教师选题、训练复核、草稿、照片、键盘、断网恢复及重复提交均待真机证据。
- App Store隐私、截图、审核账号、删除入口及手动发布设置留待恢复提审任务时核对；目前未上传、未提审。

## 面向用户的候选更新说明

优化练习首页加载、失败重试和开始练习提示；改善题库目录返回与来源筛选；学习打卡改为任务优先的紧凑展示。多解验证、目录权限与草稿恢复继续完成正式环境和真机验收后，再决定纳入商店说明。
