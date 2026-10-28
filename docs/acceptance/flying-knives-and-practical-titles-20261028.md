# 飞刀目录和实用残局标题修复

## 原因与行为

已安装移动客户端统一强制 training 模式，隐藏书籍子目录和教材入口。飞刀与陷阱在线数据为 0 道练习题、42 份已审核教材/复现（24、8、10），所以有数据但看不到书籍；这是独立于此前服务器超时的客户端展示问题。

本次仅恢复 flying_knives 分类的书籍层级、教材读取和逐级返回；打开棋谱再返回保留原书籍位置。统计晚于目录返回时也能正确切换教材显示。其他分类的紧凑练习方式保持原语义。

用户随后要求实用残局返回原题标题。接口已有 title；现在实用残局列表、做题页、单题结果及会话题目导航使用原题标题，保留独立题号。其他练习分类继续使用原有编号展示规则。未修改判题、权限、成绩或服务端数据。

## 验证

- 回归先红：飞刀测试无法找到杨典书籍按钮；实用残局两项测试找不到原题标题。
- 修复后 UI 全量 107 项通过，覆盖晚到统计、教材打开、重新挂载恢复、逐级返回、基础杀法/吃子等原有行为。
- Chrome 390×844 与 1024×768：三本书、24 项教材、实际棋谱打开与返回、原题标题展示及无横向溢出通过。截图为合成测试数据，位于 `.local/flying-knives-browser/`。
- 逻辑测试 61 项通过。TypeScript / Vite、iOS Release Archive、development 和 App Store IPA 导出及签名校验通过；固定 NNUE 哈希校验通过。
- iOS 版本 1.0.7 / 10072，bundle cn.xiangqi.endgame.training；development IPA 的 276 个 Web 文件逐字节匹配最终 Archive。

## 交付状态

最终归档：`artifacts/releases/qixi-1.0.7-10072/App-final.xcarchive`。
最终安装包：`artifacts/releases/qixi-1.0.7-10072/final-development/`；待上传包：同目录 `app-store/`。
校验：同目录 `verification.json`，源码指纹和工作树差异在 `evidence/`。

最初仅含飞刀修复的 `App.xcarchive` / `development/` 已被最终包取代，不作为交付版本。

2026-10-28 16:01（北京时间），已按用户指示向连接的 iPhone 14 覆盖安装最终 development IPA，并启动成功。devicectl 回读版本为 1.0.7 / 10072；安装、版本和启动证据在 evidence/device-install.json、device-apps.json、device-launch.json。等待用户检查真机页面；尚未上传或替换 App Store 待审构建。
