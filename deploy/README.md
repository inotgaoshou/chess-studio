# 旧版部署说明

This document describes the older standalone `xiangqi-server` deployment and
must not be used for the live Qixi administration platform. The live platform
uses the complete `xiangqi-admin-server` release pipeline in
`/Users/chenyubin/Documents/xiangqi-admin-private`, with immutable releases at
`/opt/qixi-admin-api/releases` on the CVM. Its authoritative operations guide
is `docs/qixi-release-runbook.md` in that repository.

The supported public endpoints are:

| Host | Role |
| --- | --- |
| `admin.qixiapp.cn` | production operations UI |
| `api.qixiapp.cn` | production application API |
| `admin-test.qixiapp.cn` | test operations UI |
| `api-test.qixiapp.cn` | test application API |

The rest of this file is retained only as historical reference. Do not run its
service, database, or Nginx installation commands against the current CVM.

# 腾讯云线上部署（历史说明）

此目录部署 `xiangqi-server`，不使用 Docker。它不会替换现有的
`xiangqi-admin.service` 或其 IP 访问方式。

| 域名 | 服务 |
| --- | --- |
| `qixiapp.cn` | Nginx 静态支持页和隐私政策 |
| `admin.qixiapp.cn` | 现有管理后台静态页与 `127.0.0.1:8090` API |
| `api.qixiapp.cn` | 正式 `xiangqi-server`，仅监听 `127.0.0.1:8080` |
| `api-test.qixiapp.cn` | 测试 `xiangqi-server`，仅监听 `127.0.0.1:8081` |

## 先决条件

在腾讯云备案控制台确认 `qixiapp.cn` 已接入这台 CVM，且根域名备案覆盖
这些子域名。不要在备案或 DNS 尚未生效时启动公网 API。

在 DNSPod/腾讯云 DNS 添加以下 A 记录，全部指向 CVM 公网 IP：`@`、`admin`、
`api`、`api-test`。添加 `www` 的 CNAME 到 `qixiapp.cn`（或同 IP 的 A 记录）。
等待以下命令均返回该 IP：

```bash
dig +short qixiapp.cn A
dig +short admin.qixiapp.cn A
dig +short api.qixiapp.cn A
dig +short api-test.qixiapp.cn A
```

在腾讯云控制台的“SSL 证书”申请四张 DV 免费证书，使用 DNS 验证。`qixiapp.cn`
这张证书必须同时包含 `www.qixiapp.cn` 的 SAN；其余三张分别用于 `admin`、`api`
和 `api-test`。域名同账号时选择自动 DNS 验证。证书签发后下载 **Nginx** 格式，保存为：

```text
/etc/nginx/certs/qixiapp.cn/fullchain.pem
/etc/nginx/certs/qixiapp.cn/privkey.pem
/etc/nginx/certs/admin.qixiapp.cn/fullchain.pem
/etc/nginx/certs/admin.qixiapp.cn/privkey.pem
/etc/nginx/certs/api.qixiapp.cn/fullchain.pem
/etc/nginx/certs/api.qixiapp.cn/privkey.pem
/etc/nginx/certs/api-test.qixiapp.cn/fullchain.pem
/etc/nginx/certs/api-test.qixiapp.cn/privkey.pem
```

使用 root 安装目录，私钥必须是 `0600`：

```bash
sudo install -d -m 0700 /etc/nginx/certs
sudo install -d -m 0700 /etc/nginx/certs/qixiapp.cn /etc/nginx/certs/admin.qixiapp.cn /etc/nginx/certs/api.qixiapp.cn /etc/nginx/certs/api-test.qixiapp.cn
sudo chown -R root:root /etc/nginx/certs
sudo find /etc/nginx/certs -name privkey.pem -exec chmod 0600 {} +
sudo find /etc/nginx/certs -name fullchain.pem -exec chmod 0644 {} +
```

腾讯云证书续签或替换后，先执行 `sudo nginx -t`，确认通过才执行
`sudo systemctl reload nginx`。不要把 Cloudflare 代理置于这些 API 前面；本方案
使用腾讯云/DNSPod DNS 和腾讯云证书。

## MySQL 隔离与密码轮换

此前出现在聊天记录中的数据库密码必须视为已泄露，不能写回环境文件、脚本、
代码仓库或命令历史。为两个 API 创建新的独立 MySQL 账号。密码使用
`openssl rand -hex 32` 生成，以免在 MySQL URI 中需要转义。

先用具备管理员权限的交互式终端做备份，生产首次启动前必须成功完成一次恢复演练：

```bash
sudo install -d -m 0700 /var/backups/xiangqi
sudo mysqldump --single-transaction --routines --events --triggers --databases chess \
  | sudo tee /var/backups/xiangqi/chess-before-xiangqi-server.sql >/dev/null
sudo sh -c 'sha256sum /var/backups/xiangqi/chess-before-xiangqi-server.sql > /var/backups/xiangqi/chess-before-xiangqi-server.sql.sha256'

# Separate dump without CREATE DATABASE, suitable for a non-production restore drill.
sudo mysqldump --single-transaction --routines --events --triggers chess \
  | sudo tee /var/backups/xiangqi/chess-restore-drill.sql >/dev/null
sudo mysql -u root -p -h 127.0.0.1 -P 3456 -e 'DROP DATABASE IF EXISTS chess_restore_drill; CREATE DATABASE chess_restore_drill CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;'
sudo sh -c 'mysql -u root -p -h 127.0.0.1 -P 3456 chess_restore_drill < /var/backups/xiangqi/chess-restore-drill.sql'
sudo mysql -u root -p -h 127.0.0.1 -P 3456 -e 'SELECT COUNT(*) AS table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = "chess_restore_drill";'
sudo mysql -u root -p -h 127.0.0.1 -P 3456 -e 'DROP DATABASE chess_restore_drill;'
```

恢复演练仅操作 `chess_restore_drill`，不要把它或备份重新导入 `chess`。随后审计
生产表名。`xiangqi-server` 的启动迁移使用
`CREATE TABLE IF NOT EXISTS`，这不能证明同名旧表的结构兼容：

```bash
mysql -u root -p -h 127.0.0.1 -P 3456 chess < deploy/mysql/audit-chess-schema.sql
# 对 audit 中每个 exists (inspect) 的表，逐一执行：
mysql -u root -p -h 127.0.0.1 -P 3456 -e 'SHOW CREATE TABLE chess.users\\G'
```

只有确认同名表属于本服务且结构兼容后，才允许正式服务连接 `chess`。若有不明
冲突，停止并先迁移/隔离数据，不能依靠 `IF NOT EXISTS` 继续。

创建测试库：

```bash
mysql -u root -p -h 127.0.0.1 -P 3456 < deploy/mysql/create-chess-test.sql
```

在 MySQL 管理会话中，以新生成的十六进制密码分别执行以下语句。不要复用旧
`xiangqi_user` 账号，也不要让测试账号访问 `chess`：

```sql
CREATE USER 'xiangqi_studio_prod'@'127.0.0.1' IDENTIFIED BY 'NEW_PRODUCTION_HEX_PASSWORD';
CREATE USER 'xiangqi_studio_test'@'127.0.0.1' IDENTIFIED BY 'NEW_TEST_HEX_PASSWORD';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES ON chess.* TO 'xiangqi_studio_prod'@'127.0.0.1';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, DROP, REFERENCES ON chess_test.* TO 'xiangqi_studio_test'@'127.0.0.1';
FLUSH PRIVILEGES;
```

迁移可能创建外键和索引，因此部署初期需要上述 DDL 权限。稳定后可根据实际
迁移策略收紧。先检查旧账号的 host/grant 与使用者，再轮换其密码，或在确认
不再使用后删除它：

```sql
SELECT User, Host FROM mysql.user WHERE User = 'xiangqi_user';
SHOW GRANTS FOR 'xiangqi_user'@'THE_HOST_RETURNED_ABOVE';
-- 更新所有仍需保留的 host 记录，并同步修改唯一对应的消费者配置：
ALTER USER 'xiangqi_user'@'THE_HOST_RETURNED_ABOVE' IDENTIFIED BY 'NEW_UNIQUE_HEX_PASSWORD';
```

不要猜测 host 值，也不要删除仍被 `xiangqi-admin` 使用的账号。完成迁移后，在
腾讯云安全组删除 TCP `3456` 入站规则；MySQL 配置设为
`bind-address = 127.0.0.1`（远程管理使用 SSH 隧道），重启前先确认现有后台
同样走本机地址：

```bash
sudo ss -lntp | grep ':3456'
sudo systemctl restart mysqld
sudo ss -lntp | grep ':3456'
```

目标是只看到 `127.0.0.1:3456` 或 `[::1]:3456`，绝不能看到 `0.0.0.0:3456`。

## 安装服务与 Nginx

以下命令在 CVM 的仓库 `/opt/chess/chess-studio` 运行。环境文件只由 root 读取，
systemd 在启动 `deploy` 用户进程时将变量传入：

```bash
cd /opt/chess/chess-studio
sudo install -d -m 0700 /etc/xiangqi-studio
sudo install -o root -g root -m 0600 deploy/env/production.env.example /etc/xiangqi-studio/production.env
sudo install -o root -g root -m 0600 deploy/env/test.env.example /etc/xiangqi-studio/test.env
sudoedit /etc/xiangqi-studio/production.env
sudoedit /etc/xiangqi-studio/test.env

sudo install -m 0644 deploy/systemd/xiangqi-studio-production.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/xiangqi-studio-test.service /etc/systemd/system/
sudo install -m 0755 scripts/check-qixi-certificate-expiry.sh /usr/local/sbin/check-qixi-certificate-expiry
sudo install -m 0644 deploy/systemd/qixi-certificate-expiry.service /etc/systemd/system/
sudo install -m 0644 deploy/systemd/qixi-certificate-expiry.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable xiangqi-studio-production.service xiangqi-studio-test.service qixi-certificate-expiry.timer
```

Fill both environment files with the two new database passwords and different values from
`openssl rand -hex 48` for `JWT_SECRET`. Do not configure a server-side Pikafish path until
the binary and NNUE have separately been installed and smoke-tested.

Install the test access file before the Nginx vhost. It denies all public test traffic by
default. Add only stable office/VPN IP addresses, one `allow` line per address:

```bash
sudo install -m 0644 deploy/nginx/xiangqi-test-access.conf.example /etc/nginx/conf.d/xiangqi-test-access.conf
sudoedit /etc/nginx/conf.d/xiangqi-test-access.conf
sudo install -m 0644 deploy/nginx/qixiapp.conf /etc/nginx/conf.d/qixiapp.conf
sudo nginx -t
sudo systemctl reload nginx
```

The existing `xiangqi-admin.conf` stays installed. The new named admin host serves the
same admin static build and only proxies `/api/` and `/health` to port 8090.

## Deploy sequence

Deploy the support site, then test API. `deploy-qixi-server.sh test` requires a clean
worktree, builds the checked-out commit, records its commit and SHA-256, atomically switches
only the test `current` link, restarts its service, and checks the loopback health endpoint.

```bash
cd /opt/chess/chess-studio
./scripts/deploy-qixi-site.sh
./scripts/deploy-qixi-server.sh test
curl --fail http://127.0.0.1:8081/health
```

Before production, test login, sync push/pull, personal-manual sync, teaching flows and
failed-request retry against the test service. Run the public verifier from a machine
outside the allowed test IP list; it expects a `403` response by default:

```bash
QIXI_SERVER_IP=YOUR_CVM_PUBLIC_IP ./scripts/verify-qixi-public.sh
```

From an allowlisted test client, verify success instead:

```bash
EXPECT_TEST_STATUS=200 QIXI_SERVER_IP=YOUR_CVM_PUBLIC_IP ./scripts/verify-qixi-public.sh
```

Once the test release is accepted, repeat the production schema audit and backup checks.
With the same clean checkout still at that commit, production deployment copies the exact
tested binary after checking its recorded commit and SHA-256; it does not rebuild:

```bash
git rev-parse HEAD
./scripts/deploy-qixi-server.sh production
curl --fail http://127.0.0.1:8080/health
```

For mobile release builds, the TestFlight workflow now defaults
`VITE_TEACHING_API_BASE` to `https://api.qixiapp.cn`. The value is compiled into the app;
use the test host only for a deliberately allowlisted test build.

## Certificate reminder and routine verification

The daily timer writes certificate status to systemd journal and exits nonzero within
21 days of expiry, which should be attached to a Tencent Cloud monitor/alert:

```bash
sudo systemctl start qixi-certificate-expiry.service
sudo systemctl list-timers qixi-certificate-expiry.timer
journalctl -u qixi-certificate-expiry.service --since today
```

After every certificate update, run `sudo nginx -t`, reload Nginx, then run the public
verifier. Also keep these routine checks:

```bash
sudo systemctl is-active xiangqi-admin xiangqi-studio-production xiangqi-studio-test nginx mysqld
sudo ss -lntp | grep -E ':(8080|8081|8090|3456)'
```

Expected listeners are `127.0.0.1:8080`, `127.0.0.1:8081`, `127.0.0.1:8090`, and local-only
MySQL. Ports 8080, 8081, 8090 and 3456 must not be opened in a Tencent Cloud security group.
