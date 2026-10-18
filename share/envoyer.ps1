<#
Partage le projet avec un autre PC du MÊME réseau local, sans Internet.

    PC qui envoie (ce script)                    PC qui reçoit (une seule ligne)
    1. prépare le paquet dans WSL                irm http://<ip>:8765/recevoir.ps1?t=<jeton> | iex
       (images Docker, base, projet, .env)  ───> télécharge, vérifie, installe et démarre
    2. le sert sur le réseau local

Prérequis du PC qui reçoit : WSL + Docker installés dans la distribution par défaut.

Usage (PowerShell, depuis n'importe où) :
    powershell -ExecutionPolicy Bypass -File F:\shared_folder\atm-chatbot\share\envoyer.ps1
Options :
    -Port 8765            port ouvert le temps du transfert
    -IncludeModelCache    ajoute docker-cache (modèles Hugging Face, ~5 Go), inutile avec Voyage
    -KeepBundle           garde le paquet après le transfert (pour un autre PC)
    -ReuseBundle          réutilise le paquet gardé au lieu de le refaire
    -BundleParent D:\     où créer le dossier atm-share du paquet (~10 Go), par défaut le dossier temporaire
#>
param(
    [int]$Port = 8765,
    [switch]$IncludeModelCache,
    [switch]$KeepBundle,
    [switch]$ReuseBundle,
    [string]$BundleParent = $env:TEMP
)

$ErrorActionPreference = "Stop"

# --- Droits administrateur : nécessaires pour ouvrir le port dans le pare-feu ---
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "Droits administrateur nécessaires (pare-feu) : relance en mode administrateur..." -ForegroundColor Yellow
    $arguments = @("-NoExit", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-Port", $Port)
    if ($IncludeModelCache) { $arguments += "-IncludeModelCache" }
    if ($KeepBundle) { $arguments += "-KeepBundle" }
    if ($ReuseBundle) { $arguments += "-ReuseBundle" }
    $arguments += @("-BundleParent", "`"$BundleParent`"")
    Start-Process powershell.exe -Verb RunAs -ArgumentList $arguments
    return
}

$projectDir = Split-Path -Parent $PSScriptRoot
# Toujours un sous-dossier dédié : le nettoyage ne peut effacer que lui.
$bundleDir = Join-Path $BundleParent "atm-share"
$token = -join ((1..32) | ForEach-Object { "{0:x}" -f (Get-Random -Maximum 16) })
$firewallRuleName = "ATM chatbot - partage temporaire ($Port)"

function ConvertTo-WslPath([string]$windowsPath) {
    return (wsl.exe -e wslpath -a ($windowsPath -replace "\\", "/")).Trim()
}

# Les scripts bash doivent avoir des fins de ligne Unix, même si Git les a convertis.
function Read-UnixText([string]$path) {
    return ([IO.File]::ReadAllText($path) -replace "`r`n", "`n")
}

# =====================================================================
# 1. Préparation du paquet (dans WSL)
# =====================================================================
if ($ReuseBundle -and (Test-Path (Join-Path $bundleDir "manifest.txt"))) {
    Write-Host "Paquet existant réutilisé : $bundleDir" -ForegroundColor Cyan
} else {
    if (Test-Path $bundleDir) { Remove-Item $bundleDir -Recurse -Force }
    New-Item -ItemType Directory -Path $bundleDir | Out-Null

    $prepareScript = Join-Path $bundleDir "preparer-paquet.sh"
    [IO.File]::WriteAllText($prepareScript, (Read-UnixText (Join-Path $PSScriptRoot "preparer-paquet.sh")))

    Write-Host "Préparation du paquet (plusieurs minutes, ~10 Go écrits dans $bundleDir)..." -ForegroundColor Cyan
    $includeFlag = if ($IncludeModelCache) { "1" } else { "0" }
    wsl.exe -e bash (ConvertTo-WslPath $prepareScript) (ConvertTo-WslPath $projectDir) (ConvertTo-WslPath $bundleDir) $includeFlag
    if ($LASTEXITCODE -ne 0) { throw "La préparation du paquet a échoué (voir les messages ci-dessus)." }
    Remove-Item $prepareScript
}

# Seuls les fichiers listés dans le manifeste peuvent être téléchargés.
$servedFiles = @{ "manifest.txt" = Join-Path $bundleDir "manifest.txt" }
foreach ($line in Get-Content (Join-Path $bundleDir "manifest.txt")) {
    $name = ($line -split "\s+", 2)[1].Trim().TrimStart("*")
    $servedFiles[$name] = Join-Path $bundleDir $name
}
$receiverPs1 = Get-Content (Join-Path $PSScriptRoot "recevoir.ps1") -Raw -Encoding UTF8
$receiverSh = Read-UnixText (Join-Path $PSScriptRoot "recevoir.sh")

# =====================================================================
# 2. Petit serveur HTTP sur le réseau local
# =====================================================================
function Send-Response($stream, [int]$status, [string]$contentType, [long]$length) {
    $reason = @{ 200 = "OK"; 403 = "Forbidden"; 404 = "Not Found" }[$status]
    $header = "HTTP/1.1 $status $reason`r`nContent-Type: $contentType`r`nContent-Length: $length`r`nConnection: close`r`n`r`n"
    $bytes = [Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($bytes, 0, $bytes.Length)
}

function Send-Text($stream, [int]$status, [string]$text) {
    $body = (New-Object Text.UTF8Encoding $false).GetBytes($text)
    Send-Response $stream $status "text/plain; charset=utf-8" $body.Length
    $stream.Write($body, 0, $body.Length)
}

function Send-File($stream, [string]$path) {
    $file = [IO.File]::OpenRead($path)
    try {
        Send-Response $stream 200 "application/octet-stream" $file.Length
        $file.CopyTo($stream, 1MB)
    } finally {
        $file.Dispose()
    }
}

# Adresses IPv4 du PC sur le réseau local (celles qui ont une passerelle en premier).
$addresses = @(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } |
    ForEach-Object { $_.IPv4Address.IPAddress })
if (-not $addresses) {
    $addresses = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object {
        $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" -and $_.InterfaceAlias -notlike "vEthernet*"
    } | ForEach-Object { $_.IPAddress })
}

New-NetFirewallRule -DisplayName $firewallRuleName -Direction Inbound -Protocol TCP -LocalPort $Port -Action Allow -Profile Any | Out-Null
$listener = New-Object Net.Sockets.TcpListener ([Net.IPAddress]::Any, $Port)
try {
    $listener.Start()
    Write-Host ""
    Write-Host "Prêt. Sur l'autre PC (même réseau), ouvrir PowerShell et coller :" -ForegroundColor Green
    foreach ($address in $addresses) {
        Write-Host "    irm `"http://${address}:$Port/recevoir.ps1?t=$token`" | iex" -ForegroundColor White
    }
    if ($addresses.Count -gt 1) { Write-Host "(plusieurs réseaux : utilisez la ligne du réseau commun aux deux PC)" -ForegroundColor DarkGray }
    Write-Host "Le transfert s'arrête quand l'installation est terminée (ou Ctrl+C)." -ForegroundColor DarkGray
    Write-Host ""

    $finished = $false
    while (-not $finished) {
        # Attente non bloquante : Ctrl+C reste utilisable.
        if (-not $listener.Pending()) { Start-Sleep -Milliseconds 200; continue }
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = New-Object IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 1024, $true)
            $requestLine = $reader.ReadLine()
            $hostHeader = $null
            while ($true) {
                $line = $reader.ReadLine()
                if ([string]::IsNullOrEmpty($line)) { break }
                if ($line -match "^Host:\s*(.+)$") { $hostHeader = $Matches[1].Trim() }
            }
            if ($requestLine -notmatch "^GET (/[^ ?]*)(\?t=([0-9a-f]+))? HTTP") { Send-Text $stream 404 "Introuvable"; continue }
            $path, $givenToken = $Matches[1], $Matches[3]
            $from = $client.Client.RemoteEndPoint.Address

            if ($givenToken -ne $token) {
                Write-Host "Refusé (jeton invalide) : $from $path" -ForegroundColor Red
                Send-Text $stream 403 "Jeton invalide"
                continue
            }
            Write-Host "$from -> $path"
            if ($path -eq "/recevoir.ps1") {
                # L'adresse utilisée par l'autre PC (en-tête Host) est celle qu'il pourra rappeler.
                Send-Text $stream 200 ($receiverPs1.Replace("__SERVER__", $hostHeader).Replace("__TOKEN__", $token))
            } elseif ($path -eq "/recevoir.sh") {
                Send-Text $stream 200 $receiverSh
            } elseif ($path -like "/fichiers/*" -and $servedFiles.ContainsKey($path.Substring(10))) {
                Send-File $stream $servedFiles[$path.Substring(10)]
            } elseif ($path -eq "/termine") {
                Send-Text $stream 200 "OK"
                Write-Host "Installation terminée sur $from." -ForegroundColor Green
                $finished = $true
            } else {
                Send-Text $stream 404 "Introuvable"
            }
        } catch {
            Write-Host "Connexion interrompue : $($_.Exception.Message)" -ForegroundColor Yellow
        } finally {
            $client.Close()
        }
    }
} finally {
    $listener.Stop()
    Remove-NetFirewallRule -DisplayName $firewallRuleName -ErrorAction SilentlyContinue
    if (-not ($KeepBundle -or $ReuseBundle)) { Remove-Item $bundleDir -Recurse -Force -ErrorAction SilentlyContinue }
    Write-Host "Port $Port refermé." -ForegroundColor DarkGray
}
