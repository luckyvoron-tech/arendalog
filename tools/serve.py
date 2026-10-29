# -*- coding: utf-8 -*-
"""Локальный сервер для тестирования АрендаЛог на ПК.

Отдаёт веб-ядро приложения и проксирует запросы меток времени RFC 3161
(в браузере прямой запрос к TSA блокируется политикой CORS).

Запуск:  python tools/serve.py [порт]
Слушает только 127.0.0.1.
"""
import http.server
import json
import os
import socketserver
import ssl
import sys
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(os.path.dirname(HERE), "app")
VERIFY_HTML = os.path.join(APP, "verify.html")
TSA_URL = "https://freetsa.org/tsr"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8787


def verifier_js():
    """Скрипт с встроенным верификатором — как его генерирует сборка APK."""
    with open(VERIFY_HTML, encoding="utf-8") as fh:
        html = fh.read()
    return ("window.VERIFIER_HTML = " + json.dumps(html, ensure_ascii=True) + ";\n").encode("utf-8")


def proxy_tsa(body, content_type):
    req = urllib.request.Request(
        TSA_URL, data=body, method="POST",
        headers={
            "Content-Type": content_type or "application/timestamp-query",
            "Accept": "application/timestamp-reply",
            "User-Agent": "ArendaLog/1.0-dev",
        },
    )
    ctx = ssl.create_default_context()
    try:
        with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
            return r.status, r.read(), r.headers.get("Content-Type", "application/timestamp-reply")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), "text/plain"
    except ssl.SSLError:
        # на некоторых ПК нет полной цепочки корневых сертификатов — для локального теста допустимо
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, timeout=25, context=ctx) as r:
            return r.status, r.read(), r.headers.get("Content-Type", "application/timestamp-reply")


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=APP, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write("  %s\n" % (fmt % args))

    def _send(self, code, body, ctype, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if extra:
            for k, v in extra.items():
                self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/js/verifier-data.js":
            self._send(200, verifier_js(), "application/javascript; charset=utf-8")
            return
        if self.path.split("?")[0] == "/health":
            self._send(200, b"ok", "text/plain")
            return
        super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/tsa":
            self._send(404, b"not found", "text/plain")
            return
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else b""
        try:
            code, data, ctype = proxy_tsa(body, self.headers.get("Content-Type"))
            self._send(code if 200 <= code < 300 else 502, data, ctype,
                       {"Access-Control-Allow-Origin": "*"})
            sys.stderr.write("  TSA: %d, %d байт\n" % (code, len(data)))
        except Exception as e:
            self._send(502, ("TSA error: %s" % e).encode("utf-8"), "text/plain",
                       {"Access-Control-Allow-Origin": "*"})


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    with Server(("127.0.0.1", PORT), Handler) as httpd:
        print("АрендаЛог — тестовый сервер")
        print("  приложение : http://127.0.0.1:%d/" % PORT)
        print("  верификатор: http://127.0.0.1:%d/verify.html" % PORT)
        print("  прокси TSA  : http://127.0.0.1:%d/tsa" % PORT)
        print("  каталог    : %s" % APP)
        print("Остановить: Ctrl+C")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nостановлено")
