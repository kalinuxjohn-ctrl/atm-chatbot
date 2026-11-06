"""Local Docker/WSL startup, without replacing existing configuration or data."""

import argparse
import fcntl
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
from urllib.error import URLError
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parents[1]
COMPOSE = [
    "docker", "compose", "--project-name", "atm-chatbot",
    "--env-file", str(ROOT / ".env"),
    "-f", str(ROOT / "docker-compose.yml"),
    "-f", str(ROOT / "docker-compose.main-app.yml"),
    "-f", str(ROOT / "docker-compose.local.yml"),
]


def run(command, **kwargs):
    return subprocess.run(command, cwd=ROOT, check=True, text=True, **kwargs)


def read_environment():
    result = run(
        ["docker", "compose", "--env-file", str(ROOT / ".env"),
         "-f", "-", "config", "--environment"],
        input="services:\n  configuration:\n    image: busybox\n",
        capture_output=True,
    )
    return dict(line.split("=", 1) for line in result.stdout.splitlines() if "=" in line)


def missing_configuration(environment):
    defaults = {
        "MAIN_APP_DATABASE_PASSWORD": secrets.token_hex(24),
        "ADMIN_API_KEY": secrets.token_hex(32),
        "ATM_CHATBOT_GATEWAY_SHARED_SECRET": secrets.token_hex(32),
        "MAIN_APP_MAP_TILE_URL_TEMPLATE": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "MAIN_APP_MAP_TILE_USER_AGENT": "atm-main-app-local-development/1.0",
    }
    return {key: value for key, value in defaults.items() if not environment.get(key)}


def prepare_configuration():
    env_path = ROOT / ".env"
    if not env_path.exists():
        env_path.write_text((ROOT / ".env.example").read_text(encoding="utf-8"), encoding="utf-8")
        env_path.chmod(0o600)
        raise RuntimeError(
            ".env cree depuis le modele. Renseigner DATABASE_URL et les cles IA, puis relancer."
        )
    environment = read_environment()
    required = ["DATABASE_URL", "VOYAGE_API_KEY"]
    provider = environment.get("LLM_PROVIDER") or "claude"
    if provider not in {"claude", "gemini"}:
        raise RuntimeError("LLM_PROVIDER doit valoir claude ou gemini.")
    required.append("CLAUDE_API_KEY" if provider == "claude" else "GEMINI_API_KEY")
    missing = [key for key in required if not environment.get(key)]
    if missing:
        raise RuntimeError(f"Renseigner dans .env : {', '.join(missing)}.")
    additions = missing_configuration(environment)
    if additions:
        with env_path.open("a", encoding="utf-8") as env_file:
            env_file.write("\n# Initialisation locale automatique (ne pas partager ces secrets).\n")
            for key, value in additions.items():
                env_file.write(f"{key}='{value}'\n")
        print("Parametres locaux manquants ajoutes a .env (valeurs non affichees).", flush=True)


def published_port(service, container_port):
    address = run(
        COMPOSE + ["port", service, str(container_port)], capture_output=True,
    ).stdout.strip()
    if not address:
        raise RuntimeError(f"Aucun port publie pour {service}.")
    return int(address.rsplit(":", 1)[1])


def check_http(url, expected_status=200):
    with urlopen(url, timeout=10) as response:
        if response.status != expected_status:
            raise RuntimeError(f"Verification HTTP echouee : {url}.")


def bootstrap_administrator():
    result = run(
        COMPOSE + ["exec", "-T", "main-app-auth", "node",
                   "src/jobs/createAdmin.js", "--check"],
        capture_output=True,
    )
    if json.loads(result.stdout)["hasActiveAdministrator"]:
        print("Administrateur actif deja present : aucun compte ni mot de passe modifie.", flush=True)
        return
    credentials_path = ROOT / ".local" / "initial-admin.json"
    if not credentials_path.exists():
        credentials = {
            "username": "admin",
            "fullName": "Administrateur",
            "password": secrets.token_urlsafe(32),
        }
        with credentials_path.open("x", encoding="utf-8") as credentials_file:
            os.chmod(credentials_path, 0o600)
            json.dump(credentials, credentials_file, indent=2)
    run(
        COMPOSE + ["exec", "-T", "main-app-auth", "node",
                   "src/jobs/createAdmin.js", "--bootstrap"],
        input=credentials_path.read_text(encoding="utf-8"),
    )
    print("Identifiants initiaux : .local/initial-admin.json (local, ignore par Git).", flush=True)
    print("Changer le mot de passe dans Mon compte, puis supprimer ce fichier.", flush=True)


def start(*, rebuild_base=False):
    prepare_configuration()
    run(COMPOSE + ["config", "--quiet"])
    print("Construction des images et demarrage (premier lancement plus long)...", flush=True)
    base_image = subprocess.run(
        ["docker", "image", "inspect", "atm-python-base:latest"],
        cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    if rebuild_base or base_image.returncode != 0:
        run(["docker", "build", "-f", "Dockerfile.base", "-t", "atm-python-base:latest", "."])
    else:
        print("Image Python de base deja disponible : reutilisation.", flush=True)
    # All four Node services and the database job use the same image.
    run(COMPOSE + ["build", "web", "init-db", "chatbot-frontend", "main-app-auth", "main-app-gateway"])
    run(COMPOSE + ["up", "-d", "--no-build", "--wait", "--wait-timeout", "180"])
    gateway_port = published_port("main-app-gateway", 8080)
    api_port = published_port("web", 8000)
    database_port = published_port("db", 5432)
    origin = f"http://localhost:{gateway_port}"
    check_http(f"{origin}/health")
    check_http(f"{origin}/auth/login.html")
    check_http(f"http://localhost:{api_port}/health")
    bootstrap_administrator()
    print(
        f"\nApplication prete (developpement local, HTTP)\n"
        f"  Application    : {origin}\n"
        f"  Connexion      : {origin}/auth/login.html\n"
        f"  Administration : {origin}/admin/\n"
        f"  ATM-Chatbot    : {origin}/atm-chatbot/\n"
        f"  API / docs     : http://localhost:{api_port}/docs\n"
        f"  PostgreSQL     : localhost:{database_port}\n"
        "  Services internes : auth / carte / messages / appels : 3000 (non publie)\n"
        "  Frontend chatbot  : 5173 (interne, accessible via l'application)\n"
        "\nLes donnees et les pieces jointes existantes sont conservees.\n",
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", nargs="?", choices=["start", "stop", "status", "logs"], default="start")
    parser.add_argument("--rebuild-base", action="store_true", help="Reconstruire les dependances Python.")
    arguments = parser.parse_args()
    action = arguments.action
    run(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    if action != "start":
        services = run(COMPOSE + ["config", "--services"], capture_output=True).stdout.split()
        if action == "stop":
            run(COMPOSE + ["stop"] + services)
        elif action == "status":
            run(COMPOSE + ["ps", "-a"] + services)
        else:
            run(COMPOSE + ["logs", "--tail", "100", "-f"] + services)
        return
    local_directory = ROOT / ".local"
    local_directory.mkdir(mode=0o700, exist_ok=True)
    with (local_directory / "startup.lock").open("w") as lock_file:
        try:
            fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("Un autre lancement est deja en cours.") from error
        start(rebuild_base=arguments.rebuild_base)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError, URLError, subprocess.CalledProcessError) as error:
        # Captured subprocess output may contain configuration values or credentials.
        print(f"Echec du lancement : {error}", file=sys.stderr)
        print("Verifier Docker/WSL, .env et les ports. Journaux : .\\start.ps1 logs", file=sys.stderr)
        sys.exit(1)
