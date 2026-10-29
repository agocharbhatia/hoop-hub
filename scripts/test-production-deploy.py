"""Exercise deployment failure paths without touching Docker, networking, or production data."""

import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'deploy/update-production.sh'
REVISION = 'a' * 40
PREVIOUS = 'b' * 40

# Command doubles keep the real shell control flow and checksum verification under test.
FAKE_COMMAND = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ['DEPLOY_STATE_DIR'])
args = sys.argv[1:]
command = pathlib.Path(sys.argv[0]).name
scenario = os.environ['SCENARIO']
active_file = root / 'active'
active = active_file.read_text() if active_file.exists() else 'previous'
with (root / 'calls').open('a') as log:
    log.write(json.dumps([command, args, os.environ.get('HOOP_HUB_IMAGE')]) + '\n')
if command in ['sleep', 'flock']:
    sys.exit(0)
if command == 'docker':
    if args[0] == 'compose' and 'ps' in args:
        print('existing-container')
    elif args[0] == 'inspect':
        print('sha256:previous' if '.Image' in args[2] else (os.environ['REVISION'] if scenario == 'unchanged' else os.environ['PREVIOUS']))
    elif args[:2] == ['image', 'inspect']:
        print('wrong' if scenario == 'wrong-image' else ('sha256:current' if '.Id' in args[3] else os.environ['REVISION']))
    elif args[0] == 'compose' and 'up' in args:
        active_file.write_text('previous' if os.environ['HOOP_HUB_IMAGE'].endswith(':rollback') else 'new')
    sys.exit(0)
if command == 'curl':
    url = next(a for a in args if a.startswith('http'))
    if '/api/ready' in url:
        sys.exit(1 if scenario == 'unhealthy' and active == 'new' else 0)
    output = pathlib.Path(args[args.index('-o') + 1])
    if '/releases/tags/production' in url:
        data = json.dumps({'assets': [{'name': 'production.json', 'browser_download_url': 'https://example.test/manifest'}, {'name': 'hoop-hub-' + os.environ['REVISION'] + '.tar.gz', 'browser_download_url': 'https://example.test/image'}]}).encode()
    elif url.endswith('/manifest'):
        data = (root / 'fixture.json').read_bytes()
    elif url.endswith('/image'):
        data = b'checked image archive'
    else:
        data = json.dumps({'revision': os.environ['REVISION'] if active == 'new' else os.environ['PREVIOUS']}).encode()
    output.write_bytes(data)
'''


class ProductionDeploymentTests(unittest.TestCase):
    # Test fixture helpers
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        tools = self.root / 'bin'
        tools.mkdir()
        for name in ['docker', 'curl', 'sleep', 'flock']:
            executable = tools / name
            executable.write_text(FAKE_COMMAND)
            executable.chmod(0o755)
        # macOS uses shasum; production uses the real Linux sha256sum.
        if sys.platform == 'darwin':
            executable = tools / 'sha256sum'
            executable.write_text('#!/bin/sh\nexec shasum -a 256 -c >/dev/null\n')
            executable.chmod(0o755)
        self.environment = dict(os.environ, DEPLOY_DIR=str(self.root), DEPLOY_STATE_DIR=str(self.root),
                                PATH=str(tools) + ':' + os.environ['PATH'], REVISION=REVISION,
                                PREVIOUS=PREVIOUS, SCENARIO='success')
        self.manifest = {'version': 1, 'repository': 'agocharbhatia/hoop-hub', 'revision': REVISION,
                         'sha256': hashlib.sha256(b'checked image archive').hexdigest(),
                         'asset': f'hoop-hub-{REVISION}.tar.gz'}

    def deploy(self, scenario='success'):
        (self.root / 'fixture.json').write_text(json.dumps(self.manifest))
        result = subprocess.run(['bash', str(SCRIPT)], env=dict(self.environment, SCENARIO=scenario),
                                capture_output=True, text=True, timeout=10)
        calls = [json.loads(line) for line in (self.root / 'calls').read_text().splitlines()]
        return result, calls

    # End test fixture helpers

    def test_success_backs_up_before_replacing_the_app(self):
        result, calls = self.deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        backup = next(i for i, call in enumerate(calls) if call[0] == 'docker' and call[1][0] == 'exec')
        restart = next(i for i, call in enumerate(calls) if call[0] == 'docker' and 'up' in call[1])
        self.assertLess(backup, restart)
        self.assertEqual((self.root / 'revision').read_text().strip(), REVISION)

    def test_bad_checksum_never_loads_or_restarts_an_image(self):
        self.manifest['sha256'] = '0' * 64
        result, calls = self.deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any(call[0] == 'docker' and call[1][0] in ['load', 'exec'] for call in calls))
        self.assertFalse(any('up' in call[1] for call in calls))

    def test_unhealthy_release_rolls_back_and_is_not_retried(self):
        result, calls = self.deploy('unhealthy')
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.root / 'active').read_text(), 'previous')
        self.assertEqual((self.root / 'failed-revision').read_text().strip(), REVISION)
        self.assertFalse((self.root / 'revision').exists())
        (self.root / 'calls').write_text('')
        result, calls = self.deploy('unhealthy')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('up' in call[1] for call in calls))

    def test_current_release_does_not_restart(self):
        result, calls = self.deploy('unchanged')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(any('up' in call[1] for call in calls))

    def test_image_revision_must_match_the_manifest(self):
        result, calls = self.deploy('wrong-image')
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(any('up' in call[1] for call in calls))


if __name__ == '__main__':
    unittest.main()
