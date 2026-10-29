# -*- coding: utf-8 -*-
"""Статическая проверка связности: id из index.html против ссылок в JS. Плюс проверка ZIP."""
import os
import re
import sys
import zipfile
import tempfile

APP = r"C:\Users\user\Desktop\восток\arendalog\app"

html = open(os.path.join(APP, "index.html"), encoding="utf-8").read()
ids = set(re.findall(r'\bid="([^"]+)"', html))
print("id в разметке: %d" % len(ids))

js_files = ["js/core.js", "js/ui.js", "js/main.js"]
refs = {}
for f in js_files:
    src = open(os.path.join(APP, f), encoding="utf-8").read()
    for m in re.findall(r"""\$\(['"]#([A-Za-z0-9_-]+)['"]\)""", src):
        refs.setdefault(m, set()).add(f)
    for m in re.findall(r"""getElementById\(['"]([A-Za-z0-9_-]+)['"]\)""", src):
        refs.setdefault(m, set()).add(f)

# создаётся динамически
dynamic = {"printArea", "printStyle"}

missing = sorted(k for k in refs if k not in ids and k not in dynamic)
print("ссылок на id: %d" % len(refs))
if missing:
    print("НЕТ В РАЗМЕТКЕ (это сломает интерфейс):")
    for m in missing:
        print("  - #%s  (используется в %s)" % (m, ", ".join(sorted(refs[m]))))
else:
    print("все ссылки на id найдены ✓")

# элементы, объявленные, но не используемые — не ошибка, просто информация
unused = sorted(i for i in ids if i not in refs and i not in {"app", "screens", "modal", "modalBody", "modalTitle"})
print("объявлены, но не адресуются из JS: %s" % (", ".join(unused) if unused else "—"))

# проверка data-атрибутов
for attr in ["data-tab", "data-filter", "data-go", "data-hv"]:
    n = len(re.findall(attr + r'="', html))
    print("%s: %d" % (attr, n))

# ZIP из теста
zp = os.path.join(tempfile.gettempdir(), "arendalog-test.zip")
if os.path.exists(zp):
    with zipfile.ZipFile(zp) as z:
        bad = z.testzip()
        print("ZIP: файлов %d, CRC %s" % (len(z.namelist()), "ОШИБКА" if bad else "в порядке ✓"))
        for n in z.namelist():
            print("   %s — %d байт" % (n, len(z.read(n))))

sys.exit(1 if missing else 0)
