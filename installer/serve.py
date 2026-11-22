"""Loopback, read-only studio host."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import sys
import threading

HERE = Path(__file__).resolve().parent
DEV = "--tts-dev" in sys.argv
PORT = 21874 if DEV else 21870
sys.path.insert(0, str(HERE.parent / "service" if DEV else HERE))
speech_lock = threading.Lock()


class StudioFiles(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".wasm":"application/wasm",
                      ".js":"text/javascript", ".mjs":"text/javascript"}
    def __init__(self,*args,**kwargs):
        super().__init__(*args,directory=str(Path(__file__).parent/"studio"),**kwargs)
    def do_GET(self):
        if DEV:
            self.send_error(404)
        else:
            super().do_GET()

    def entry_page(self):
        return self.path.split("?", 1)[0] in ("/", "/index.html", "/interface-default.js")

    def send_head(self):
        # Both editions use this origin. An old edition's modification date
        # cannot validate the current edition's entry page.
        if self.entry_page():
            del self.headers["If-Modified-Since"]
        return super().send_head()

    def do_POST(self):
        if self.path != "/api/speech":
            self.send_error(404)
            return
        allowed = {"http://127.0.0.1:21870"} if not DEV else {"http://127.0.0.1:5173", "http://localhost:5173"}
        if self.headers.get("Host") != f"127.0.0.1:{PORT}" or self.headers.get("Origin") not in allowed:
            self.send_error(403)
            return
        if self.headers.get_content_type() != "application/json":
            self.send_error(415)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 20000:
                raise ValueError("Invalid request length.")
            request = json.loads(self.rfile.read(length))
            if not isinstance(request, dict):
                raise ValueError("Invalid speech request.")
            from tts import render
            with speech_lock:
                data = render(request.get("voice"), request.get("text"), request.get("speed", 1), request.get("pitch", 0))
        except ValueError as error:
            self.reply(400, "text/plain; charset=utf-8", str(error).encode())
            return
        except Exception:
            import traceback
            traceback.print_exc()
            self.reply(500, "text/plain", b"Speech generation failed. Check the studio log.")
            return
        self.reply(200, "audio/wav", data)

    def reply(self, status, kind, data):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def list_directory(self,path):
        self.send_error(404)
    def end_headers(self):
        if self.entry_page():
            self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options","nosniff")
        super().end_headers()

ThreadingHTTPServer(("127.0.0.1",PORT),StudioFiles).serve_forever()
