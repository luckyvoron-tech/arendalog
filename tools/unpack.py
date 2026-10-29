# -*- coding: utf-8 -*-
"""Распаковка тулчейна в ASCII-путь C:\\arendatools."""
import os
import shutil
import zipfile

BASE = r"C:\arendatools"
DL = r"C:\Users\user\Desktop\восток\arendalog\tools\downloads"


def log(m):
    print(m, flush=True)


def extract_stripped(zip_path, dest, find_file):
    """Распаковывает zip во временную папку, находит find_file и переносит его корень в dest."""
    tmp = dest + "_tmp"
    if os.path.exists(tmp):
        shutil.rmtree(tmp)
    os.makedirs(tmp, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(tmp)
    hit = None
    for root, _dirs, files in os.walk(tmp):
        if find_file in files:
            hit = os.path.join(root, find_file)
            break
    if not hit:
        raise SystemExit("не найден %s в %s" % (find_file, zip_path))
    # корень = папка, в которой лежит искомый файл
    src = os.path.dirname(hit)
    if os.path.exists(dest):
        shutil.rmtree(dest)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    shutil.move(src, dest)
    shutil.rmtree(tmp, ignore_errors=True)
    log("готово: %s" % dest)
    return dest


os.makedirs(BASE, exist_ok=True)

jdk = extract_stripped(os.path.join(DL, "jdk17.zip"), os.path.join(BASE, "jdk"), "javac.exe")
bt = extract_stripped(os.path.join(DL, "build-tools.zip"), os.path.join(BASE, "sdk", "build-tools", "34.0.0"), "aapt2.exe")
pl = extract_stripped(os.path.join(DL, "platform-35.zip"), os.path.join(BASE, "sdk", "platforms", "android-35"), "android.jar")

checks = [
    os.path.join(jdk, "bin", "javac.exe"),
    os.path.join(bt, "aapt2.exe"),
    os.path.join(bt, "d8.bat"),
    os.path.join(bt, "zipalign.exe"),
    os.path.join(bt, "apksigner.bat"),
    os.path.join(pl, "android.jar"),
]
for c in checks:
    log(("OK  " if os.path.exists(c) else "НЕТ ") + c)
