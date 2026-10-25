"""Exercise actual launchd session ownership and the supervisor failure budget with Mock Runtime."""
import json
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import tempfile
import time

root=Path(__file__).resolve().parents[1]
runtime=Path(os.environ.get('AHAKEY_RUNTIME_BINARY',root/'src-tauri/target/debug/bin/ahakey-runtime-rust'))
subprocess.run(['cargo','build','--manifest-path','src-tauri/Cargo.toml','--locked','--bin','ahakey-runtime-supervisor','--example','service_probe','--example','runtime_probe'],cwd=root,check=True)
supervisor=root/'src-tauri/target/debug/ahakey-runtime-supervisor'
probe=root/'src-tauri/target/debug/examples/service_probe'
def until(read,predicate,seconds=15):
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        try:
            value=read()
            if predicate(value):return value
        except (FileNotFoundError,json.JSONDecodeError):pass
        time.sleep(.1)
    raise AssertionError('state transition deadline')
def write_json(path,value):
    temporary=path.with_suffix('.next')
    temporary.write_text(json.dumps(value))
    temporary.chmod(0o600)
    temporary.replace(path)
with tempfile.TemporaryDirectory(prefix='ahakey-service-smoke-') as temporary:
    directory=Path(temporary)
    def control(action):
        result=subprocess.run([str(probe),action,str(directory),str(runtime),str(supervisor)],capture_output=True,text=True,check=True,timeout=55)
        return json.loads(result.stdout)
    try:
        control('open')
        # The controller has exited. launchd owns the supervisor and Runtime remains available.
        status=until(lambda:control('status'),lambda s:s['phase']=='running')
        first_pid=status['childPid']
        discovery=directory/'runtime/discovery.json'
        until(lambda:discovery.exists(),bool)
        env=dict(os.environ,AHAKEY_RUNTIME_DISCOVERY=str(discovery))
        snapshot=json.loads(subprocess.check_output([str(root/'src-tauri/target/debug/examples/runtime_probe')],env=env,text=True,timeout=15))
        assert snapshot['snapshot']['devices'][0]['deviceId']=='mock-x1'
        # A second Studio launch attaches to the same managed child.
        assert control('open')['childPid']==first_pid
        # Saving the preference does not restart or mutate the live Runtime configuration.
        assert control('input-settings')['enabled'] is False
        preference=control('input-on')
        assert preference['enabled'] is True and preference['active'] is False
        assert control('status')['childPid']==first_pid
        assert json.loads((directory/'service/config.json').read_text())['inputMonitor'] is False
        command=subprocess.check_output(['/bin/ps','-p',str(first_pid),'-o','command='],text=True)
        assert '--mock' in command and str(discovery) in command
        os.kill(first_pid,signal.SIGKILL)
        restarted=until(lambda:control('status'),lambda s:s['phase']=='running' and s['childPid']!=first_pid)
        assert restarted['restarts']==1
        stopped=control('stop')
        assert stopped['phase']=='stopped'
        time.sleep(1.2)
        assert control('status')['phase']=='stopped'
        assert not discovery.exists()
        # Explicit reopen/start clears the stopped intent and gets a fresh budget.
        control('open')
        reopened=until(lambda:control('status'),lambda s:s['phase']=='running')
        assert reopened['restarts']==0
        command=subprocess.check_output(['/bin/ps','-p',str(reopened['childPid']),'-o','command='],text=True)
        assert '--input-monitor' in command
        assert control('input-settings')['active'] is True
        # Mock Runtime accepts the launch flag but never starts the real HID helper.
        snapshot=json.loads(subprocess.check_output([str(root/'src-tauri/target/debug/examples/runtime_probe')],env=env,text=True,timeout=15))
        assert snapshot['snapshot']['input']['status']=='disabled'
        control('input-off')
        control('stop')
        plist=plistlib.loads((directory/'service/session.plist').read_bytes())
        assert plist['RunAtLoad'] is True and plist['KeepAlive'] is False
        assert 'LaunchAgents' not in str(directory/'service/session.plist')
        target=f"gui/{os.getuid()}/{plist['Label']}"
        assert subprocess.run(['/bin/launchctl','print',target],capture_output=True).returncode!=0
        print('PASS: persistent input preference, no implicit restart, explicit reopen applies flag, Mock stays isolated')
        print('PASS: launchd ownership survives controller exit, single owner, crash recovery, stop stays stopped, reopen, job removal')
    finally:
        service=directory/'service'
        if service.exists():
            write_json(service/'stop.json',{'requestedAtMs':0})
            try:control('stop')
            except subprocess.SubprocessError:pass
            if (service/'session.plist').exists():
                label=plistlib.loads((service/'session.plist').read_bytes())['Label']
                subprocess.run(['/bin/launchctl','bootout',f'gui/{os.getuid()}/{label}'],capture_output=True,timeout=50)
with tempfile.TemporaryDirectory(prefix='ahakey-service-smoke-') as temporary:
    directory=Path(temporary)
    crash=directory/'crash-runtime'
    crash.write_text('#!/bin/sh\nprintf "attempt\\n" >> "'+str(directory/'attempts')+'"\nexit 7\n')
    crash.chmod(0o700)
    config=directory/'config.json'
    write_json(config,{'runtimeBinary':str(crash),'discoveryPath':str(directory/'discovery.json'),'mock':True})
    process=subprocess.Popen([str(supervisor),'--config',str(config)])
    try:
        process.wait(timeout=15)
        status=json.loads((directory/'status.json').read_text())
        assert status['phase']=='faulted' and status['restarts']==3
        assert (directory/'attempts').read_text().count('attempt')==4
        print('PASS: initial launch plus exactly three bounded restart attempts, then faulted')
        (directory/'attempts').unlink()
        process=subprocess.Popen([str(supervisor),'--config',str(config)])
        until(lambda:json.loads((directory/'status.json').read_text()),lambda s:s['phase']=='backoff')
        write_json(directory/'stop.json',{'requestedAtMs':0})
        process.wait(timeout=5)
        assert (directory/'attempts').read_text().count('attempt')==1
        assert json.loads((directory/'status.json').read_text())['phase']=='stopped'
        print('PASS: stop during backoff cancels all remaining restart attempts')
    finally:
        if process.poll() is None:
            process.terminate()
            process.wait(timeout=45)
