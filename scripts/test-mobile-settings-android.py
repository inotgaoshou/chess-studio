#!/usr/bin/env python3
"""Exercise a signed APK on an explicitly selected emulator, using real taps."""
import argparse
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--adb', default='adb')
parser.add_argument('--serial', required=True)
parser.add_argument('--output', required=True)
parser.add_argument('--cycles', type=int, default=20)
args = parser.parse_args()
if not args.serial.startswith('emulator-'):
    parser.error('This test changes system rotation/navigation; select an emulator.')
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
package = 'cn.xiangqi.endgame.training'
evidence = []


def adb(*command):
    return subprocess.check_output([args.adb, '-s', args.serial, *command], timeout=30)


def nodes():
    adb('shell', 'uiautomator', 'dump', '/sdcard/qixi-settings-test.xml')
    return list(ET.fromstring(adb('shell', 'cat', '/sdcard/qixi-settings-test.xml')).iter('node'))


def bounds(node):
    return list(map(int, re.findall(r'\d+', node.attrib['bounds'])))


def find(label):
    for _ in range(4):
        matches = [n for n in nodes() if n.get('text') == label or n.get('content-desc') == label]
        if matches:
            return matches[-1]
        time.sleep(.5)
    raise AssertionError(f'Missing control: {label}')


def tap(label):
    for _ in range(6):
        left, top, right, bottom = bounds(find(label))
        # WebView accessibility bounds include clipped/covered controls. Scroll a
        # clipped direction button into view before tapping its center.
        if right > left and bottom > top and (label not in ['自动', '锁横屏', '锁竖屏'] or bottom - top >= 80):
            adb('shell', 'input', 'tap', str((left + right) // 2), str((top + bottom) // 2))
            time.sleep(.6)
            return
        width, height = screen_size()
        adb('shell', 'input', 'swipe', str(width // 2), str(height * 3 // 4),
            str(width // 2), str(height // 4), '250')
    raise AssertionError(f'Unreachable control after scrolling: {label}')


def screen_size():
    # Physical/override wm size stays portrait even after rotating; use screenshot IHDR.
    import struct
    return struct.unpack('>II', adb('exec-out', 'screencap', '-p')[16:24])


def wait_direction(landscape):
    for _ in range(12):
        width, height = screen_size()
        if (width > height) == landscape:
            return
        time.sleep(.5)
    raise AssertionError(f'Direction did not change: landscape={landscape}')


def entry_fits():
    left, top, right, bottom = bounds(find('关于棋析'))
    width, height = screen_size()
    assert 0 <= left < right <= width and 0 <= top < bottom <= height
    webview = next(n for n in nodes() if n.get('class') == 'android.webkit.WebView')
    usable = bounds(webview)
    assert usable[0] <= left and usable[1] <= top and right <= usable[2] and bottom <= usable[3], 'Entry overlaps native system insets'
    evidence.append({'entryBounds': [left, top, right, bottom], 'screen': [width, height], 'webViewBounds': usable})


def capture(name):
    (output / f'{name}.png').write_bytes(adb('exec-out', 'screencap', '-p'))
    (output / f'{name}.xml').write_bytes(adb('shell', 'cat', '/sdcard/qixi-settings-test.xml'))


def restart():
    adb('shell', 'am', 'force-stop', package)
    adb('shell', 'am', 'start', '-n', f'{package}/.MainActivity')
    time.sleep(1)


restart()
try:
    tap('仅本地使用')
except AssertionError:
    pass
for navigation in ['threebutton', 'gestural']:
    adb('shell', 'cmd', 'overlay', 'enable-exclusive', '--category',
        f'com.android.internal.systemui.navbar.{navigation}')
    adb('shell', 'settings', 'put', 'system', 'accelerometer_rotation', '0')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '0')
    entry_fits()
    tap('关于棋析')
    tap('锁横屏')
    wait_direction(True)
    # Restart while locked, verifying the preference is re-applied by the bridge.
    restart()
    wait_direction(True)
    entry_fits()
    tap('关于棋析')
    assert not any('切换失败' in n.get('text', '') for n in nodes())
    capture(f'{navigation}-landscape')
    tap('锁竖屏')
    wait_direction(False)
    tap('自动')
    tap('关闭')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '1')
    time.sleep(1)
    wait_direction(True)
    entry_fits()
    tap('关于棋析')
    tap('关闭')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '3')
    time.sleep(1)
    entry_fits()
    tap('关于棋析')
    capture(f'{navigation}-reverse-landscape')
    tap('关闭')
    adb('shell', 'settings', 'put', 'system', 'user_rotation', '0')
    time.sleep(1)
    evidence.append({'navigation': navigation, 'landscape': True, 'portrait': True,
                     'autoFollowsSystem': True, 'restartRestoresPreference': True})
    print(f'PASS {navigation}: directions, restart, both landscape edges', flush=True)

for cycle in range(args.cycles):
    tap('关于棋析')
    tap('锁横屏' if cycle % 2 == 0 else '锁竖屏')
    wait_direction(cycle % 2 == 0)
    assert not any('切换失败' in n.get('text', '') for n in nodes())
    tap('关闭')
    if (cycle + 1) % 5 == 0:
        print(f'PASS open/switch/close cycle {cycle + 1}/{args.cycles}', flush=True)
tap('关于棋析')
tap('自动')
capture('final-settings')
tap('关闭')
report = {'serial': args.serial, 'sdk': adb('shell', 'getprop', 'ro.build.version.sdk').decode().strip(),
          'cycles': args.cycles, 'evidence': evidence}
(output / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
print('PASS Android settings acceptance', flush=True)
