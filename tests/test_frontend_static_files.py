"""Static frontend files are reread without restarting the HTTP server."""

import importlib.util
import tempfile
import threading
import unittest
from http.server import ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen
from unittest.mock import patch


SERVER_PATH = Path(__file__).resolve().parents[1] / "frontend" / "server.py"
spec = importlib.util.spec_from_file_location("frontend_static_server", SERVER_PATH)
frontend_server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(frontend_server)


class FrontendStaticFilesTests(unittest.TestCase):
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
