"""
Génère html/shared/js/icons.js à partir des icônes Lucide (https://lucide.dev, licence ISC).

Pourquoi un fichier généré plutôt que le paquet npm chargé dans la page :
la CSP du gateway interdit les scripts externes, et les pages n'ont pas de
bundler. On recopie donc SEULEMENT les icônes utilisées, sous forme de
données (balise + attributs), dessinées ensuite avec createElementNS.

Ajouter une icône :
  1. chercher son nom sur https://lucide.dev/icons ;
  2. l'ajouter à ICONS_USED_BY_THE_APP ci-dessous (nom dans l'app -> nom Lucide) ;
  3. relancer :  python main-app/gateway/scripts/generate_lucide_icons.py

Le script télécharge lucide-static (version figée ci-dessous) depuis le
registre npm, dans un dossier temporaire ; rien n'est installé.
"""

import io
import json
import tarfile
import urllib.request
from pathlib import Path

LUCIDE_VERSION = "1.67.0"
LUCIDE_PACKAGE_URL = f"https://registry.npmjs.org/lucide-static/-/lucide-static-{LUCIDE_VERSION}.tgz"
OUTPUT_FILE = Path(__file__).resolve().parent.parent / "html" / "shared" / "js" / "icons.js"
LICENSE_FILE = Path(__file__).resolve().parent.parent / "html" / "shared" / "js" / "LICENSE-lucide.txt"

# Nom utilisé dans le code de l'app (createIcon("...") / data-icon="...") -> nom de l'icône Lucide.
ICONS_USED_BY_THE_APP = {
    # Navigation
    "home": "house",
    "bot": "bot-message-square",
    "map": "map",
    "message": "message-circle",
    "phone": "phone",
    "settings": "settings",
    "shield": "shield-check",
    "logout": "log-out",
    "collapseSidebar": "chevron-first",
    "sun": "sun",
    "moon": "moon",
    "wrench": "wrench",
    "externalLink": "external-link",
    # Appels
    "phoneOff": "phone-off",
    "phoneIncoming": "phone-incoming",
    "phoneOutgoing": "phone-outgoing",
    # Personnes
    "users": "users",
    "userPlus": "user-plus",
    "userCog": "user-cog",
    # Carte
    "locate": "locate-fixed",
    "radar": "radar",
    "pin": "map-pin",
    "creditCard": "credit-card",
    "store": "store",
    "package": "package",
    "alert": "triangle-alert",
    "dot": "circle-dot",
    # Messagerie
    "image": "image",
    "microphone": "mic",
    "microphoneOff": "mic-off",
    "send": "send-horizontal",
    # Actions génériques
    "plus": "plus",
    "close": "x",
    "check": "check",
    "arrowLeft": "arrow-left",
    "chevronRight": "chevron-right",
    "chevronDown": "chevron-down",
    "search": "search",
    "filter": "funnel",
    "edit": "pencil",
    "trash": "trash",
    "refresh": "refresh-cw",
    "key": "key-round",
    "eye": "eye",
    "clock": "clock",
    "history": "rotate-ccw-clock",
    "inbox": "inbox",
    "sparkles": "sparkles",
    # Administration de l’ATM-Chatbot
    "lightbulb": "lightbulb",
    "clipboardList": "clipboard-list",
    "errorCode": "circle-alert",
    "listOrdered": "list-ordered",
    "approved": "circle-check-big",
    "rejected": "circle-x",
    "hash": "hash",
}

FILE_HEADER = """/**
 * Icônes de l'interface : jeu Lucide (https://lucide.dev, licence ISC, voir LICENSE-lucide.txt).
 *
 * FICHIER GÉNÉRÉ par gateway/scripts/generate_lucide_icons.py : ne pas modifier
 * à la main, ajouter l'icône dans le script puis le relancer.
 *
 * Les formes sont dessinées avec createElementNS : pas de fichier image à
 * charger, pas d'innerHTML, rien qui gêne la CSP. Elles prennent la couleur
 * du texte (stroke: currentColor dans base.css).
 *
 *   JavaScript : bouton.prepend(createIcon("phone"))
 *   HTML       : <span data-icon="map"></span>  (remplacé par replaceIconPlaceholders())
 */

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Chaque icône = liste de formes [balise, attributs] (format « icon node » de Lucide). */
const ICON_SHAPES = {
"""

FILE_FOOTER = """};

/** <svg> de l'icône `iconName`, décorative (aria-hidden) : le texte du bouton ou son aria-label la décrit. */
export function createIcon(iconName, className = "icon") {
  const svgElement = document.createElementNS(SVG_NAMESPACE, "svg");
  svgElement.setAttribute("viewBox", "0 0 24 24");
  svgElement.setAttribute("aria-hidden", "true");
  svgElement.setAttribute("focusable", "false");
  svgElement.setAttribute("class", className);
  for (const [tagName, attributes] of ICON_SHAPES[iconName] ?? []) {
    const shapeElement = document.createElementNS(SVG_NAMESPACE, tagName);
    for (const [attributeName, attributeValue] of Object.entries(attributes)) {
      shapeElement.setAttribute(attributeName, attributeValue);
    }
    svgElement.append(shapeElement);
  }
  return svgElement;
}

/** Remplace chaque <span data-icon="nom"> du document (ou de `rootElement`) par son icône. */
export function replaceIconPlaceholders(rootElement = document) {
  for (const placeholder of rootElement.querySelectorAll("[data-icon]")) {
    placeholder.replaceWith(createIcon(placeholder.dataset.icon, placeholder.className || "icon"));
  }
}
"""


def download_lucide_package() -> tarfile.TarFile:
    with urllib.request.urlopen(LUCIDE_PACKAGE_URL, timeout=60) as response:
        return tarfile.open(fileobj=io.BytesIO(response.read()), mode="r:gz")


def read_package_file(package: tarfile.TarFile, relative_path: str) -> str:
    return package.extractfile(f"package/{relative_path}").read().decode("utf-8")


def main() -> None:
    package = download_lucide_package()
    icon_nodes_by_lucide_name = json.loads(read_package_file(package, "icon-nodes.json"))

    unknown_icons = sorted(name for name in ICONS_USED_BY_THE_APP.values() if name not in icon_nodes_by_lucide_name)
    if unknown_icons:
        raise SystemExit(f"Icônes absentes de Lucide {LUCIDE_VERSION} : {', '.join(unknown_icons)}")

    icon_lines = [
        f"  {app_name}: {json.dumps(icon_nodes_by_lucide_name[lucide_name], ensure_ascii=False)}, // lucide: {lucide_name}"
        for app_name, lucide_name in ICONS_USED_BY_THE_APP.items()
    ]
    OUTPUT_FILE.write_text(FILE_HEADER + "\n".join(icon_lines) + "\n" + FILE_FOOTER, encoding="utf-8", newline="\n")
    LICENSE_FILE.write_text(read_package_file(package, "LICENSE"), encoding="utf-8", newline="\n")
    print(f"{len(icon_lines)} icônes écrites dans {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
