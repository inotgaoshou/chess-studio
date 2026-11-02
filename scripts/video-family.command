#!/usr/bin/env bash
set -euo pipefail
root_dir="$(cd "$(dirname "$0")/.." && pwd)"
printf '棋析·家庭学习（课程单独传输，安装包不含视频）\n1. 安卓\n2. 苹果\n'
read -r -p '选择平台 [1/2]：' selected_platform
case "$selected_platform" in
  1) platform=android; "${ADB_BIN:-$HOME/Library/Android/sdk/platform-tools/adb}" devices -l;;
  2) platform=ios; xcrun devicectl list devices;;
  *) echo '平台选择无效'; exit 2;;
esac
read -r -p '输入上方目标设备标识：' selected_device
if [[ -z "$selected_device" ]]; then echo '设备标识不能为空'; exit 2; fi
read -r -p '课程根目录（回车使用桌面/象棋学习/赵鑫鑫课程）：' selected_source
selected_source="${selected_source:-$HOME/Desktop/象棋学习/赵鑫鑫课程}"
printf '系列文件夹：\n'
python3 - "$selected_source" <<'PY'
from pathlib import Path
import sys
root=Path(sys.argv[1])
for p in sorted(root.iterdir()):
 if p.is_dir() and not p.name.startswith('.'):print('  '+p.name)
PY
read -r -p '系列文件夹名（回车默认三套赵鑫鑫课程）：' selected_series
args=(--platform "$platform" --device "$selected_device" --source "$selected_source" --build-install)
if [[ -n "$selected_series" ]]; then args+=(--series "$selected_series"); fi
python3 "$root_dir/scripts/provision-video-library.py" "${args[@]}"
read -r -p '完成，按回车关闭。' _finished
