"""Publish both verified macOS installers together from an existing version tag."""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile


def release_assets(directory, tag):
    assets = [directory / f'AhaKey-Studio-{tag}-macos-{arch}.dmg' for arch in ['aarch64', 'x86_64']]
    for path in assets:
        if not path.is_file() or path.stat().st_size == 0:
            raise ValueError(f'Missing installer: {path.name}')
    return assets


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / 'package.json').read_text())['version']
    if args.tag != 'v' + version:
        raise ValueError('Release tag must match package version')
    tag_commit = subprocess.check_output(['git', 'rev-parse', args.tag + '^{commit}'], text=True).strip()
    if tag_commit != subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip():
        raise ValueError('Release source must match checked-out tag')
    assets = release_assets(root / 'dist/release', args.tag)
    runtime = json.loads((root / 'runtime-source.json').read_text())
    notes = f'''AhaKey Studio {args.tag}，支持 macOS 13 及以上。

- 键位、亮度与按键描述编辑，LCD 图片和动画上传。
- 语音输入、开发工具连接、后台 Runtime 管理和菜单栏常驻。
- Apple Silicon 下载 `aarch64.dmg`，Intel Mac 下载 `x86_64.dmg`；打开后拖入“应用程序”。

安装包包含配套 Runtime、语音与输入组件，无需另装 Runtime。本版暂不支持应用内自动更新。

Runtime 源码：[{runtime['revision'][:7]}](https://github.com/{runtime['repository']}/commit/{runtime['revision']})。
'''
    with tempfile.TemporaryDirectory(prefix='ahakey-release-') as temporary:
        body = Path(temporary) / 'notes.md'
        body.write_text(notes)
        # Keep the release hidden until all uploads have completed. Never replace existing releases.
        command = ['gh', 'release', 'create', args.tag, *map(str, assets), '--verify-tag', '--draft',
                   '--title', 'AhaKey Studio ' + args.tag, '--notes-file', str(body), '--generate-notes']
        prerelease = '-' in version.split('+')[0]
        if prerelease:
            command += ['--prerelease']
        subprocess.run(command, check=True)
        subprocess.run(['gh', 'release', 'edit', args.tag, '--draft=false',
                        '--latest=false' if prerelease else '--latest'], check=True)
