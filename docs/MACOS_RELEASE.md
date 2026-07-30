# macOS 正式签名、公证与 GitHub Release

本文档用于生成普通 Mac 用户可以直接双击打开的 `Xiangqi Studio.dmg`。目标是：

- 使用 Apple Developer Program 的 `Developer ID Application` 证书签名；
- 使用 Apple Notary Service 公证；
- 将公证票据 staple 到 DMG；
- GitHub Release 下载后不再提示“已损坏，无法打开”。

## 1. Apple 账号与费用

需要加入 Apple Developer Program，年费通常为 99 美元/年。个人账号会向用户显示个人真实姓名；组织账号会显示公司/组织名称，组织账号需要公司主体和 D-U-N-S Number。

## 2. 创建 Developer ID Application 证书

在 Apple Developer 网站创建证书：

1. 打开 `Certificates, Identifiers & Profiles`。
2. 新建证书，类型选择 `Developer ID Application`。
3. 按页面提示从“钥匙串访问”生成 CSR 文件并上传。
4. 下载生成的证书并双击安装到钥匙串。

安装后在本机验证：

```bash
security find-identity -v -p codesigning
```

应能看到类似：

```text
Developer ID Application: Your Name or Company (TEAMID)
```

这个完整名称就是 `APPLE_SIGNING_IDENTITY`。

## 3. 导出 GitHub Actions 使用的 p12 证书

在“钥匙串访问”中找到 `Developer ID Application` 证书，展开并确认它带有私钥，然后导出为 `.p12`：

1. 右键证书和私钥所在条目；
2. 选择“导出”；
3. 格式选择 `.p12`；
4. 设置一个导出密码。

把 `.p12` 转成 GitHub Secret 可用的 base64：

```bash
base64 -i developer-id-application.p12 | pbcopy
```

复制到 GitHub Secret：

- `APPLE_CERTIFICATE`：上一步复制的 base64 内容；
- `APPLE_CERTIFICATE_PASSWORD`：导出 `.p12` 时设置的密码；
- `APPLE_SIGNING_IDENTITY`：`Developer ID Application: ... (TEAMID)` 完整字符串。

## 4. 创建 Apple 公证凭据

推荐先使用 Apple ID + App 专用密码，配置最少：

1. Apple ID 必须开启双重认证；
2. 打开 Apple ID 账户页面，创建 App 专用密码；
3. 记录 Team ID。

GitHub Secrets：

- `APPLE_ID`：Apple Developer 登录邮箱；
- `APPLE_PASSWORD`：App 专用密码，不是 Apple ID 登录密码；
- `APPLE_TEAM_ID`：开发者团队 ID。

> 后续也可以改用 App Store Connect API Key：`APPLE_API_ISSUER`、`APPLE_API_KEY`、`APPLE_API_KEY_PATH`。本仓库脚本已支持本地 API Key 方式；当前 GitHub workflow 默认使用 Apple ID + App 专用密码。

## 5. GitHub Secrets 总表

在 GitHub 仓库打开：

`Settings -> Secrets and variables -> Actions -> New repository secret`

需要配置：

```text
APPLE_CERTIFICATE
APPLE_CERTIFICATE_PASSWORD
APPLE_SIGNING_IDENTITY
APPLE_ID
APPLE_PASSWORD
APPLE_TEAM_ID
```

这些 secret 不要提交到仓库，也不要写进 README 示例命令。

如果仓库或组织将 GitHub Actions 的默认 `GITHUB_TOKEN` 限制为只读，请额外创建一个 Fine-grained personal access token，并将其保存为仓库 Actions secret `RELEASE_TOKEN`。该 token 仅授予本仓库，且 `Contents` 权限设为 `Read and write`；不要在聊天、日志或代码中粘贴 token 值。

## 6. 触发 GitHub Release

方式一：推送标签。

```bash
git tag v1.0.1
git push origin v1.0.1
```

方式二：GitHub 页面手动触发。

1. 打开 `Actions -> Release`；
2. 点击 `Run workflow`；
3. 输入 tag，例如 `v1.0.1`；
4. 勾选 `Build macOS packages and upload them to this release`；
5. 等待 macOS Apple Silicon job 通过。

成功后会生成 Draft Release。确认 DMG 可用后，再手动发布 Release。

> 推送 release tag 时默认只构建 Windows 和 Linux，以尽快提供下载。需要 macOS DMG 时，针对同一 tag 手动运行一次该 workflow 并勾选上述选项，macOS 资产会追加到同一个 Draft Release。

## 7. 本地正式包构建

本地必须已经安装 Developer ID 证书，并配置公证凭据：

```bash
export APPLE_SIGNING_IDENTITY='Developer ID Application: Your Name or Company (TEAMID)'
export APPLE_ID='apple-id@example.com'
export APPLE_PASSWORD='xxxx-xxxx-xxxx-xxxx'
export APPLE_TEAM_ID='TEAMID'

PNPM_BIN=pnpm SIGN_AND_NOTARIZE=1 ./scripts/build-macos-release.sh
```

如果使用 App Store Connect API Key：

```bash
export APPLE_SIGNING_IDENTITY='Developer ID Application: Your Name or Company (TEAMID)'
export APPLE_API_ISSUER='issuer-uuid'
export APPLE_API_KEY='KEYID'
export APPLE_API_KEY_PATH='/absolute/path/AuthKey_KEYID.p8'

PNPM_BIN=pnpm SIGN_AND_NOTARIZE=1 ./scripts/build-macos-release.sh
```

## 8. 验收标准

本地或 CI 中应通过：

```bash
scripts/verify-macos-release.sh
```

关键输出应包含 Gatekeeper `accepted`。如果看到：

```text
Signature=adhoc
TeamIdentifier=not set
rejected
internal error in Code Signing subsystem
```

说明仍不是正式可分发包。

## 9. 内测绕过方式

仅限开发内测，不适合正式发布：

```bash
xattr -dr com.apple.quarantine "/Applications/Xiangqi Studio.app"
open "/Applications/Xiangqi Studio.app"
```

正式包通过 Developer ID 签名和 Apple 公证后，不应该要求用户执行这类命令。
