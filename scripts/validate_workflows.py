#!/usr/bin/env python3
import glob
import yaml
import sys

files = glob.glob('.github/workflows/*.yml') + glob.glob('.github/workflows/*.yaml')
if not files:
    print('No workflow files found')
    sys.exit(0)

errors = 0
for f in files:
    try:
        with open(f, 'r', encoding='utf8') as fh:
            content = fh.read()
        yaml.safe_load(content)
        print(f'OK: {f}')
    except Exception as e:
        errors += 1
        print(f'ERROR: {f} -> {e.__class__.__name__}: {e}')

if errors:
    print(f'Found {errors} invalid YAML workflow(s)')
    sys.exit(2)
else:
    print('All workflow YAML files parsed OK')
    sys.exit(0)
