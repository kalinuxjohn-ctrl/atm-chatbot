$ErrorActionPreference = "Stop"

$linuxRoot = & wsl.exe --exec wslpath -a $PSScriptRoot
if ($LASTEXITCODE -ne 0) {
    throw "WSL indisponible. Installer et demarrer la distribution avec Docker Compose."
}

& wsl.exe --cd $linuxRoot.Trim() --exec python3 scripts/start.py @args
exit $LASTEXITCODE
