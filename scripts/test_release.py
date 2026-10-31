import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import subprocess
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]


def module(name):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / f'{name}.py')
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


class ReleaseTests(unittest.TestCase):
    def test_version_drift_and_mutable_runtime_refs_are_rejected(self):
        metadata = module('release-metadata').metadata
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for name in ['package.json', 'package-lock.json', 'src-tauri/Cargo.toml',
                         'src-tauri/Cargo.lock', 'src-tauri/tauri.conf.json', 'runtime-source.json']:
                destination = root / name
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / name, destination)
            version = json.loads((root / 'package.json').read_text())['version']
            self.assertEqual(metadata(root, 'v' + version)['version'], version)
            with self.assertRaises(ValueError):
                metadata(root, 'v9.9.9')
            config = root / 'src-tauri/tauri.conf.json'
            original = config.read_text()
            config.write_text(json.dumps({'version': '9.9.9'}))
            with self.assertRaises(ValueError):
                metadata(root)
            config.write_text(original)
            runtime = root / 'runtime-source.json'
            data = json.loads(runtime.read_text())
            data['revision'] = 'main'
            runtime.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                metadata(root)

    def test_publish_requires_both_nonempty_installers(self):
        assets = module('publish-release').release_assets
        with tempfile.TemporaryDirectory() as tmp:
            directory = Path(tmp)
            arm = directory / 'AhaKey-Studio-v0.1.0-macos-aarch64.dmg'
            intel = directory / 'AhaKey-Studio-v0.1.0-macos-x86_64.dmg'
            arm.write_bytes(b'dmg')
            with self.assertRaises(ValueError):
                assets(directory, 'v0.1.0')
            intel.touch()
            with self.assertRaises(ValueError):
                assets(directory, 'v0.1.0')
            intel.write_bytes(b'dmg')
            self.assertEqual(assets(directory, 'v0.1.0'), [arm, intel])


class TicketValidationTests(unittest.TestCase):
    def test_transient_ticket_service_failure_is_retried(self):
        verify = module('verify-release')
        with patch.object(verify, 'run', side_effect=[subprocess.CalledProcessError(68, 'stapler'), b'valid']) as run, patch.object(verify.time, 'sleep'):
            verify.validate_ticket(Path('/installed/Studio.app'))
            self.assertEqual(run.call_count, 2)

    def test_invalid_ticket_fails_without_retry(self):
        verify = module('verify-release')
        with patch.object(verify, 'run', side_effect=subprocess.CalledProcessError(65, 'stapler')) as run, patch.object(verify.time, 'sleep'):
            with self.assertRaises(subprocess.CalledProcessError):
                verify.validate_ticket(Path('/installed/Studio.app'))
            self.assertEqual(run.call_count, 1)

    def test_persistent_service_failure_still_blocks_release(self):
        verify = module('verify-release')
        with patch.object(verify, 'run', side_effect=subprocess.CalledProcessError(68, 'stapler')) as run, patch.object(verify.time, 'sleep'):
            with self.assertRaises(subprocess.CalledProcessError):
                verify.validate_ticket(Path('/installed/Studio.app'))
            self.assertEqual(run.call_count, 3)


if __name__ == '__main__':
    unittest.main()
