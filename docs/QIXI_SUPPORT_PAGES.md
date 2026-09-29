# 棋析支持页发布

客服与隐私联系邮箱：`xiangqistudio@outlook.com`。

公开页面源码位于 `docs/qixi-site/`，包含中文和英文支持页、隐私政策与本地样式，无外部字体、脚本、表单或依赖安装步骤。页面由腾讯云 CVM 上的 Nginx 提供，不再使用 GitHub Pages 或 `CNAME` 文件。

## 发布

完成 [腾讯云线上部署](../deploy/README.md) 中 DNS、证书与 Nginx 初始化后，在 CVM 的仓库根目录运行：

```bash
./scripts/deploy-qixi-site.sh
sudo nginx -t
sudo systemctl reload nginx
curl --fail https://qixiapp.cn/
curl --fail https://qixiapp.cn/privacy.html
```

部署脚本只同步 `docs/qixi-site/` 到专用目录 `/opt/qixi-site`。该目录的旧文件会被删除，因此不要将其他站点文件放入其中。

页脚展示网站备案号 `粤ICP备2026147690号-1` 和 App 备案号 `粤ICP备2026147690号-2A`，并链接至工信部备案查询站。更新内容或数据处理方式时，同时更新隐私政策的日期、中文和英文版本。

## App Store Connect

- Support URL：`https://qixiapp.cn/`。
- Privacy Policy URL：`https://qixiapp.cn/privacy.html`。
- 审核联系人邮箱：`xiangqistudio@outlook.com`；联系姓名、电话使用真实开发者资料。

提交审核或发布新版本前，确认安装包与政策一致，尤其是账号登录、教学/作业进度同步、手动个人棋谱同步、云库请求、可选 AI 服务和第三方数据处理情况。

政策依据：移动版 `apps/endgame-training/src/App.tsx`、`apps/endgame-training/src/teaching.ts`、`apps/endgame-training/src/wasm.ts` 及 iOS 原生插件。桌面版单独的同步服务不由本页面替代其自身应有的用户告知。

参考：[Apple 隐私要求](https://developer.apple.com/app-store/review/guidelines/#privacy)、[腾讯云 SSL 证书文档](https://cloud.tencent.com/document/product/400)。
