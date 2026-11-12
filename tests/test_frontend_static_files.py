"""Static frontend files are reread without restarting the HTTP server."""

import importlib.util
import contextlib
import io
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from unittest.mock import patch


SERVER_PATH = Path(__file__).resolve().parents[1] / "frontend" / "server.py"
spec = importlib.util.spec_from_file_location("frontend_static_server", SERVER_PATH)
frontend_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frontend_server)


class FrontendStaticFilesTests(unittest.TestCase):
    def test_proxy_forwards_a_delta_before_the_upstream_finishes(self):
        release = threading.Event()

        class Upstream(BaseHTTPRequestHandler):
            def do_POST(self):
                self.send_response(200)
                self.send_header("Content-Type", "application/x-ndjson")
                self.end_headers()
                self.wfile.write(b'{"type":"delta","text":"Premier morceau"}\n')
                self.wfile.flush()
                release.wait(5)
                self.wfile.write(b'{"type":"done","response":{"conversation_id":7,"reply":"Complet"}}\n')

            def log_message(self, *args):
                pass

        upstream = ThreadingHTTPServer(("127.0.0.1", 0), Upstream)
        proxy = ThreadingHTTPServer(("127.0.0.1", 0), frontend_server.FrontendRequestHandler)
        threads = [threading.Thread(target=server.serve_forever, daemon=True) for server in (upstream, proxy)]
        with patch.object(frontend_server, "API_BASE_URL", f"http://127.0.0.1:{upstream.server_port}"):
            for thread in threads:
                thread.start()
            try:
                request = Request(f"http://127.0.0.1:{proxy.server_port}/api/chat/stream", data=b"{}")
                with urlopen(request, timeout=2) as response:
                    self.assertEqual(response.headers["X-Accel-Buffering"], "no")
                    self.assertEqual(response.headers["Cache-Control"], "no-store")
                    self.assertIn(b'"type":"delta"', response.readline())
                    self.assertFalse(release.is_set())
                    release.set()
                    self.assertIn(b'"type":"done"', response.readline())
                    self.assertEqual(response.read(), b"")
            finally:
                release.set()
                for server in (proxy, upstream):
                    server.shutdown()
                    server.server_close()
                for thread in threads:
                    thread.join(timeout=5)

    def test_health_check_succeeds_without_access_log(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), frontend_server.FrontendRequestHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            thread.start()
            try:
                with urlopen(f"http://127.0.0.1:{server.server_port}/health", timeout=5) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.read(), b'{"status":"ok"}')
            finally:
                server.shutdown()
                thread.join(timeout=5)
                server.server_close()
        self.assertEqual(output.getvalue(), "")

    def test_intervention_add_proxy_keeps_the_api_prefix(self):
        for path in (
            "/api/intervention_add",
            "/api/intervention_add/42",
            "/api/admin/intervention_add/42/approve",
        ):
            with self.subTest(path=path):
                self.assertTrue(path.startswith(frontend_server.BACKEND_PATHS_WITH_API_PREFIX))

    def test_saved_assets_are_visible_without_server_restart(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch.object(frontend_server, "PUBLIC_DIRECTORY", directory):
                server = ThreadingHTTPServer(("127.0.0.1", 0), frontend_server.FrontendRequestHandler)
                thread = threading.Thread(target=server.serve_forever, daemon=True)
                thread.start()
                try:
                    for filename in ("index.html", "style.css", "app.js"):
                        with self.subTest(filename=filename):
                            asset = Path(directory) / filename
                            url = f"http://127.0.0.1:{server.server_port}/{filename}"
                            asset.write_text("original", encoding="utf-8")
                            with urlopen(url, timeout=5) as response:
                                self.assertEqual(response.read(), b"original")
                                self.assertEqual(response.headers["Cache-Control"], "no-cache")
                            asset.write_text("updated content", encoding="utf-8")
                            with urlopen(url, timeout=5) as response:
                                self.assertEqual(response.read(), b"updated content")
                finally:
                    server.shutdown()
                    thread.join(timeout=5)
                    server.server_close()


if __name__ == "__main__":
    unittest.main()
