import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('cleaner', Path(__file__).with_name('clean-build-artifacts.py'))
cleaner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cleaner)

class CleanupTests(unittest.TestCase):
    def test_whitelist_preservation_symlinks_and_repeat(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / 'repo'
            root.mkdir()
            (root / 'Cargo.toml').write_text('[workspace]')
            for name in ('target/debug/deps/cache', 'target/debug/deps/symbols.dSYM/data', 'target/debug/runner', 'target/debug/resources/engine', 'src/source', 'apps/endgame-training/build/DerivedData/Build/Products/Example.app/app', 'apps/endgame-training/build/DerivedData/cache', 'target/debug/build/live/lib'):
                file = root / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('preserve' if name != 'target/debug/deps/cache' else 'cache')
            outside = Path(temp) / 'outside'
            outside.mkdir()
            (outside / 'secret').write_text('outside')
            (root / 'target/debug/incremental').symlink_to(outside, target_is_directory=True)
            preserved = ('package.zip', 'archive.tar.gz', 'installer.pkg', 'engine.nnue', 'data.sqlite', 'certificate.p12', 'upload-checkpoint.json', 'signing.key', 'symbols.pdb')
            for name in preserved:
                file = root / 'target/qixi-release-check' / name
                file.parent.mkdir(parents=True, exist_ok=True)
                file.write_text('preserve')
            occupied = {root / 'target/debug/build/live/lib'}
            args = dict(occupied=occupied, builders=[])
            cleaner.clean([root], **args)
            self.assertTrue((root / 'target/debug/deps/cache').exists())
            result = cleaner.clean([root], execute=True, **args)
            self.assertGreater(result['reclaimedBytes'], 0)
            self.assertFalse((root / 'target/debug/deps/cache').exists())
            for name in ('target/debug/deps/symbols.dSYM/data', 'target/debug/runner', 'target/debug/resources/engine', 'src/source', 'apps/endgame-training/build/DerivedData/Build/Products/Example.app/app', 'target/debug/build/live/lib'):
                self.assertTrue((root / name).exists(), name)
            self.assertEqual((outside / 'secret').read_text(), 'outside')
            for name in preserved:
                self.assertTrue((root / 'target/qixi-release-check' / name).exists(), name)
            self.assertEqual(cleaner.clean([root], execute=True, **args)['reclaimedBytes'], 0)

    def test_open_files_are_discovered_for_relative_and_ordinary_programs(self):
        outputs = [SimpleNamespace(stdout='10 target/debug/examples/demo\n11 python3 work.py\n', returncode=0),
                   SimpleNamespace(stdout='n/repo/target/debug/examples/demo\nn/repo/target/debug/build/resource\n', returncode=0)]
        with patch.object(cleaner.subprocess, 'run', side_effect=outputs):
            occupied, builders = cleaner.processes([Path('/repo')])
        self.assertEqual(builders, [])
        self.assertIn(Path('/repo/target/debug/examples/demo'), occupied)
        self.assertIn(Path('/repo/target/debug/build/resource'), occupied)

    def test_failed_inspection_blocks_deletion(self):
        outputs = [SimpleNamespace(stdout='10 python3 work.py\n', returncode=0),
                   SimpleNamespace(stdout='', returncode=1)]
        with patch.object(cleaner.subprocess, 'run', side_effect=outputs):
            _, builders = cleaner.processes()
        self.assertTrue(builders[0]['inspectionFailed'])
        outputs[1] = SimpleNamespace(stdout='n/repo/target/debug/file\n', stderr='warning: incomplete inspection', returncode=0)
        with patch.object(cleaner.subprocess, 'run', side_effect=outputs):
            _, builders = cleaner.processes()
        self.assertTrue(builders[0]['inspectionFailed'])

    def test_active_build_blocks_all_changes(self):
        with tempfile.TemporaryDirectory() as temp:
            result = cleaner.clean([Path(temp)], execute=True, occupied=set(), builders=[{'pid': 1}])
            self.assertEqual(result['reclaimedBytes'], 0)
            self.assertEqual(result['paths'], [])

if __name__ == '__main__':
    unittest.main()
