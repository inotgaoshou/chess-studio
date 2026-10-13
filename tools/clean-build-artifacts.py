#!/usr/bin/env python3
"""Clean only reproducible project build caches; dry-run unless --execute."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess

KEEP_SUFFIXES = ('.app', '.dsym', '.xcarchive', '.ipa', '.apk', '.aab', '.dmg', '.exe', '.msi',
                 '.pkg', '.zip', '.tar', '.gz', '.xz', '.zst', '.bz2', '.tgz', '.7z', '.rar', '.pdb', '.bcsymbolmap', '.dwo', '.dwp', '.debug', '.sym',
                 '.nnue', '.pem', '.key', '.p12', '.pfx', '.cer', '.crt', '.mobileprovision',
                 '.keystore', '.jks', '.db', '.sqlite', '.sqlite3', '.db-wal', '.db-shm',
                 '.sqlite-wal', '.sqlite-shm', '.cbl', '.cbr', '.xqf', '.pgn', '.xqb',
                 '.rs', '.ts', '.tsx', '.c', '.cpp', '.h', '.swift')
KEEP_NAMES = {'resources', 'certificates', 'signing', 'checkpoints', 'checkpoint', 'src', 'source', 'engine', 'nnue'}
RUST_CACHES = ('deps', 'build', '.fingerprint', 'incremental', 'examples')

def protected(path, occupied):
    name = path.name.lower()
    return (name.endswith(KEEP_SUFFIXES) or name in KEEP_NAMES or
            any(word in name for word in ('checkpoint', 'pikafish', 'nnue', 'signing')) or
            path in occupied)

def candidates(root):
    for profile in ('debug', 'release'):
        for cache in RUST_CACHES:
            yield root / 'target' / profile / cache
    yield root / 'target/qixi-release-check'
    mobile = root / 'apps/endgame-training'
    yield from (mobile / 'build').glob('DerivedData*')
    # Older local xcodebuild used ios/build as its DerivedData root.
    yield mobile / 'ios/build'
    for relative in ('android/.gradle', 'android/app/build/intermediates', 'android/app/build/generated', 'android/app/build/tmp', 'android/app/.cxx', 'android/build/intermediates'):
        yield mobile / relative

def safe_path(path, root):
    if path == root or root not in path.parents:
        return False
    return not any(p.is_symlink() for p in (path, *path.parents) if p == root or root in p.parents)

def leaf_files(path, root, occupied):
    if not safe_path(path, root) or protected(path, occupied):
        return
    if path.is_dir():
        for child in path.iterdir():
            yield from leaf_files(child, root, occupied)
    elif path.is_file():
        yield path

def processes(roots=()):
    listing = subprocess.run(['ps', '-axo', 'pid=,command='], capture_output=True, text=True, check=True).stdout
    occupied = set()
    builders = []
    for line in listing.splitlines():
        pid, _, command = line.strip().partition(' ')
        if not pid.isdigit() or int(pid) == os.getpid():
            continue
        # Match the executable, not this tool's command line or an editor's text.
        exe = Path(command.split(' ', 1)[0]).name
        if exe in ('rustc', 'xcodebuild', 'gradle', 'GradleDaemon') or (exe == 'cargo' and re.search(r'(?:^|\s)(build|test|check|run|clippy|rustc)(?:\s|$)', command)) or (exe == 'java' and 'GradleDaemon' in command):
            builders.append({'pid': int(pid), 'executable': exe})
    # Read executable, cwd and open-file paths regardless of how argv spells the program.
    # A complete failure to inspect open files blocks deletion instead of guessing.
    try:
        result = subprocess.run(['lsof', '-n', '-P', '-F', 'n'], capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return occupied, builders + [{'inspectionFailed': True, 'executable': 'lsof', 'reason': 'timeout'}]
    if result.returncode not in (0, 1) or not result.stdout.strip() or getattr(result, 'stderr', '').strip():
        builders.append({'inspectionFailed': True, 'executable': 'lsof'})
    else:
        for line in result.stdout.splitlines():
            if line.startswith('n/'):
                path = Path(line[1:])
                if not roots or any(path == root or root in path.parents for root in roots):
                    occupied.add(path)
    return occupied, builders

def disk_bytes(path):
    if not path.exists():
        return 0
    return int(subprocess.check_output(['du', '-sk', str(path)], text=True).split()[0]) * 1024

def clean(roots, execute=False, occupied=None, builders=None):
    if occupied is None or builders is None:
        occupied, builders = processes([Path(root).absolute() for root in roots])
    occupied = {ancestor for path in occupied for ancestor in (path, *path.parents)}
    report = {'execute': execute, 'blockedByBuild': builders, 'paths': [], 'reclaimedBytes': 0, 'measuredReductionBytes': 0}
    if builders:
        return report
    for root in roots:
        root = Path(root).absolute()
        if root.is_symlink() or not (root / 'Cargo.toml').is_file():
            raise ValueError('Expected a real Cargo workspace: ' + str(root))
        for path in candidates(root):
            if not path.exists() or not safe_path(path, root):
                continue
            before_bytes = disk_bytes(path)
            files = list(leaf_files(path, root, occupied))
            # st_blocks measures disk allocated; don't claim hardlinks freed twice.
            allocated = sum(p.stat().st_blocks * 512 for p in files if p.stat().st_nlink == 1)
            deleted = 0
            if execute:
                for p in files:
                    if safe_path(p, root) and not protected(p, occupied):
                        size = p.stat().st_blocks * 512 if p.stat().st_nlink == 1 else 0
                        p.unlink()
                        deleted += size
                # Keep ancestors containing preserved packages, resources or links.
                for directory, _, _ in os.walk(path, topdown=False, followlinks=False):
                    d = Path(directory)
                    if safe_path(d, root) and not protected(d, occupied):
                        try:
                            d.rmdir()
                        except OSError:
                            pass
            after_bytes = disk_bytes(path) if execute else before_bytes
            reduction = max(0, before_bytes - after_bytes)
            report['paths'].append({'path': str(path), 'files': len(files), 'candidateBytes': allocated, 'reclaimedBytes': deleted, 'beforeBytes': before_bytes, 'afterBytes': after_bytes, 'measuredReductionBytes': reduction})
            report['measuredReductionBytes'] += reduction
            report['reclaimedBytes'] += deleted
    return report

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--admin-root', default='/Users/chenyubin/Documents/xiangqi-admin-private')
    parser.add_argument('--report', help='Optional JSON report path outside tracked files')
    args = parser.parse_args()
    roots = [Path(__file__).resolve().parents[1], Path(args.admin_root)]
    result = clean(roots, args.execute)
    rendered = json.dumps(result, ensure_ascii=False, indent=2)
    print(rendered)
    if args.report:
        path = Path(args.report)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(rendered + '\n')

if __name__ == '__main__':
    main()
