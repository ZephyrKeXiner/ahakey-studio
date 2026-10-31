"""Verify the contents, signatures and notarization of a macOS release DMG."""
import argparse
from pathlib import Path
import plistlib
import shutil
import subprocess
import tempfile
import time


def run(*args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    if result.returncode:
        print(result.stdout.decode(errors='replace'), flush=True)
        result.check_returncode()
    return result.stdout


def validate_ticket(app):
    # validate contacts Apple's ticket service even for a stapled app. Retry only
    # EX_NOHOST (68); a missing/invalid ticket or revoked signature still fails.
    for attempt in range(3):
        try:
            run('xcrun', 'stapler', 'validate', '-v', str(app))
            break
        except subprocess.CalledProcessError as error:
            if error.returncode != 68 or attempt == 2:
                raise
            time.sleep(10)


def verify_app(app, version, architecture):
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    if info['CFBundleIdentifier'] != 'ai.ahakey.studio' or info['CFBundleShortVersionString'] != version:
        raise ValueError('Packaged application identity/version mismatch')
    for key in ['NSBluetoothAlwaysUsageDescription', 'NSMicrophoneUsageDescription', 'NSSpeechRecognitionUsageDescription']:
        if not info.get(key):
            raise ValueError(f'Missing usage description: {key}')
    resources = app / 'Contents/Resources/bin'
    binaries = [app / 'Contents/MacOS/ahakey-studio',
                *(resources / name for name in ['ahakey-runtime-rust', 'ahakey-hook',
                  'ahakey-input-monitor', 'ahakey-runtime-supervisor']),
                resources / 'AhaKey Speech.app/Contents/MacOS/ahakey-speech']
    expected = 'arm64' if architecture == 'aarch64' else 'x86_64'
    app_signature = run('codesign', '-dv', '--verbose=4', str(app)).decode()
    team = next(line for line in app_signature.splitlines() if line.startswith('TeamIdentifier='))
    if team == 'TeamIdentifier=not set' or 'Authority=Developer ID Application:' not in app_signature:
        raise ValueError('Release must use a Developer ID Application certificate')
    for binary in binaries:
        if not binary.is_file():
            raise ValueError(f'Missing component: {binary}')
        if run('lipo', '-archs', str(binary)).decode().strip() != expected:
            raise ValueError(f'Unexpected architecture: {binary}')
        run('codesign', '--verify', '--strict', str(binary))
        signature = run('codesign', '-dv', '--verbose=4', str(binary)).decode()
        if team not in signature.splitlines():
            raise ValueError(f'Component signed by a different team: {binary}')
    run('codesign', '--verify', '--deep', '--strict', str(app))
    validate_ticket(app)
    run('spctl', '--assess', '--type', 'execute', '--verbose=2', str(app))
    subprocess.run([str(resources / 'ahakey-runtime-rust'), '--help'], check=True, capture_output=True, timeout=10)
    subprocess.run([str(resources / 'ahakey-hook'), '--config', '--tool', 'codex'], check=True, capture_output=True, timeout=10)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--architecture', required=True, choices=['aarch64', 'x86_64'])
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    root = args.root.resolve()
    bundle = root / 'src-tauri/target/release/bundle'
    images = list((bundle / 'dmg').glob('*.dmg'))
    if len(images) != 1:
        raise ValueError('Expected exactly one release DMG')
    image = images[0]
    with tempfile.TemporaryDirectory(prefix='ahakey-verify-release-') as temporary:
        mount = Path(temporary) / 'volume'
        run('hdiutil', 'attach', '-readonly', '-nobrowse', '-mountpoint', str(mount), str(image))
        try:
            # stapler requires a writable parent. Verify the installed copy,
            # preserving the notarization ticket and extended attributes.
            installed = Path(temporary) / 'installed/AhaKey Studio.app'
            installed.parent.mkdir()
            run('ditto', str(mount / 'AhaKey Studio.app'), str(installed))
            verify_app(installed, args.version, args.architecture)
            if not (mount / 'Applications').is_symlink():
                raise ValueError('DMG must include the Applications shortcut')
        finally:
            run('hdiutil', 'detach', str(mount))
    destination = root / f'dist/release/AhaKey-Studio-v{args.version}-macos-{args.architecture}.dmg'
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(image, destination)
    print(f'Verified release installer: {destination.name}')
