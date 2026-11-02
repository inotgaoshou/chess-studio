# 棋析 1.1.1 本地视频学习

实现位于 `apps/endgame-training/src/video/`，安卓和 iOS 各有独立 `VideoLibraryPlugin`。首页进入视频学习，“我的”进入管理，不增加底部导航。面向 6–10 岁儿童，观看记录与练棋成绩分开。

## 使用

1. 在其他应用下载自己的 MP4，打开棋析 → 视频学习 → 导入。
2. 选择分类和已有系列，或填写新系列名；文件夹导入留空系列名时使用文件夹名。支持多选文件、递归文件夹，保留子目录为章节。
3. 选择章节、点击数字开始。每组 25 段；原来的“1-1”等分段名保留。支持快进/后退 10 秒、倍速、全屏、书签、手动标记看过。
4. 每 5 秒、暂停、进入后台、切课或退出时保存位置。重新进入恢复位置并暂停。播放结束不自动连播。
5. “去练棋”保存并暂停，然后进入现有练习页；顶部“返回视频学习”恢复课程。离线且未登录时可从练习页选择自由拆棋；视频不自动生成题目。
6. 管理中可新建/改名分类，移动系列分类，修改系列/章节/视频名称，调整章节/视频顺序。
7. 单个视频、章节、整个系列都支持删除；必须在确认框再次点击“确认删除”。取消不会删除。删除只释放本应用的副本和观看记录，不动来源文件；相同内容仍被其他课程引用时保留媒体文件。

视频复制到应用持久目录，不依赖来源位置或长期文件授权。播放和书签不要求登录，不上传视频或学习记录。卸载应用会清除导入内容和记录，请保管电脑原始文件。

当前接受两端通用的 **H.264 视频 + AAC 音频 MP4**，无声 H.264 MP4 也可。其他 MP4 编码会提示在电脑转码。Web 浏览器提示使用原生应用，不假装提供持久导入。

## 普通版与家庭版

| 项目 | 普通版 | 家庭版 |
|---|---|---|
| 应用标识 | `cn.xiangqi.endgame.training` | `cn.xiangqi.endgame.training.family` |
| 名称 | 棋析 | 棋析·家庭学习 |
| 视频库、文件导入、原有练棋功能 | 有 | 有 |
| 包内私人课程 | 无 | 无 |
| 电脑预置 | 普通用户自行导入 | 开发构建支持 ADB / devicectl 预置 |
| 数据 | 各自独立 | 各自独立，与普通版共存 |

家庭版不替换原应用，不自动复制原应用的登录、题库或练习记录。安卓使用本机稳定的开发签名；iOS 使用已有 Apple Development 签名。开发签名有有效期，苹果设备需要开发者模式及有效配置文件。覆盖升级相同标识会保留视频；不要卸载重装。

## Mac 安装与预置

可双击 `scripts/video-family.command`，按提示选择平台、设备和系列；回车默认三套赵鑫鑫课程。初次验证建议先用以下命令只传 1 个视频。脚本停止在设备授权、签名或数据容器错误处，不清空已有数据。

```bash
# 查看设备
~/Library/Android/sdk/platform-tools/adb devices -l
xcrun devicectl list devices

# 构建并覆盖安装（保持 USB 连接、设备解锁）
./scripts/build-video-family.sh android ANDROID_SERIAL
./scripts/build-video-family.sh ios IOS_DEVICE_ID

# 小样本，确认在设备上能播放/快进/续播后再传全库
python3 scripts/provision-video-library.py --platform android --device ANDROID_SERIAL \
  --series '01赵鑫鑫布局棋理48讲' --limit 1
python3 scripts/provision-video-library.py --platform ios --device IOS_DEVICE_ID \
  --series '01赵鑫鑫布局棋理48讲' --limit 1

# 全库：默认三套；根目录与系列可替换为以后其他课程
python3 scripts/provision-video-library.py --platform android --device ANDROID_SERIAL
python3 scripts/provision-video-library.py --platform ios --device IOS_DEVICE_ID

# 其他系列，支持重复 --series 参数
python3 scripts/provision-video-library.py --platform android --device ANDROID_SERIAL \
  --source '/自己的课程根目录' --series '新系列' --category other

# 已有副本缺失/损坏时，强制重新传输，不清空进度
python3 scripts/provision-video-library.py --platform android --device ANDROID_SERIAL \
  --series '01赵鑫鑫布局棋理48讲' --force
```

传完进入应用“视频学习”接收。Mac 只生成目录、自然顺序、大小、SHA-256 清单，逐文件传输，最后发布清单；不在电脑重复复制整库。安卓传输先写 `.part` 并核对 SHA-256 后改名。iOS 使用开发数据容器文件传输；应用收到清单后逐一核对大小、SHA-256 和轨道编码，再直接移动暂存文件到正式媒体目录。重跑会跳过已登记完整文件；未登记暂存文件由安卓校验跳过或 devicectl 增量传输。传输中断可重新运行；校验错误使用 `--force`。

首批源目录：`/Users/chenyubin/Desktop/象棋学习/赵鑫鑫课程`。只选三套课程目录，不包含处理记录和报告。三个系列实测为 48 / 108 / 48，共 204 个、3,360,472,265 字节。中局的四个章节为 29 / 28 / 27 / 24，不把目录名“48讲”当作视频数量。

## 数据与恢复边界

- 独立 `VideoLibrary/library.sqlite`，单行 JSON 快照承载目录、任务、进度和书签，SQLite WAL 原子提交；不修改题库和棋谱数据库。写入失败恢复最后提交的内存状态。
- 安卓位于内部 `files/VideoLibrary`；iOS 位于 `Library/Application Support/VideoLibrary`，排除 iCloud 备份。
- `media/<SHA-256>.mp4` 为按内容去重的文件。视频记录标识包含系列、章节和内容，重复课号不覆盖，重导入不清空进度。
- 原生流式复制和校验，不传视频字节/base64 到 React。已验证的新副本可原子替换损坏旧副本；原有内容标识及进度继续保留。
- 崩溃后任务转为“已中断”；重试跳过已成功文件。取消保留成功项并清理 `.part`；扫描被取消时需重新选择目录。
- 删除内容时过滤导入任务中对应来源，避免旧重试恢复已删除内容；保留同系列其他失败项的重试入口。删除整个系列后停用对应任务。
- 原生只为登记的视频返回播放地址。安卓扩展 Capacitor WebView 的本地 MP4 范围响应，保留原路由；避免重复定位并限制返回长度，支持合法后缀范围及 416。
- `inventory.json` 是可重建的传输跳过清单，不是数据库；同大小的外部损坏可用 `--force` 修复。
- 构建检查 `scripts/verify-video-package.mjs` 拒绝 public、dist 和移动资源内的 MP4、私人媒体目录和暂存目录。CI 和正式构建不读取课程源目录；媒体与传输文件不进入 Git。

## 验证

```bash
pnpm --dir apps/endgame-training build
pnpm --dir apps/endgame-training test
(cd apps/endgame-training && node ../desktop/node_modules/vitest/vitest.mjs run --config ui-tests/vitest.config.ts --maxWorkers=1 --testTimeout=15000)
python3 -m unittest discover -s scripts/tests -p test_video_provision.py
JAVA_HOME=$(/usr/libexec/java_home -v 21) apps/endgame-training/android/gradlew -p apps/endgame-training/android :app:testFamilyUnitTest :app:assembleFamily
node scripts/test-video-android.cjs
node scripts/test-video-maintenance.cjs
node scripts/test-video-full-library.cjs /tmp/qixi-video-manifest.json
node scripts/test-video-lifecycle.cjs
# iOS 模拟器，先安装家庭版并预置第一节布局小样本
./scripts/test-video-ios.sh SIMULATOR_ID
```

实际验收结果、仍需连接设备完成的项目见 `docs/acceptance/video-learning-1.1.1.md`。没有联网下载器、课程服务端、视频棋盘识别、自动题目生成或观看掌握度计算。
