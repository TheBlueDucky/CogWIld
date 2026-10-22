"""Local dev server for Cogwild with caching disabled.

Run:  py serve.py      then open http://localhost:8765
"""
import http.server
import os

PORT = 8765


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    # Dev helper: POST a data-URL image to /__shot?name=x to save it in .devshots/
    def do_POST(self):
        if not self.path.startswith("/__shot"):
            self.send_error(404)
            return
        import base64
        import re
        from urllib.parse import parse_qs, urlparse
        name = re.sub(r"[^\w-]", "", parse_qs(urlparse(self.path).query).get("name", ["shot"])[0]) or "shot"
        body = self.rfile.read(int(self.headers.get("Content-Length", 0))).decode()
        data = base64.b64decode(body.split(",", 1)[-1])
        os.makedirs(".devshots", exist_ok=True)
        with open(os.path.join(".devshots", name + ".jpg"), "wb") as f:
            f.write(data)
        self.send_response(200)
        self.end_headers()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Expires", "0")
        super().end_headers()


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler) as httpd:
        print(f"Cogwild running at http://localhost:{PORT}")
        httpd.serve_forever()
