#!/usr/bin/env python3
"""Stream private MP4s to the unified app's staging area; publish the manifest last.
No media or absolute source paths are written to the repository. Repeat safely.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile

DEFAULT_SOURCE = Path('/Users/chenyubin/Desktop/象棋学习/赵鑫鑫课程')
DEFAULT_SERIES = ['01赵鑫鑫布局棋理48讲', '02赵鑫鑫中局棋理48讲', '03赵鑫鑫残局棋理48讲']
APP_ID = 'cn.xiangqi.endgame.training'
FAMILY_ID = APP_ID + '.family'

def natural(value):
    return [(1, int(p)) if p.isdigit() else (0, p.casefold()) for p in re.split(r'(\d+)', str(value))]

def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()

def build_manifest(source, names, limit=0, category=None):
    series, payloads = [], {}
    for name in names:
        folder = (source / name).resolve()
        if not folder.is_dir() or not folder.is_relative_to(source.resolve()):
            raise ValueError(f'系列文件夹不存在或不在源目录内：{name}')
        files = sorted((p for p in folder.rglob('*') if p.is_file() and p.suffix.lower() == '.mp4' and not any(v.startswith('.') for v in p.relative_to(folder).parts)), key=lambda p: natural(p.relative_to(folder)))
        if limit:
            files = files[:limit]
        if not files:
            raise ValueError(f'没有 MP4：{name}')
        videos = []
        for index, path in enumerate(files):
            if not path.resolve().is_relative_to(folder):
                raise ValueError(f'不读取指向系列目录以外的符号链接：{path.name}')
            digest = sha256(path)
            payloads[digest] = path
            chapter = path.relative_to(folder).parent.as_posix()
            videos.append(dict(title=path.stem, chapter='' if chapter == '.' else chapter, hash=digest, size=path.stat().st_size, order=index))
        cat = category or ('opening' if '布局' in name else 'middle' if '中局' in name else 'endgame' if '残局' in name else 'other')
        series.append(dict(title=name, categoryId='category-' + cat, videos=videos))
    return dict(version=1, series=series), payloads

def run(argv, **kwargs):
    result = subprocess.run([str(a) for a in argv], **kwargs)
    if result.returncode:
        raise RuntimeError('命令失败，请检查设备授权、开发签名、应用数据容器及剩余空间：' + shlex.join([str(a) for a in argv]))
    return result

class Android:
    def __init__(self, device, temporary, app_id=APP_ID):
        self.base = [os.environ.get('ADB_BIN', str(Path.home() / 'Library/Android/sdk/platform-tools/adb')), '-s', device]
        self.app_id = app_id
        self.root = 'files/VideoLibrary'
        # run-as is intentionally restricted to the debuggable personal build.
        self.shell('mkdir -p files/VideoLibrary/staging')
    def shell(self, command, **kwargs):
        return run(self.base + ['shell', '-T', 'run-as ' + shlex.quote(self.app_id) + ' sh -c ' + shlex.quote(command)], **kwargs)
    def pull(self, source, destination):
        with destination.open('wb') as stream:
            run(self.base + ['exec-out', 'run-as', self.app_id, 'cat', source], stdout=stream)
    def exists(self, path):
        result=subprocess.run(self.base+['shell','run-as',self.app_id,'test','-f',path],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        return result.returncode==0
    def freeze(self):
        run(self.base+['shell','am','force-stop',self.app_id],stdout=subprocess.DEVNULL)
    def free_space(self):
        result=self.shell('df -k .',capture_output=True,text=True)
        return int(result.stdout.splitlines()[-1].split()[3])*1024
    def inventory(self):
        result = self.shell('cat files/VideoLibrary/inventory.json 2>/dev/null || true', capture_output=True)
        try:
            return json.loads(result.stdout)
        except (ValueError, TypeError):
            return {}
    def send(self, path, destination):
        partial = destination + '.part'
        with path.open('rb') as stream:
            self.shell('cat > ' + shlex.quote(partial), stdin=stream)
        expected = sha256(path)
        self.shell('test "$(sha256sum ' + shlex.quote(partial) + ' | cut -d\' \' -f1)" = ' + shlex.quote(expected) + ' && mv ' + shlex.quote(partial) + ' ' + shlex.quote(destination))
    def complete(self, digest, size):
        for sub in ['media', 'staging']:
            path = self.root + '/' + sub + '/' + digest + '.mp4'
            result = self.shell('if test -f ' + path + '; then sha256sum ' + path + '; fi', capture_output=True)
            if result.stdout.decode().split(' ')[0] == digest:
                return True
        return False

class IOS:
    def __init__(self, device, temporary, app_id=APP_ID):
        self.app_path = None
        self.options = ['--device', device, '--domain-type', 'appDataContainer', '--domain-identifier', app_id]
        self.root = 'Library/Application Support/VideoLibrary'
        self.tmp = temporary
        # Fail before a large transfer if the development container is inaccessible.
        run(['xcrun', 'devicectl', 'device', 'info', 'files'] + self.options + ['--no-recurse'], stdout=subprocess.DEVNULL)
    def pull(self, source, destination):
        run(['xcrun','devicectl','device','copy','from']+self.options+['--source',source,'--destination',str(destination)],stdout=subprocess.DEVNULL)
    def listing(self, path):
        result=self.tmp/'files.json'
        run(['xcrun','devicectl','device','info','files']+self.options+['--subdirectory',path,'--no-recurse','--json-output',result],stdout=subprocess.DEVNULL)
        return json.loads(result.read_text())['result']['files']
    def exists(self, path):
        return any(f.get('name')==Path(path).name for f in self.listing(str(Path(path).parent)))
    def freeze(self):
        result=self.tmp/'processes.json'
        run(['xcrun','devicectl','device','info','processes','--device',self.options[1],'--json-output',result],stdout=subprocess.DEVNULL)
        for item in json.loads(result.read_text())['result']['runningProcesses']:
            from urllib.parse import unquote,urlparse
            executable=unquote(urlparse(str(item.get('executable',''))).path)
            # Resolve the exact app installation path; never terminate another App.app.
            if self.app_path and executable.startswith(self.app_path.rstrip('/')+'/'):
                run(['xcrun','devicectl','device','process','terminate','--device',self.options[1],'--pid',str(item['processIdentifier']),'--kill'],stdout=subprocess.DEVNULL)
    def free_space(self):
        # Storage preflight is supplied by the installer from device details.
        return ios_free_space(self.options[1],self.tmp)
    def inventory(self):
        target = self.tmp / 'inventory.json'
        result = subprocess.run(['xcrun', 'devicectl', 'device', 'copy', 'from'] + self.options + ['--source', self.root + '/inventory.json', '--destination', str(target)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if result.returncode:
            return {}
        try:
            return json.loads(target.read_text())
        except (OSError, ValueError):
            return {}
    def send(self, path, destination):
        run(['xcrun', 'devicectl', 'device', 'copy', 'to'] + self.options + ['--source', path, '--destination', destination, '--remove-existing-content', 'false'], stdout=subprocess.DEVNULL)
    def complete(self, digest, size):
        for sub in ['media','staging']:
            path=self.root+'/'+sub+'/'+digest+'.mp4'
            if self.exists(path):
                target=self.tmp/'verify.mp4'
                try:
                    self.pull(path,target)
                    if target.stat().st_size==size and sha256(target)==digest:return True
                finally:target.unlink(missing_ok=True)
        return False

def ios_free_space(device, temporary):
    output=temporary/'details.json'
    run(['xcrun','devicectl','device','info','details','--device',device,'--json-output',output],stdout=subprocess.DEVNULL)
    result=json.loads(output.read_text())['result']
    def walk(value):
        if isinstance(value,dict):
            for key,item in value.items():
                if key.lower() in ('availablecapacity','availablediskspace','freespace','availablebytes','availablecapacityinbytes','availablediskspaceinbytes') and isinstance(item,(int,float)):return int(item)
                found=walk(item)
                if found is not None:return found
        elif isinstance(value,list):
            for item in value:
                found=walk(item)
                if found is not None:return found
        return None
    size=walk(result)
    # Trusted Apple MobileDevice disk usage service, addressed by the actual UDID.
    if size is None and shutil.which('ideviceinfo'):
        udid=result.get('hardwareProperties',{}).get('udid')
        if udid:
            response=subprocess.run(['ideviceinfo','-u',udid,'-q','com.apple.disk_usage','-k','AmountDataAvailable'],capture_output=True,text=True)
            if response.returncode==0 and response.stdout.strip().isdigit():size=int(response.stdout.strip())
    if size is None:raise RuntimeError('devicectl 未提供可用空间，无法完成空间预检；请在设备上确认空间后使用 --available-bytes 指定实测可用字节数')
    return size

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, default=DEFAULT_SOURCE)
    parser.add_argument('--series', action='append', help='源目录下的系列文件夹，可重复；默认三套赵鑫鑫课程')
    parser.add_argument('--category', choices=['opening', 'middle', 'endgame', 'other'])
    parser.add_argument('--platform', choices=['android', 'ios'])
    parser.add_argument('--device')
    parser.add_argument('--app-id', default=APP_ID, choices=[APP_ID,FAMILY_ID], help='默认统一棋析；旧家庭版仅用于迁移兼容')
    parser.add_argument('--limit', type=int, default=0, help='每系列只传前N个，用于小样本验证')
    parser.add_argument('--manifest-only', type=Path, help='只生成清单，不连接设备')
    parser.add_argument('--available-bytes',type=int, help='仅当 iOS 无存储查询接口时，填设备设置中实测可用空间的字节数')
    parser.add_argument('--force', action='store_true', help='忽略已有清单，重新传输并修复损坏或缺失的副本；不清空进度')
    parser.add_argument('--build-install', action='store_true', help='先构建并覆盖安装棋析，保留已存数据')
    args = parser.parse_args()
    if args.limit < 0:
        parser.error('--limit 不能为负数')
    if not args.manifest_only and (not args.platform or not args.device):
        parser.error('需要 --platform 和 --device；或使用 --manifest-only')
    manifest, payloads = build_manifest(args.source, args.series or DEFAULT_SERIES, args.limit, args.category)
    count = sum(len(s['videos']) for s in manifest['series'])
    print(f'{len(manifest["series"])} 个系列，{count} 个视频，{sum(p.stat().st_size for p in payloads.values()) / 1e9:.2f} GB（去重后）', flush=True)
    if args.manifest_only:
        args.manifest_only.parent.mkdir(parents=True, exist_ok=True)
        args.manifest_only.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
        return
    if args.build_install:
        run([Path(__file__).with_name('install-qixi.py'), '--platform', args.platform, '--device', args.device, '--action', 'update'])
    with tempfile.TemporaryDirectory(prefix='qixi-video-') as work:
        tmp = Path(work)
        device = Android(args.device, tmp, args.app_id) if args.platform == 'android' else IOS(args.device, tmp, args.app_id)
        inventory = device.inventory()
        required=sum(p.stat().st_size for h,p in payloads.items() if inventory.get(h)!=p.stat().st_size)+64*1024**2
        if (args.available_bytes if args.available_bytes is not None else device.free_space())<required:raise RuntimeError(f"设备空间不足，至少需要 {required/1e9:.2f} GB 可用空间")
        for index, (digest, path) in enumerate(payloads.items(), 1):
            size = path.stat().st_size
            if not args.force and (inventory.get(digest) == size or device.complete(digest, size)):
                print(f'[{index}/{len(payloads)}] 已完整，跳过：{path.name}', flush=True)
                continue
            print(f'[{index}/{len(payloads)}] 传输：{path.name}', flush=True)
            device.send(path, device.root + '/staging/' + digest + '.mp4')
        path = tmp / 'manifest.json'
        path.write_text(json.dumps(manifest, ensure_ascii=False))
        # The app never sees an incomplete manifest. devicectl writes the small file in one copy operation.
        device.send(path, device.root + '/staging/manifest.json')
    print('传输完成。打开棋析「视频学习」，应用将校验并接收课程；再次运行可跳过已完整的视频。')

if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, ValueError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
