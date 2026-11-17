import logging
import unittest

from app.main import HealthAccessFilter


class HealthAccessLoggingTests(unittest.TestCase):
    def test_only_successful_health_access_is_hidden(self):
        for path, status, expected in (
            ("/health", 200, False),
            ("/health?probe=1", 200, False),
            ("/health", 503, True),
            ("/api/chat", 200, True),
            ("/api/calls/ws", 401, True),
        ):
            with self.subTest(path=path, status=status):
                record = logging.LogRecord(
                    "uvicorn.access", logging.INFO, "", 0, "%s %s %s %s %s",
                    ("127.0.0.1", "GET", path, "1.1", status), None,
                )
                self.assertEqual(HealthAccessFilter().filter(record), expected)

    def test_other_log_shapes_are_preserved(self):
        record = logging.LogRecord("uvicorn.access", logging.ERROR, "", 0, "failure", (), None)
        self.assertTrue(HealthAccessFilter().filter(record))
