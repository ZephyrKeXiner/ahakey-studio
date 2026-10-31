"""Stage Runtime, its matching macOS input helper, and the session supervisor."""
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
from native_signing import signing_identity, sign_component

root = Path(__file__).resolve().parents[1]
identity = signing_identity(root) if sys.platform == 'darwin' else '-'
profile = 'release' if '--release' in sys.argv or (os.environ.get('TAURI_ENV_PLATFORM') and os.environ.get('TAURI_ENV_DEBUG') != 'true') else 'debug'
runtime = Path(os.environ.get('AHAKEY_RUNTIME_BINARY', root.parent / f'ahakey-runtime-rust/target/{profile}/ahakey-runtime-rust')).resolve()
if not runtime.is_file():
    raise SystemExit(f'Build the matching Runtime ({profile}) first, or set AHAKEY_RUNTIME_BINARY.')
hook = runtime.with_name('ahakey-hook')
if not hook.is_file():
    raise SystemExit('Build the matching ahakey-hook binary with cargo build --bins first.')
inputs = [(runtime, 'ahakey-runtime-rust'), (hook, 'ahakey-hook')]
if sys.platform == 'darwin':
    helper_override = os.environ.get('AHAKEY_INPUT_MONITOR_BINARY')
    if helper_override:
        helper = Path(helper_override).resolve()
    elif os.environ.get('AHAKEY_RUNTIME_BINARY'):
        # A supplied Runtime must use its accompanying helper, not an unrelated source checkout.
        helper = runtime.with_name('ahakey-input-monitor')
    else:
        source = root.parent / 'ahakey-runtime-rust/native/macos/InputMonitor.swift'
        if not source.is_file():
            raise SystemExit('Missing matching InputMonitor.swift; set AHAKEY_INPUT_MONITOR_BINARY for a prebuilt helper.')
        triple = os.environ.get('TAURI_ENV_TARGET_TRIPLE', '')
        architecture = ('x86_64' if triple.startswith('x86_64') else 'arm64' if triple.startswith('aarch64') else platform.machine())
        if triple.startswith('universal'):
            raise SystemExit('Provide a universal helper with AHAKEY_INPUT_MONITOR_BINARY for universal builds.')
        helper = root / f'src-tauri/target/native/{profile}/ahakey-input-monitor'
        helper.parent.mkdir(parents=True, exist_ok=True)
        temporary = helper.with_suffix('.next')
        subprocess.run(['xcrun', 'swiftc', '-O', '-swift-version', '5', '-target', f'{architecture}-apple-macosx13.0', str(source), '-o', str(temporary)], check=True)
        temporary.replace(helper)
    if not helper.is_file():
        raise SystemExit('Missing matching ahakey-input-monitor; set AHAKEY_INPUT_MONITOR_BINARY or place it beside the supplied Runtime.')
    inputs.append((helper, 'ahakey-input-monitor'))
speech_bundle = None
if sys.platform == 'darwin':
    if os.environ.get('AHAKEY_RUNTIME_BINARY'):
        speech_bundle = runtime.with_name('AhaKey Speech.app')
    else:
        speech_bundle = runtime.with_name('AhaKey Speech.app')
        builder = root.parent / 'ahakey-runtime-rust/scripts/build-speech-helper.py'
        triple = os.environ.get('TAURI_ENV_TARGET_TRIPLE', '')
        architecture = ('x86_64' if triple.startswith('x86_64') else 'arm64' if triple.startswith('aarch64') else platform.machine())
        subprocess.run([sys.executable, str(builder), '--output', str(speech_bundle), '--architecture', architecture,
                        '--identity', identity, *(['--no-timestamp'] if profile == 'debug' else [])], check=True)
    if not (speech_bundle / 'Contents/MacOS/ahakey-speech').is_file():
        raise SystemExit('Missing matching AhaKey Speech.app beside Runtime; build the speech helper first.')
command = ['cargo', 'build', '--manifest-path', 'src-tauri/Cargo.toml', '--bin', 'ahakey-runtime-supervisor', '--locked']
if profile == 'release':
    command.append('--release')
subprocess.run(command, cwd=root, check=True)
supervisor = root / f'src-tauri/target/{profile}/ahakey-runtime-supervisor'
inputs.append((supervisor, 'ahakey-runtime-supervisor'))
if sys.platform == 'darwin':
    # Refuse mixed architectures: a successful bundle must be runnable on every included Runtime architecture.
    architectures = lambda path: set(subprocess.check_output(['/usr/bin/lipo', '-archs', str(path)], text=True).split())
    required = architectures(runtime)
    if speech_bundle and not required.issubset(architectures(speech_bundle / 'Contents/MacOS/ahakey-speech')):
        raise SystemExit('Speech helper architecture does not match Runtime.')
    for binary, name in inputs:
        if not required.issubset(architectures(binary)):
            raise SystemExit(f'{name} does not support Runtime architectures: {sorted(required)}')
for destination in [root / 'src-tauri/resources/bin', root / f'src-tauri/target/{profile}/bin']:
    destination.mkdir(parents=True, exist_ok=True)
    if speech_bundle:
        staged_speech = destination / 'AhaKey Speech.app'
        if staged_speech.exists():
            shutil.rmtree(staged_speech)
        shutil.copytree(speech_bundle, staged_speech)
    for source, name in inputs:
        target = destination / name
        temporary = target.with_suffix('.next')
        shutil.copy2(source, temporary)
        temporary.chmod(0o755)
        temporary.replace(target)
        if sys.platform == 'darwin':
            sign_component(target, identity, profile == 'release')
print(f'Staged Runtime, native helpers, and supervisor ({profile}).')
