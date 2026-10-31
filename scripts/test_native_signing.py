import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from native_signing import signing_identity, sign_component, IDENTIFIERS

class NativeSigningTests(unittest.TestCase):
    def test_local_certificate_is_shared_and_environment_is_explicit(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d)
            self.assertEqual(signing_identity(root, {}), '-')
            (root/'signing-identity.local').write_text('certificate-a\n')
            self.assertEqual(signing_identity(root, {}), 'certificate-a')
            self.assertEqual(signing_identity(root, {'APPLE_SIGNING_IDENTITY':'certificate-b'}), 'certificate-b')
            with self.assertRaises(ValueError): signing_identity(root, {'APPLE_SIGNING_IDENTITY':''})
    def test_every_native_component_gets_fixed_identity_and_certificate(self):
        with patch('native_signing.subprocess.run') as run:
            for name, identifier in IDENTIFIERS.items():
                sign_component(Path('/stage')/name, 'certificate-a', False)
                args=run.call_args_list[-2].args[0]
                self.assertEqual(args[args.index('--sign')+1], 'certificate-a')
                self.assertEqual(args[args.index('--identifier')+1], identifier)
                self.assertIn('--timestamp=none', args)
    def test_recording_responsible_processes_declare_audio_input(self):
        import plistlib
        with patch('native_signing.subprocess.run') as run:
            for name in IDENTIFIERS:
                sign_component(Path('/stage')/name, 'certificate-a', False)
                args=run.call_args_list[-2].args[0]
                if name in ['ahakey-runtime-rust', 'ahakey-runtime-supervisor']:
                    self.assertIn('--entitlements', args)
                    entitlements=Path(args[args.index('--entitlements')+1])
                    self.assertEqual(plistlib.loads(entitlements.read_bytes()), {'com.apple.security.device.audio-input':True})
                else:
                    self.assertNotIn('--entitlements', args)

    def test_failed_signing_cannot_produce_a_successful_stage(self):
        with patch('native_signing.subprocess.run', side_effect=RuntimeError('sign failed')):
            with self.assertRaises(RuntimeError): sign_component(Path('/stage/ahakey-runtime-supervisor'), 'certificate-a', True)

if __name__=='__main__': unittest.main()
