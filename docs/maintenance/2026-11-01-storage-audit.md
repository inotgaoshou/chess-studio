# 2026-11-01 线上空间盘点与历史程序副本清理

用户明确授权删除已盘点的 68 个历史维护程序副本。执行前重新核对当前发布目录、保留最近快照，并检查 `/proc` 中打开文件、映射、工作目录及可执行文件引用；持有既有维护锁后删除。

- 删除 `/var/lib/qixi-maintenance/releases` 内 68 个旧目录，文件计量 1,525,628,928 字节（约 1.42GiB）。保留 `20261028-teacher-authoring-r4` 和 `20261031-personal-authoring-10101`。
- 即时 statvfs 空闲变化为 319,324,160 字节，XFS 后续 `df` 显示可用约 47GiB；目录 du 与即时文件系统回收量不同，不混作精确收益。
- 审计回执在服务器 `/home/deploy/.local/state/qixi/maintenance-snapshots-cleanup-20261101.json`。没有创建备份、删除数据库、业务内容或未获本次删除授权的旧 MySQL 备份。
- 生产服务 active，ready 通过；测试服务继续保持停止和禁用自启。

当前较大占用：MySQL 约 9.2GiB（正式库约 8.5GiB）、业务内容约 1.7GiB、交换文件 4GiB、系统 `/usr` 约 4.6GiB、旧识别环境约 400MiB、9 月旧构建目录约 389MiB、JDK 安装归档约 188MiB、旧 MySQL 系统库备份约 180MiB、旧管理项目约 125MiB（其中 node_modules 约 113MiB）。最后这些项目仅盘点，未据大小自动删除；交换文件仍在使用，应保留。
