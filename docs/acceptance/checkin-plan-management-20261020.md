# 原计划编辑、复制不重叠与删除：本地验收

日期：2026-10-20。本轮涉及 chess-studio 的共享打卡 UI，以及 xiangqi-admin-private 的服务端、迁移、后台镜像和接口回归。保留两仓库已有未提交修改；未提交 Git、部署、修改家庭账号计划或生成原生安装包。

## 最终行为

- 日常调整直接编辑同一计划，保留计划编号。填写生效日和修改原因，更新名称、结束时间、后续周模板。开始时间和接收名单锁定，封存计划不可编辑。
- 生效日不能早于北京时间今天或计划开始日。此前任务及有提交、照片、审核、幂等动作记录的任务保留原要求和编号；结束日不能排除受保护任务。
- 修改要求的未记录任务换新编号，旧离线提交不会误完成新要求。离线失败记录保留并停止自动重试。
- 复制只打开草稿，默认接在同一学生可见计划的最晚结束日之后，保持阶段天数；班级成员也参与默认日期推算。服务端使用发布时的实际学生名单检查北京时间日期重叠，补交期不算重叠。
- 机构锁串行化并发发布／日期变更。已有重叠不阻止在原覆盖范围内编辑，新覆盖日期仍检查冲突。
- 删除采用软删除，并检查版本与权限；从师生列表、统计移除，停止详情、照片读取和任务写入。保留底层数据与删除审计；重复 DELETE 幂等，旧 create/publish 请求不能复活计划。当前没有回收站页面，也不会自动合并、转移两份计划的提交记录。
- 后端迁移0054增加 revision 和变更审计。旧草稿 PUT 兼容；已发布计划 PUT 要求 expectedRevision、effectiveDate、reason。学生刷新时清除已删除计划的旧任务视图。

## 验证结果

- `python3 scripts/test-checkins-db.py`：通过。使用自动创建并清理的临时本机 MySQL，覆盖原有师生流程，以及原计划编辑、任务／照片保留、历史不可改、旧版本冲突、班级与单学生重叠、两个冲突计划并发发布仅一个成功、旧离线任务拒绝、真实 PUT/DELETE DTO、删除权限／幂等／防复活、编辑与提交竞争。
- 并发测试发现并修复 repeatable-read 旧快照竞态：提交／审核／上传先在事务外解析计划编号，再在事务内先锁计划后读任务，统一与编辑的加锁顺序。竞争结果为提交保留或旧任务拒绝，不再产生外键错误。
- `cargo test -p xiangqi-admin-server -- --test-threads=1`：64通过，15项依赖外部环境的测试跳过。上述打卡 MySQL 测试另外执行通过。
- `node --test scripts/checkin-navigation-ui.test.mjs scripts/checkin-statistics-ui.test.mjs`：22通过。包括原计划保存不创建／再发布、防重复保存、错误保留编辑、复制日期、删除确认，以及学生刷新清除旧计划视图。两项旧导航 fixture 明确选择周次，消除依赖运行日期的问题。
- `pnpm --filter xiangqi-endgame-training test`：28通过，包括跨年复制、同学生后续计划、班级与个人交集、离线旧任务保留。
- `npm run build:web`、`pnpm --filter xiangqi-endgame-training build`：通过。构建仍有现有 bundle 大小提示；Rust 有现有未使用 preview 函数提示。
- `node tools/sync-checkin-ui.mjs --check` 与两仓库 `git diff --check`：通过。

## 布局

使用共享组件和共享 CSS、模拟计划、无服务端请求的本地 Chrome 检查390／800／1280px。列表与编辑表单无横向溢出、无页面异常，四个操作按钮完整显示；人工查看390px编辑表单和800px列表截图。截图不代表完整后台外壳或原生设备验收。

- [手机编辑](assets/checkin-plan-management-20261020/editor-390.png)
- [竖屏平板列表](assets/checkin-plan-management-20261020/list-800.png)
- [横屏平板列表](assets/checkin-plan-management-20261020/list-1280.png)

上线需先应用迁移0054并更新服务端，再更新后台及手机前端。线上截图中的两份诗涵计划本轮未实际合并或删除；新管理操作尚未做 Android／iOS 原生验收。
