# 棋析 1.0.7（10071）安装与提审准备

日期：2026-10-28。

## iOS 包

- 已归档并分别导出 development、App Store IPA，均来自同一份 Release Archive。
- bundle：`cn.xiangqi.endgame.training`；最低 iOS 15；生产 API。
- 包含做题来源显示修复，以及本工作树已有的目录/列表加载改进。
- 逻辑测试 61 项、UI 测试 103 项通过；TypeScript/Vite 与 Xcode Archive/Export 通过。
- 签名校验通过，NNUE SHA-256 与固定版本一致；App Store IPA 的 276 个 Web 文件逐一与 Archive 一致。
- 连接的 iPhone 14 已覆盖安装，`devicectl` 回读 `1.0.7 / 10071`，启动成功，进程路径对应新安装目录。
- 未卸载应用。用户已确认真机显示与操作正常。

## 首页重复专题

已在正式后台停用旧首页“连续杀法专项”，保留“基础杀法”。题目、来源绑定和历史练习记录均保留。

用户仍见两个专题后，用正式审核测试账号直查 dashboard，断言失败，确认不是安装失败：数据库已停用，但旧 source statistics 快照仍返回该专题。全库刷新查询占着统计锁超过 17 分钟。

后端修复在独立工作树 `/Users/chenyubin/Documents/qixi-topic-status-fix`：VIP 首页和专题入口读取快照时，额外过滤当前数据库未启用的专题。非 VIP 原有实时规则保持不变。真实 MySQL 验收新增停用/恢复及直达入口用例，已先观察到修复前失败。

后端已发布 `20261028-topic-live-status-r1`，代码提交 `db510bf`。完整真实 MySQL 验收通过（121.59 秒）；正式只读预览与公网 dashboard 均只返回“基础杀法”。迁移文件逐一相同，未执行迁移命令，旧发布保留可回滚。后台 favicon 哈希与此前一致。已停止预览进程，正式服务 ready；手机随后成功重启以刷新首页。用户已确认连接的 iPhone 14 页面正常，并明确授权改用 10071 重新提审。

## App Store

实时核对时，1.0.7 / 10070 正在等待审核，1.0.6 可分发，发布方式为手动。

用户已明确授权上传 10071、撤回 10070 并重新提审，保留手动发布。命令行上传因找不到可用账号失败；通过 Xcode Organizer 对同一归档上传成功，10071 处理完成。10070 已撤回，已选择 10071、更新版本说明和审核备注，保存并重新提审。2026-10-28 13:06（北京时间）App Store Connect 明确显示 1.0.7（10071）等待审核，保持手动发布。提交 ID：0719af9e-8cf9-419e-bdfc-c6dc9c4e68a4；构建 ID：30ce8daf-3675-4184-bb1e-a70e1378fd69。凭证见 `submission.json` 与 `evidence/app-store-submitted-10071.png`。

## 证据

产物目录：`artifacts/releases/qixi-1.0.7-10071/`。

- `verification.json`：版本、NNUE/IPA 哈希、包内容验证。
- `evidence/device-install.json`、`device-apps.json`、`device-launch.json`：安装、回读、启动。
- `evidence/source-files-sha256.json`、`working-tree.patch`：脏工作树来源追踪。
- `.local/check-recommended-topics-20261028.py`：正式 dashboard 回归断言，凭据仅在内存使用。
- `.local/topic-live-red-20261028.log`、`.local/topic-live-green-20261028.log`：后端数据库验收。
