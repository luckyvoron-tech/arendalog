# -*- coding: utf-8 -*-
"""Убирает BOM из текстовых файлов проекта (PowerShell Set-Content добавляет его)."""
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = ('.js', '.cjs', '.html', '.css', '.py', '.md', '.json', '.toml', '.xml', '.java')

fixed = []
for base, dirs, files in os.walk(ROOT):
    if '.git' in base.split(os.sep):
        continue
    for name in files:
        if not name.endswith(EXT):
            continue
        path = os.path.join(base, name)
        with open(path, 'rb') as fh:
            data = fh.read()
        if data.startswith(b'\xef\xbb\xbf'):
            with open(path, 'wb') as fh:
                fh.write(data[3:])
            fixed.append(os.path.relpath(path, ROOT))

print('BOM убран: %d файлов' % len(fixed))
for f in fixed[:40]:
    print('  ' + f)
