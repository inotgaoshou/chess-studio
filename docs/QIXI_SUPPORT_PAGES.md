# 棋析支持页发布

客服与隐私联系邮箱：`xiangqistudio@outlook.com`。

公开页面源码仅位于 `docs/qixi-site/`，包含中文和英文支持页、隐私政策与本地样式，无外部字体、脚本、表单或依赖安装步骤。该目录包含 `CNAME`，发布目标域名为 `qixiapp.cn`。

## 发布

1. 登录有本仓库管理权限的 GitHub 账号，将上述目录及 `.github/workflows/qixi-pages.yml` 提交到准备发布的分支。
2. 在仓库 Settings → Pages 中确认是否已有站点；如有，先确认部署不会覆盖其他用途。将 Source 设置为 GitHub Actions。
3. 手动运行 `Qixi support pages` 工作流，选择含页面的分支。工作流只上传 `docs/qixi-site/`，不上传仓库其他文件。
4. 等待部署成功，确认 `https://qixiapp.cn/` 和 `https://qixiapp.cn/privacy.html` 均可匿名访问。

不要在站点部署成功前把推测 URL 填入 App Store Connect。当前会话的 GitHub CLI 未登录，尚未发布，也没有核实仓库 Pages 状态。

## App Store Connect

- Support URL：`https://qixiapp.cn/`。
- Privacy Policy URL：`https://qixiapp.cn/privacy.html`。
- 审核联系人邮箱：`xiangqistudio@outlook.com`；联系姓名、电话使用真实开发者资料。

提交审核前确认安装包与政策一致，尤其是云库请求、可选 AI 服务和第三方数据处理情况。不要仅凭本地保存题库就断言所有数据均不被收集。

政策依据：移动版 `src/wasm.ts`、`src/App.tsx`、iOS `CloudBookPlugin.swift` 和 `TrainingStorePlugin.swift`；政策仅覆盖移动版，不覆盖桌面同步账号。

参考：[Apple 隐私要求](https://developer.apple.com/app-store/review/guidelines/#privacy)、[GitHub 隐私声明](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement)。
