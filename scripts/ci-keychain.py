"""Import a release certificate into an isolated CI keychain; never export local keys."""
import base64
import os
from pathlib import Path
import secrets
import re
import shlex
import subprocess
import sys


def security(*args):
    result = subprocess.run(['security', *args], capture_output=True, text=True)
    if result.returncode:
        # Commands may contain passwords: do not print their argument list.
        raise RuntimeError(f'Keychain operation failed: {args[0]}')
    return result.stdout


if __name__ == '__main__':
    directory = Path(os.environ['RUNNER_TEMP'])
    keychain = directory / 'ahakey-release.keychain-db'
    certificate = directory / 'ahakey-release.p12'
    previous = directory / 'ahakey-keychains.txt'
    if sys.argv[1:] == ['cleanup']:
        if previous.exists():
            security('list-keychains', '-d', 'user', '-s', *shlex.split(previous.read_text()))
        if keychain.exists():
            security('delete-keychain', str(keychain))
        certificate.unlink(missing_ok=True)
    else:
        required = ['APPLE_CERTIFICATE', 'APPLE_CERTIFICATE_PASSWORD',
                    'APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID']
        missing = [name for name in required if not os.environ.get(name, '').strip()]
        if missing:
            raise SystemExit('Configure GitHub Secrets: ' + ', '.join(missing))
        previous.write_text(security('list-keychains', '-d', 'user'))
        password = secrets.token_urlsafe(32)
        try:
            certificate.write_bytes(base64.b64decode(''.join(os.environ['APPLE_CERTIFICATE'].split()), validate=True))
            certificate.chmod(0o600)
            security('create-keychain', '-p', password, str(keychain))
            security('set-keychain-settings', '-lut', '21600', str(keychain))
            security('unlock-keychain', '-p', password, str(keychain))
            security('import', str(certificate), '-k', str(keychain), '-P',
                     os.environ['APPLE_CERTIFICATE_PASSWORD'], '-T', '/usr/bin/codesign')
            security('set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, str(keychain))
            security('list-keychains', '-d', 'user', '-s', str(keychain), *shlex.split(previous.read_text()))
        finally:
            certificate.unlink(missing_ok=True)
        identities = re.findall(r'"(Developer ID Application:[^"\n]+)"',
                                security('find-identity', '-v', '-p', 'codesigning', str(keychain)))
        matching = [identity for identity in identities if identity.endswith('(' + os.environ['APPLE_TEAM_ID'] + ')')]
        if len(matching) != 1:
            raise SystemExit('Certificate must contain exactly one Developer ID Application identity for APPLE_TEAM_ID')
        with open(os.environ['GITHUB_ENV'], 'a') as output:
            output.write('APPLE_SIGNING_IDENTITY=' + matching[0] + '\n')
        print('Release certificate imported and signing identity selected.')
