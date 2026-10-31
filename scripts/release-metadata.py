"""Validate a Studio release and resolve its pinned Runtime source."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tomllib


def metadata(root, tag=None):
    package = json.loads((root / 'package.json').read_text())
    version = package['version']
    versions = [
        json.loads((root / 'package-lock.json').read_text())['version'],
        json.loads((root / 'package-lock.json').read_text())['packages']['']['version'],
        json.loads((root / 'src-tauri/tauri.conf.json').read_text())['version'],
        tomllib.loads((root / 'src-tauri/Cargo.toml').read_text())['package']['version'],
    ]
    locked = tomllib.loads((root / 'src-tauri/Cargo.lock').read_text())['package']
    versions += [next(p['version'] for p in locked if p['name'] == 'ahakey-studio')]
    if any(v != version for v in versions):
        raise ValueError('npm, Cargo and Tauri versions must agree')
    if tag is not None and tag != f'v{version}':
        raise ValueError(f'Tag must be v{version}, got {tag}')
    runtime = json.loads((root / 'runtime-source.json').read_text())
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', runtime['repository']):
        raise ValueError('Invalid Runtime repository')
    if not re.fullmatch(r'[0-9a-f]{40}', runtime['revision']):
        raise ValueError('Runtime revision must be a full commit SHA')
    return {'version': version, 'runtime_repository': runtime['repository'],
            'runtime_revision': runtime['revision']}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag')
    parser.add_argument('--github-output', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    result = metadata(root, args.tag)
    if args.tag:
        subprocess.run(['git', 'merge-base', '--is-ancestor', 'HEAD', 'origin/main'], cwd=root, check=True)
    if args.github_output:
        with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
            for key, value in result.items():
                output.write(f'{key}={value}\n')
    print(json.dumps(result, indent=2))
