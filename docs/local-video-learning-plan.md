# 棋析 1.1.1 本地视频学习

实现位于 `apps/endgame-training/src/video/`，安卓和 iOS 各有独立 `VideoLibraryPlugin`。首页进入视频学习，“我的”进入管理，不增加底部导航。面向 6–10 岁儿童，观看记录与练棋成绩分开。

统一入口为首页“视频课堂 / 继续学习”。课程区的分类快捷按钮滑到播放器下方后吸顶；系列、章节选择默认收起，点击分类旁的“目录”展开或收起，展开后也保持可见。切换目录只更新选集，点击某集才切换播放；支持以后导入的其他系列。搜索默认收起，点“搜索”展开，可搜索分类、系列、章节或视频名称；搜索结果保留目录位置，选中后同步选集并收起搜索。顶部“管理”打开目录管理、视频管理和导入记录。

学习页只显示这一套切换控件和选集列表，列表底部不再重复展开完整目录。目录整理统一在“管理 → 目录管理”。本机首批布局课曾归在“其他”，修复版会通过正常目录接口将这条既有系列一次性归回“布局”，不重建视频或进度；以后主动调整分类仍会保留。

## 使用

1. 在其他应用下载自己的 MP4，打开棋析 → 视频学习 → 导入。
2. 选择分类和已有系列，或填写新系列名；文件夹导入留空系列名时使用文件夹名。支持多选文件、递归文件夹，保留子目录为章节。
3. 选择章节，在选集里点击标题开始；默认显示序号、完整标题和观看状态，也可切换“数字”网格，显示方式会记住。每组 25 段，可用范围两侧的切组按钮，或列表底部的“下一页 / 上一页”翻页；翻页只将下方列表定位到新一页开头，播放器保持原位，不切课。不再弹出系统分组菜单；数字格采用自适应列数、36px 高度和 4px 间距。原来的“1-1”等分段名保留。标题旁的铅笔可重命名，当前视频标题旁也有改名入口；改名先暂停保存进度，允许不同视频使用相同名称，不合并视频或观看记录。可拖动视频自带进度条定位，支持倍速、全屏；标题旁“更多”提供书签和手动标记看过。播放器的“全屏方向”可选横屏、竖屏或跟随系统，默认横屏，跨课程保留选择；退出全屏恢复应用原方向设置和播放位置。
4. 每 5 秒、暂停、进入后台、切课或退出时保存位置。重新进入恢复位置并暂停。播放结束不自动连播。
5. 标题旁“更多 → 去练棋”保存并暂停，然后进入现有练习页；顶部“返回视频学习”恢复课程。离线且未登录时可从练习页选择自由拆棋；视频不自动生成题目。
6. 点顶部“管理”或“我的 → 视频与目录管理”，切换“目录管理 / 视频管理 / 导入记录”。目录中可新建/改名分类，移动系列分类，修改系列/章节/视频名称，调整章节/视频顺序；视频管理支持按分类、系列、章节筛选及名称搜索；目录管理、视频管理、导入记录这排标签滚到标题栏下方后吸顶。管理列表点击标题即可观看，右侧可改名、删除；改名和删除弹窗显示在导航之上，按键盘可用高度调整，关闭后恢复原界面交互。
7. 单个视频、章节、整个系列都支持删除；必须在确认框再次点击“确认删除”。取消不会删除。删除只释放本应用的副本和观看记录，不动来源文件；相同内容仍被其他课程引用时保留媒体文件。

观看时视频和播放操作区固定在顶部，下面的课程切换、搜索、选集及目录仅纵向独立滑动，分类按钮自动换行，长标题在容器内换行；宽屏和平板横屏采用左右布局。上一集、播放、下一集、倍速、全屏方向和全屏按钮合并为一行；独立的前后 10 秒按钮及练棋工具行按最新要求移除。倍速和方向使用统一的单箭头选择框，保留系统选择器交互。退出编辑或收起搜索先收起键盘并等待可用视口恢复，避免留下遮罩或页面空白。

视频复制到应用持久目录，不依赖来源位置或长期文件授权。播放和书签不要求登录，不上传视频或学习记录。卸载应用会清除导入内容和记录，请保管电脑原始文件。

iPad 使用完整窗口，以便“全屏方向”设置能够实际转为横屏或竖屏；当前不支持 iPad 分屏窗口。

iPhone 导入时保持应用在前台，应用会临时禁止自动锁屏，完成或取消后恢复原状态。手动锁屏或切到后台时，系统仍可能暂停或终止应用；返回后继续。电脑预置任务在应用重开、覆盖升级后会自动续接中断项，跳过已登记的视频；主动取消的任务不会自动重启。通过文件选择器导入的中断任务可在“管理 → 导入记录”重试。

当前接受两端通用的 **H.264 视频 + AAC 音频 MP4**，无声 H.264 MP4 也可。其他 MP4 编码会提示在电脑转码。Web 浏览器提示使用原生应用，不假装提供持久导入。

## 普通版与家庭版

| 项目 | 普通版 | 家庭版 |
|---|---|---|
| 应用标识 | `cn.xiangqi.endgame.training` | `cn.xiangqi.endgame.training.family` |
| 名称 | 棋析 | 棋析·家庭学习 |
| 视频库、文件导入、原有练棋功能 | 有 | 有 |
| 包内私人课程 | 无 | 常规小包无；安卓可单独制作私人离线包 |
| 电脑预置 | 普通用户自行导入 | 开发构建支持 ADB / devicectl 预置 |
| 数据 | 各自独立 | 各自独立，与普通版共存 |

家庭版不替换原应用，不自动复制原应用的登录、题库或练习记录。安卓使用本机稳定的开发签名；iOS 使用已有 Apple Development 签名。开发签名有有效期，苹果设备需要开发者模式及有效配置文件。覆盖升级相同标识会保留视频；不要卸载重装。

## Mac 安装与预置

可双击 `scripts/video-family.command`，按提示选择平台、设备，默认只更新应用，不传视频；还可选“安装应用并追加课程”或“只追加课程”，课程回车默认三套赵鑫鑫课程。构建使用已有缓存，覆盖安装保留已导入视频和学习记录。首次安卓需 ADB 授权；苹果需有效开发签名、设备授权、连接并解锁，不能像 APK 一样在浏览器点 IPA 直接安装。初次验证建议先用以下命令只传 1 个视频。脚本停止在设备授权、签名或数据容器错误处，不清空已有数据。

安卓无法启用 ADB 时，可制作仓库外的家庭私人离线 APK：

```bash
python3 scripts/build-video-family-offline.py \
  --output "$HOME/Desktop/象棋学习/家庭版安装/棋析·家庭学习-1.1.1-含204集.apk"
```

该包约 3.47 GB，由现有家庭 APK 和本机课程生成，保持原开发签名；普通构建和 CI 不包含课程。APK 的清单和 MP4 直接写到仓库外临时 ZIP，校验签名和大小后才替换输出；课程总量限制在普通 ZIP 的 4 GiB 边界以内。视频以流方式从包内复制到持久媒体目录并核对 SHA-256；首次进入本地首页后自动接收，在“管理 → 导入记录”查看进度。初次安装需给 APK、本地视频及安装临时文件留足空间，建议至少 12 GB 空闲。重复打开同一包不重复导入，也不自动恢复已删除的视频；导入失败可重试，取消保留成功项。后续覆盖安装不带课程的小包仍保留已接收媒体，下载目录中的大 APK 可自行删除。包内素材仍属于私人内容，不进入公开附件或商店。

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

传完打开应用，首页即会接收预置课程；在“视频学习 → 管理 → 导入记录”查看进度。Mac 只生成目录、自然顺序、大小、SHA-256 清单，逐文件传输，最后发布清单；不在电脑重复复制整库。安卓传输先写 `.part` 并核对 SHA-256 后改名。iOS 使用开发数据容器文件传输；应用收到清单后逐一核对大小、SHA-256 和轨道编码，再直接移动暂存文件到正式媒体目录。重跑会跳过已登记完整文件；未登记暂存文件由安卓校验跳过或 devicectl 增量传输。传输中断可重新运行；校验错误使用 `--force`。

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

手机完整课程接收核对：`python3 scripts/test-video-ios-library.py --device DEVICE_ID --manifest /tmp/qixi-video-manifest.json`。仅临时读取课程元数据，检查清单中的视频、章节、大小及导入完成状态，不修改设备内容。模拟器中断恢复回归：`python3 scripts/test-video-ios-recovery.py --simulator SIMULATOR_ID`，需先装家庭版并预置一个样本；只创建和清理自己的验收记录，共用已存在的媒体，保留原课程与书签。

如需同时核对清单指定分类，在完整课程接收核对命令后加 `--check-categories`；主动把系列调整到其他分类后可省略此项。仅核对视频数量不能证明分类正确。

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
node scripts/test-video-fullscreen-android.cjs
# 先启动 pnpm --dir apps/endgame-training dev --port 1426；纯内存课程，不修改设备
node scripts/test-video-compact-ui.cjs
# iOS 模拟器，先安装家庭版并预置第一节布局小样本
./scripts/test-video-ios.sh SIMULATOR_ID
python3 scripts/test-video-ios-recovery.py --simulator SIMULATOR_ID
```

实际验收结果、仍需连接设备完成的项目见 `docs/acceptance/video-learning-1.1.1.md`。没有联网下载器、课程服务端、视频棋盘识别、自动题目生成或观看掌握度计算。
