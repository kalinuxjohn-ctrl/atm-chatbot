"""Apply the public application name to web assets at image build time."""

import os
from pathlib import Path
import re
import sys


def apply_branding(directory, app_name):
    if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 ._-]{0,79}", app_name):
        raise ValueError("APP_NAME must contain 1-80 letters, digits, spaces, dots, underscores or hyphens.")
    root = Path(directory)
    if not root.is_dir():
        raise ValueError(f"Web assets directory does not exist: {root}")
    for path in root.rglob("*"):
        if path.suffix not in {".html", ".js", ".css", ".svg"}:
            continue
        source = path.read_text(encoding="utf-8")
        branded = source.replace("ATM-<strong>Chatbot</strong>", app_name)
        branded = branded.replace("ATM-Chatbot", app_name)
        branded = branded.replace("Espace techniciens", app_name)
        if branded != source:
            path.write_text(branded, encoding="utf-8")


if __name__ == "__main__":
    apply_branding(sys.argv[1], os.environ.get("APP_NAME", "atm-chatbot"))
