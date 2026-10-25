# 棋析 1.0.7（10057）：落子闪烁修复与 iPhone 安装

2026-10-25，正式环境 Release 已覆盖安装到连接的 iPhone 14。设备元数据确认 1.0.7 / 10057，启动成功。此前版本为 1.0.6 / 10053，未卸载应用，未改动业务数据。没有逐项读取本地棋谱核对完整性。iPad 仍为此前安装的 10056。

## 根因和修复

棋盘坐标函数返回 --piece-left / --piece-top，移动动画却读取 left / top，实际传入 undefined。真实浏览器复现中，移动棋子中心停留在 (0, 0)，而目标棋子隐藏 180 毫秒，表现为闪烁或突然跳位。修正为读取实际坐标变量，并补全返回类型。

另一个浏览器回归确认：useEffect 启动动画时，首个提交尚无动画层。改为 useLayoutEffect，在绘制前准备移动棋子并隐藏落点，避免先显示落点再回到起点。

## 验证

- 先验证失败：UI 坐标断言返回空字符串；浏览器起点断言失败，首帧准备断言失败。
- 修复后 41 项界面测试通过，TypeScript、production 前端构建和 Release 签名构建通过。
- scripts/test-board-motion-ui.cjs：Chrome 和 WebKit 各 8 组通过，覆盖 390 / 820 宽度、正向 / 翻转、普通 / 大棋子；检查起终点、宽度和绘制前动画准备。
- 签名、iPhone 描述文件授权验证通过；包内 210 个前端文件与最新生产构建逐字节一致。
- 安装、设备版本查询、启动均成功。尚未自动操作真实用户棋谱，真机视觉体验由用户确认。

回归运行：启动 endgame-training 的 Vite（1462），配置 PLAYWRIGHT_MODULE_PATH 后执行 node scripts/test-board-motion-ui.cjs；BOARD_TEST_BROWSER=webkit 可切换 WebKit。

基线提交 0c37be7ba5516022838516738d2b0dd794df2d23，修复保留在本地工作树，未自动提交。此次未上传 App Store。
