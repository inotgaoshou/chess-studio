# 棋析 1.0.7（10079）重新提审

2026-10-28 23:35（北京时间），App Store Connect 已确认 1.0.7（10079）等待审核，保留审核通过后手动发布。

- App ID：6809301145。
- 构建 ID：0c5ddde4-fa1f-492c-9914-64fc3813e2a1。
- 提交 ID：29a9fa82-45f8-4c90-98be-b102b90dbf02。
- 原 10071 等待审核提交已撤回；10079 上传并处理完成后才替换关联。

## 构建与验证

使用当前工作树及已有未提交修复，源提交 df0602c8461e86d82367fd35c503fae03bf80830；差异留存在制品 evidence/working-tree.patch。正式环境，bundle cn.xiangqi.endgame.training，最低 iOS 15。

- 61 项逻辑测试、23 个文件中的 133 项界面测试通过。
- TypeScript/Vite、WASM、Xcode Release Archive 和 App Store IPA 导出成功。
- Archive 签名验证通过，固定 NNUE SHA-256 一致；IPA 与 Archive 的 276 个前端文件逐一匹配。
- 正式包确认包含讲解、机构题库、题库准备提示、草稿作业入口、打卡保存及生产 API 地址。
- 本轮未重新安装真机、未执行摄像头实拍或生产业务写入验收，不把模拟界面测试作为真机验收。
- Xcode Organizer 显示上传成功；TestFlight 显示 10079 准备提交；最终审核页显示 1.0.7（10079）等待审核。

## 元数据和隐私

版本变化、描述及审核备注更新至 app-store-assets/qixi-review-1.0.7-10079/，包含机构出题、来源筛选、书本学习、作业入口与打卡布局。保留已有审核账号、手动发布和现有评分；未改价格或销售范围。

隐私政策补充中英文打卡照片和棋盘识别上传用途。仅通过 GitHub Pages 发布单个静态政策文件，提交 4fd16a159036135a55eccc94654d3d4fba64ec7e，发布运行 40714673031 成功，公开内容与本地文件逐字节一致。未部署后台/API。

App Store 隐私数据类型最终回读为姓名、电子邮件地址、照片或视频、游戏内容、用户 ID、产品交互，均为 App 功能、与用户身份关联、不用于追踪。编辑过程中页面曾出现未收集数据的中间状态以及 Apple 保存错误，最终重新加载并逐项确认六类披露已完整保存。

## 证据

artifacts/releases/qixi-1.0.7-10079/ 保存 Archive、App Store IPA、verification.json、submission.json、构建／测试日志、静态政策发布凭证及截图。最终截图为 evidence/app-store-submitted-10079.png。
