# -*- coding: utf-8 -*-
"""Скачивание JDK 17 и Android SDK (build-tools + platform) для сборки APK без Gradle."""
import os
import sys
import time
import zipfile
import urllib.request

BASE = r"C:\Users\user\Desktop\восток\arendalog\tools"
DL = os.path.join(BASE, "downloads")
SDK = os.path.join(BASE, "sdk")
os.makedirs(DL, exist_ok=True)
os.makedirs(SDK, exist_ok=True)

TASKS = [
    ("jdk17.zip", "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse"),
    ("build-tools.zip", "https://dl.google.com/android/repository/build-tools_r34-windows.zip"),
    ("platform-35.zip", "https://dl.google.com/android/repository/platform-35_r02.zip"),
]


def log(msg):
    print(msg, flush=True)


def fetch(name, url):
    path = os.path.join(DL, name)
    if os.path.exists(path) and os.path.getsize(path) > 1_000_000:
        log("уже скачано: %s (%.1f МБ)" % (name, os.path.getsize(path) / 1e6))
        return path
    log("качаю %s ..." % name)
    t0 = time.time()
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as fh:
        total = int(r.headers.get("Content-Length") or 0)
        done = 0
        while True:
            chunk = r.read(1024 * 256)
            if not chunk:
                break
            fh.write(chunk)
            done += len(chunk)
            if total and done % (1024 * 1024 * 8) < 1024 * 256:
                log("  %s: %.0f%% (%.1f/%.1f МБ)" % (name, 100 * done / total, done / 1e6, total / 1e6))
    log("готово: %s — %.1f МБ за %.0f с" % (name, os.path.getsize(path) / 1e6, time.time() - t0))
    return path


def unzip(path, dest):
    os.makedirs(dest, exist_ok=True)
    with zipfile.ZipFile(path) as z:
        z.extractall(dest)
    return dest


def find(dirpath, filename):
    for root, _dirs, files in os.walk(dirpath):
        if filename in files:
            return os.path.join(root, filename)
    return None


for name, url in TASKS:
    fetch(name, url)

# --- JDK ---
jdk_root = os.path.join(BASE, "jdk")
if find(jdk_root, "javac.exe") is None:
    unzip(os.path.join(DL, "jdk17.zip"), jdk_root)
javac = find(jdk_root, "javac.exe")
log("javac: %s" % javac)

# --- build-tools ---
bt_root = os.path.join(SDK, "build-tools")
if find(bt_root, "aapt2.exe") is None:
    tmp = os.path.join(DL, "bt_extract")
    unzip(os.path.join(DL, "build-tools.zip"), tmp)
    aapt2 = find(tmp, "aapt2.exe")
    src_dir = os.path.dirname(aapt2)
    shutil_target = os.path.join(bt_root, "34.0.0")
    if os.path.exists(shutil_target):
        import shutil
        shutil.rmtree(shutil_target)
    os.makedirs(os.path.dirname(shutil_target), exist_ok=True)
    import shutil
    shutil.move(src_dir, shutil_target)
log("aapt2: %s" % find(bt_root, "aapt2.exe"))

# --- platform ---
pl_root = os.path.join(SDK, "platforms")
if find(pl_root, "android.jar") is None:
    tmp = os.path.join(DL, "pl_extract")
    unzip(os.path.join(DL, "platform-35.zip"), tmp)
    jar = find(tmp, "android.jar")
    import shutil
    target = os.path.join(pl_root, os.path.basename(os.path.dirname(jar)))
    os.makedirs(os.path.dirname(target), exist_ok=True)
    if os.path.exists(target):
        shutil.rmtree(target)
    shutil.move(os.path.dirname(jar), target)
log("android.jar: %s" % find(pl_root, "android.jar"))
log("ВСЁ ГОТОВО")
