#!/usr/bin/env python3
"""Lokaler Entwicklungs-Server fuer QUADRO 3D.

Startet einen statischen Server (nur Python-Standardbibliothek, keine Pakete noetig)
und oeffnet den Editor im Browser. Damit funktionieren ES-Module und der
Teile-Katalog (fetch) auch ohne Internetverbindung.

    python serve.py            # Port 8000
    python serve.py 8080       # anderer Port
"""

import http.server
import socketserver
import os
import sys
import webbrowser
from functools import partial

ROOT = os.path.dirname(os.path.abspath(__file__))


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass  # ruhiger Output


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    socketserver.TCPServer.allow_reuse_address = True
    handler = partial(Handler, directory=ROOT)
    with socketserver.TCPServer(("0.0.0.0", port), handler) as httpd:
        url = f"http://127.0.0.1:{port}/web/index.html"
        print("=" * 52)
        print("  QUADRO 3D")
        print(f"  laeuft auf:  {url}")
        print("  Beenden:     Strg + C")
        print("=" * 52)
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer gestoppt.")


if __name__ == "__main__":
    main()
