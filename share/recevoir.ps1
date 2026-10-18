# Script du PC qui REÇOIT, servi par envoyer.ps1 (les valeurs __SERVER__ et
# __TOKEN__ sont remplies à l'envoi). Il vérifie WSL, puis délègue tout le
# travail à recevoir.sh, exécuté dans WSL.

$ErrorActionPreference = "Stop"
$server = "__SERVER__"
$token = "__TOKEN__"

if (-not (Get-Command wsl.exe -ErrorAction SilentlyContinue)) {
    Write-Host "WSL n'est pas installé sur ce PC. Installez-le (wsl --install), puis Docker dans Ubuntu." -ForegroundColor Red
    return
}
wsl.exe -e true 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "Aucune distribution WSL utilisable. Installez Ubuntu (wsl --install -d Ubuntu), puis Docker dedans." -ForegroundColor Red
    return
}

Write-Host "Réception du projet depuis $server ..." -ForegroundColor Cyan
# Pas de guillemets doubles dans la commande : Windows PowerShell 5.1 les transmet mal à wsl.exe.
$command = "curl -fsSL 'http://$server/recevoir.sh?t=$token' -o /tmp/atm-recevoir.sh && bash /tmp/atm-recevoir.sh $server $token"
wsl.exe -e bash -c $command
if ($LASTEXITCODE -ne 0) {
    Write-Host "L'installation a échoué (voir les messages ci-dessus)." -ForegroundColor Red
} else {
    Write-Host "Ouvrez http://localhost:5173 dans votre navigateur." -ForegroundColor Green
}
