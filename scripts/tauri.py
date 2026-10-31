"""Tauri entrypoint using the same certificate for local builds and native components."""
import os
from pathlib import Path
import subprocess
import sys
from native_signing import signing_identity

root = Path(__file__).resolve().parents[1]
environment = os.environ.copy()
arguments = sys.argv[1:]
local_bundle = sys.platform == 'darwin' and arguments[:1] == ['build'] and ('--debug' in arguments or '-d' in arguments) and '--no-bundle' not in arguments
if sys.platform == 'darwin':
    identity = signing_identity(root, environment)
    environment['APPLE_SIGNING_IDENTITY'] = identity
    if identity == '-':
        print('Ad-hoc build: macOS permissions can require renewed consent after rebuilding.', file=sys.stderr)
if local_bundle:
    # Local tests do not need Apple's timestamp service. Seal the assembled app below;
    # no unsigned app is reported as a successful build. Release uses normal Tauri signing.
    if '--bundles' not in arguments and '-b' not in arguments:
        arguments += ['--bundles', 'app']
    flag = '--bundles' if '--bundles' in arguments else '-b'
    if arguments[arguments.index(flag)+1] != 'app' or 'dmg' in arguments:
        raise SystemExit('Local debug signing supports --bundles app. Use a release build for distribution installers.')
    if '--no-sign' not in arguments:
        arguments += ['--no-sign']
result = subprocess.call([str(root / 'node_modules/.bin/tauri'), *arguments], cwd=root, env=environment)
if result:
    raise SystemExit(result)
if local_bundle:
    target = Path(environment.get('CARGO_TARGET_DIR', root / 'src-tauri/target'))
    if not target.is_absolute(): target = root / target
    for flag in ['--target', '-t']:
        if flag in arguments: target = target / arguments[arguments.index(flag)+1]
    bundle = target / 'debug/bundle/macos/AhaKey Studio.app'
    subprocess.run(['codesign', '--force', '--sign', identity, '--identifier', 'ai.ahakey.studio', '--options', 'runtime', '--timestamp=none', '--entitlements', str(root / 'src-tauri/Audio.entitlements'), str(bundle)], check=True)
    subprocess.run(['codesign', '--verify', '--deep', '--strict', str(bundle)], check=True)
    print('Verified signed local app (no distribution timestamp):', bundle)
