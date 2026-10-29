# -*- coding: utf-8 -*-
"""Сборка APK АрендаЛог без Gradle: aapt2 -> javac -> d8 -> zipalign -> apksigner."""
import os
import shutil
import subprocess
import sys
import json
import zipfile

SRC = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = r"C:\arendabuild"
TOOLS = r"C:\arendatools"
JDK = os.path.join(TOOLS, "jdk")
BT = os.path.join(TOOLS, "sdk", "build-tools", "34.0.0")
PLATFORM = os.path.join(TOOLS, "sdk", "platforms", "android-35", "android.jar")

ENV = dict(os.environ)
ENV["JAVA_HOME"] = JDK
ENV["PATH"] = os.path.join(JDK, "bin") + os.pathsep + os.path.join(BT) + os.pathsep + ENV.get("PATH", "")

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def log(msg):
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        print(str(msg).encode("utf-8", "replace").decode("ascii", "replace"), flush=True)


def run(args, cwd=None, allow_fail=False):
    log("$ " + " ".join(args[:6]) + (" ..." if len(args) > 6 else ""))
    p = subprocess.run(args, cwd=cwd, env=ENV, capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = (p.stdout or "") + (p.stderr or "")
    if p.returncode != 0 and not allow_fail:
        log("---- STDOUT/STDERR ----")
        log(out[-6000:])
        raise SystemExit("КОМАНДА УПАЛА (%d): %s" % (p.returncode, args[0]))
    if out.strip():
        tail = out.strip().splitlines()
        for line in tail[-8:]:
            log("   " + line[:300])
    return p


def rmtree(p):
    if os.path.exists(p):
        shutil.rmtree(p)


def main():
    # ── 1. чистая папка сборки ──
    rmtree(BUILD)
    os.makedirs(BUILD)
    assets = os.path.join(BUILD, "assets")
    res = os.path.join(BUILD, "res")
    src_java = os.path.join(BUILD, "src")
    gen = os.path.join(BUILD, "gen")
    classes = os.path.join(BUILD, "classes")
    dex = os.path.join(BUILD, "dex")

    shutil.copytree(os.path.join(SRC, "app"), assets)
    shutil.copytree(os.path.join(SRC, "android", "res"), res)
    shutil.copytree(os.path.join(SRC, "android", "src"), src_java)
    manifest = os.path.join(SRC, "android", "AndroidManifest.xml")
    log("assets: %d файлов" % sum(len(f) for _, _, f in os.walk(assets)))

    # верификатор встраивается в приложение, чтобы гарантированно попадать в ZIP-пакет
    verify_path = os.path.join(SRC, "app", "verify.html")
    if os.path.exists(verify_path):
        with open(verify_path, encoding="utf-8") as fh:
            vhtml = fh.read()
        vjs = "window.VERIFIER_HTML = " + json.dumps(vhtml, ensure_ascii=True) + ";\n"
        with open(os.path.join(assets, "js", "verifier-data.js"), "w", encoding="utf-8") as fh:
            fh.write(vjs)
        log("верификатор встроен: %.1f КБ" % (len(vjs) / 1024))

    # ── 2. aapt2 compile ──
    compiled = os.path.join(BUILD, "compiled.zip")
    run([os.path.join(BT, "aapt2.exe"), "compile", "--dir", res, "-o", compiled])

    # ── 3. aapt2 link ──
    unsigned = os.path.join(BUILD, "unsigned.apk")
    run([os.path.join(BT, "aapt2.exe"), "link",
         "-o", unsigned,
         "-I", PLATFORM,
         "--manifest", manifest,
         "-R", compiled,
         "--java", gen,
         "--auto-add-overlay",
         "-A", assets])

    # ── 4. javac ──
    java_files = []
    for root, _d, files in os.walk(src_java):
        java_files += [os.path.join(root, f) for f in files if f.endswith(".java")]
    for root, _d, files in os.walk(gen):
        java_files += [os.path.join(root, f) for f in files if f.endswith(".java")]
    log("java файлов: %d" % len(java_files))
    os.makedirs(classes, exist_ok=True)
    run([os.path.join(JDK, "bin", "javac.exe"),
         "-encoding", "UTF-8", "-source", "8", "-target", "8",
         "-nowarn", "-classpath", PLATFORM,
         "-d", classes] + java_files, allow_fail=False)

    # ── 5. d8 ──
    os.makedirs(dex, exist_ok=True)
    class_files = []
    for root, _d, files in os.walk(classes):
        class_files += [os.path.join(root, f) for f in files if f.endswith(".class")]
    log("class файлов: %d" % len(class_files))
    run([os.path.join(BT, "d8.bat"), "--lib", PLATFORM, "--min-api", "24",
         "--release", "--output", dex] + class_files)
    if not os.path.exists(os.path.join(dex, "classes.dex")):
        raise SystemExit("classes.dex не создан")
    log("classes.dex: %.1f КБ" % (os.path.getsize(os.path.join(dex, "classes.dex")) / 1024))

    # ── 6. вставляем dex в apk ──
    dexed = os.path.join(BUILD, "dexed.apk")
    with zipfile.ZipFile(unsigned, "r") as zin, zipfile.ZipFile(dexed, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            zout.writestr(item, data)
        zout.writestr("classes.dex", open(os.path.join(dex, "classes.dex"), "rb").read())
    log("apk с dex: %.1f МБ" % (os.path.getsize(dexed) / 1e6))

    # ── 7. zipalign ──
    aligned = os.path.join(BUILD, "aligned.apk")
    run([os.path.join(BT, "zipalign.exe"), "-f", "-p", "4", dexed, aligned])

    # ── 8. ключ (храним рядом с APK, чтобы обновления вставали поверх) ──
    dist = os.path.join(SRC, "dist")
    os.makedirs(dist, exist_ok=True)
    ks = os.path.join(dist, "arendalog-release-key.keystore")
    if not os.path.exists(ks):
        run([os.path.join(JDK, "bin", "keytool.exe"), "-genkeypair", "-v",
             "-keystore", ks, "-alias", "arendalog",
             "-keyalg", "RSA", "-keysize", "2048", "-validity", "10000",
             "-storepass", "arendalog", "-keypass", "arendalog",
             "-dname", "CN=ArendaLog, OU=Mobile, O=ArendaLog, L=Sochi, C=RU"])
    else:
        log("использую существующий ключ: " + ks)

    # ── 9. подпись ──
    final = os.path.join(BUILD, "ArendaLog-1.0.apk")
    run([os.path.join(BT, "apksigner.bat"), "sign",
         "--ks", ks, "--ks-pass", "pass:arendalog", "--key-pass", "pass:arendalog",
         "--v1-signing-enabled", "true", "--v2-signing-enabled", "true",
         "--out", final, aligned])

    # ── 10. проверка ──
    log("=== проверка подписи ===")
    run([os.path.join(BT, "apksigner.bat"), "verify", "--print-certs", final])
    log("=== сведения о пакете ===")
    run([os.path.join(BT, "aapt2.exe"), "dump", "badging", final])

    # ── 11. копируем в проект ──
    dst = os.path.join(dist, "ArendaLog-1.0.apk")
    shutil.copy2(final, dst)
    log("ГОТОВО: %s (%.1f МБ)" % (dst, os.path.getsize(dst) / 1e6))


if __name__ == "__main__":
    main()
