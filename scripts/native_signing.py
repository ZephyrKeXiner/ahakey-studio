"""Use one certificate for Tauri and all bundled native components."""
import os
from pathlib import Path
import subprocess

IDENTIFIERS = {
    'ahakey-runtime-rust': 'ai.ahakey.runtime',
    'ahakey-runtime-supervisor': 'ai.ahakey.runtime.supervisor',
    'ahakey-input-monitor': 'ai.ahakey.runtime.input-monitor',
    'ahakey-hook': 'ai.ahakey.runtime.hook',
}

def signing_identity(root: Path, environment=None) -> str:
    environment = os.environ if environment is None else environment
    if 'APPLE_SIGNING_IDENTITY' in environment:
        value = environment['APPLE_SIGNING_IDENTITY'].strip()
        if not value:
            raise ValueError('APPLE_SIGNING_IDENTITY is empty; refusing an accidental ad-hoc build.')
        return value
    local = root / 'signing-identity.local'
    if local.exists():
        value = local.read_text().strip()
        if not value:
            raise ValueError('signing-identity.local is empty; choose a code signing certificate.')
        return value
    return '-'

def sign_component(path: Path, identity: str, release: bool) -> None:
    command = ['codesign', '--force', '--sign', identity, '--identifier', IDENTIFIERS[path.name],
               '--options', 'runtime', '--timestamp' if release and identity != '-' else '--timestamp=none', str(path)]
    if path.name in ['ahakey-runtime-rust', 'ahakey-runtime-supervisor']:
        command[-1:-1] = ['--entitlements', str(Path(__file__).resolve().parents[1] / 'src-tauri/Audio.entitlements')]
    subprocess.run(command, check=True)
    subprocess.run(['codesign', '--verify', '--strict', str(path)], check=True)
