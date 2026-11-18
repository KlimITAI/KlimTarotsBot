"""Simple UTF-8 static server for KLIM TAROT Mini App with guaranteed JS/CSS MIME types."""
import http.server
import mimetypes
import os
import socketserver
from pathlib import Path

WEBAPP_DIR = Path(__file__).resolve().parent / "webapp"
PORT = int(os.environ.get("WEBAPP_PORT", "8080"))

mimetypes.add_type("application/javascript; charset=utf-8", ".js")
mimetypes.add_type("text/css; charset=utf-8", ".css")
mimetypes.add_type("text/html; charset=utf-8", ".html")
mimetypes.add_type("image/svg+xml", ".svg")


class TarotHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEBAPP_DIR), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


class ReuseTCPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


if __name__ == "__main__":
    with ReuseTCPServer(("127.0.0.1", PORT), TarotHandler) as httpd:
        print(f"KLIM TAROT Mini App server listening on http://127.0.0.1:{PORT}", flush=True)
        httpd.serve_forever()
