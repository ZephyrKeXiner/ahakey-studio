"""Launch the built macOS app with an isolated Mock Runtime, then verify its background owner survives."""
import json
import os
from pathlib import Path
import plistlib
import subprocess
import tempfile
import time

root=Path(__file__).resolve().parents[1]
app=root/'src-tauri/target/debug/bundle/macos/AhaKey Studio.app'
binary=app/'Contents/MacOS/ahakey-studio'
runtime=app/'Contents/Resources/bin/ahakey-runtime-rust'
supervisor=app/'Contents/Resources/bin/ahakey-runtime-supervisor'
helper=app/'Contents/Resources/bin/ahakey-input-monitor'
speech=app/'Contents/Resources/bin/AhaKey Speech.app'
hook=app/'Contents/Resources/bin/ahakey-hook'
for path in [binary,runtime,supervisor,helper,hook,speech/'Contents/MacOS/ahakey-speech']:
    if not path.is_file():raise SystemExit(f'Build the debug app bundle first: missing {path}')
info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
assert info.get('NSBluetoothAlwaysUsageDescription'), 'bundle must explain Bluetooth access'
assert info['CFBundleIdentifier']=='ai.ahakey.studio'
assert info.get('NSMicrophoneUsageDescription') and info.get('NSSpeechRecognitionUsageDescription')
speech_info=plistlib.loads((speech/'Contents/Info.plist').read_bytes())
assert speech_info.get('NSMicrophoneUsageDescription') and speech_info.get('NSSpeechRecognitionUsageDescription')
subprocess.run(['/usr/bin/codesign','--verify','--strict',str(speech)],check=True)
permissions=json.loads(subprocess.check_output([str(speech/'Contents/MacOS/ahakey-speech'),'--status'],text=True,timeout=10))
assert permissions['type']=='permissions'
for tool in ['claude','cursor','codex']:
    config=json.loads(subprocess.check_output([str(hook),'--config','--tool',tool],text=True,timeout=5))
    assert config.get('hooks')

probe=root/'src-tauri/target/debug/examples/service_probe'
with tempfile.TemporaryDirectory(prefix='ahakey-service-smoke-') as temporary:
    directory=Path(temporary)
    service=directory/'service'
    discovery=directory/'runtime/discovery.json'
    env=dict(os.environ,AHAKEY_RUNTIME_MOCK='1',AHAKEY_RUNTIME_DISCOVERY=str(discovery),AHAKEY_STUDIO_SERVICE_DIR=str(service))
    env.pop('AHAKEY_RUNTIME_BINARY',None)
    with open(directory/'app.log','w+') as log:
        process=subprocess.Popen([str(binary)],env=env,stdout=log,stderr=log)
        try:
            deadline=time.monotonic()+20
            while True:
                if process.poll() is not None:
                    log.seek(0);raise AssertionError('Studio exited before startup: '+log.read())
                if time.monotonic()>deadline:raise AssertionError('packaged service did not start')
                try:
                    status=json.loads((service/'status.json').read_text())
                    if status['phase']=='running' and discovery.exists():break
                except (FileNotFoundError,json.JSONDecodeError):pass
                time.sleep(.1)
            child=status['childPid']
            assert json.loads((service/'config.json').read_text())['runtimeBinary']==str(runtime)
            process.terminate();process.wait(timeout=10)
            time.sleep(.5)
            result=json.loads(subprocess.check_output([str(probe),'status',str(directory),str(runtime),str(supervisor)],text=True,timeout=15))
            assert result['phase']=='running' and result['childPid']==child
            snapshot=json.loads(subprocess.check_output([str(root/'src-tauri/target/debug/examples/runtime_probe')],env=env,text=True,timeout=15))
            assert snapshot['snapshot']['devices'][0]['deviceId']=='mock-x1'
            assert 'voice.control' in snapshot['methods'] and 'hooks.configure' in snapshot['methods']
            assert snapshot['snapshot']['voice']['available'] is False
            assert snapshot['snapshot']['hooks']['preferences']['enabled'] is False
            subprocess.run([str(probe),'stop',str(directory),str(runtime),str(supervisor)],check=True,capture_output=True,timeout=55)
            assert not discovery.exists()
            print('PASS: packaged Studio automatically starts bundled Mock Runtime; quitting Studio preserves Runtime; explicit stop removes discovery')
        finally:
            if process.poll() is None:process.terminate();process.wait(timeout=10)
            if service.exists():
                stop=service/'stop.json';stop.write_text('{}');stop.chmod(0o600)
                try:subprocess.run([str(probe),'stop',str(directory),str(runtime),str(supervisor)],check=True,capture_output=True,timeout=55)
                except subprocess.SubprocessError:pass
                if (service/'session.plist').exists():
                    label=plistlib.loads((service/'session.plist').read_bytes())['Label']
                    subprocess.run(['/bin/launchctl','bootout',f'gui/{os.getuid()}/{label}'],capture_output=True,timeout=50)
