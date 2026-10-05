#!/bin/sh
# Convertit chaque diagramme docs/diagrammes/*.svg en PNG haute définition
# (docs/diagrammes/png/), pratique pour Word ou PowerPoint.
# Utilise Chrome sans interface. Usage, depuis la racine du projet :
#   sh docs/to-png.sh
CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
DIAGRAMS="$(cd "$(dirname "$0")/diagrammes" && pwd)"
mkdir -p "$DIAGRAMS/png"

for svg in "$DIAGRAMS"/*.svg; do
  name=$(basename "$svg" .svg)
  # La taille de capture = la taille déclarée dans le viewBox du SVG.
  size=$(grep -o 'viewBox="[^"]*"' "$svg" | head -1 | tr -d '"' | cut -d= -f2)
  width=$(echo "$size" | cut -d' ' -f3)
  height=$(echo "$size" | cut -d' ' -f4)
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 \
    --window-size="$width,$height" \
    --screenshot="$(cygpath -m "$DIAGRAMS/png/$name.png")" \
    "file:///$(cygpath -m "$svg")" >/dev/null 2>&1
  echo "png/$name.png"
done
