"""Run the native Studio client against a fresh, isolated Runtime simulator."""
import os
from pathlib import Path
import subprocess
import tempfile
import time
import struct
import zlib

root = Path(__file__).resolve().parents[1]
runtime = Path(os.environ.get("AHAKEY_RUNTIME_BINARY", root.parent / "ahakey-runtime-rust/target/debug/ahakey-runtime-rust"))
if not runtime.is_file():
    raise SystemExit("Build the sibling ahakey-runtime-rust repository, or set AHAKEY_RUNTIME_BINARY.")
subprocess.run(["cargo", "build", "--manifest-path", "src-tauri/Cargo.toml", "--example", "runtime_session_smoke", "--locked"], cwd=root, check=True)
with tempfile.TemporaryDirectory(prefix="ahakey-studio-smoke-") as temporary:
    discovery = Path(temporary) / "discovery.json"
    # Deterministic 160x80 RGB test pattern, created without image-library dependencies.
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    pixels = b"".join(b"\0" + bytes(value for x in range(160) for value in (x, y, (x + y) % 256)) for y in range(80))
    picture = Path(temporary) / "test.png"
    picture.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 160, 80, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b""))
    with open(Path(temporary) / "runtime.log", "w+") as log:
        process = subprocess.Popen([str(runtime), "--mock", "--parent-stdin", "--discovery", str(discovery)], stdin=subprocess.PIPE, stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 15
            while not discovery.exists():
                if process.poll() is not None or time.monotonic() > deadline:
                    log.seek(0)
                    raise RuntimeError("Mock Runtime did not start: " + log.read())
                time.sleep(0.05)
            env = dict(os.environ, AHAKEY_RUNTIME_DISCOVERY=str(discovery), AHAKEY_SMOKE_IMAGE=str(picture))
            subprocess.run([str(root / "src-tauri/target/debug/examples/runtime_session_smoke")], env=env, cwd=root, timeout=45, check=True)
        finally:
            process.stdin.close()
            try:
                process.wait(timeout=35)
            except subprocess.TimeoutExpired:
                process.terminate()
                process.wait(timeout=5)
