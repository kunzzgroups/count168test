#Requires -Version 5.1
<#
.SYNOPSIS
  Windows → EC2 deploy via WinSCP (SFTP sync + remote bash).

.DESCRIPTION
  1) npm run build (frontend)
  2) WinSCP synchronize: frontend/dist, api, services/tx-realtime, deploy
  3) Remote: deploy/deploy-realtime.sh (SSE hub + nginx /realtime/)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\winscp-deploy-ec2.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File deploy\winscp-deploy-ec2.ps1 -SkipBuild
#>
[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [switch]$SkipRealtime,
  [string]$HostName = "56.68.48.190",
  [string]$UserName = "ec2-user",
  [string]$PrivateKey = "",
  [string]$WinScpExe = "",
  # WinSCP fingerprint form (not OpenSSH known_hosts). Override via deploy/local/winscp-ec2.ps1 if rotated.
  [string]$HostKey = "ssh-ed25519 255 vNQogXoDB7ksCOYdWcT0svbPJxTXZstJTbv1VficVEg"
)

$ErrorActionPreference = "Stop"
$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RepoRoot

# Optional local overrides (gitignored): deploy/local/winscp-ec2.ps1
$LocalCfg = Join-Path $PSScriptRoot "local\winscp-ec2.ps1"
if (Test-Path $LocalCfg) {
  Write-Host "==> load $LocalCfg"
  . $LocalCfg
  if ($DeployHost) { $HostName = $DeployHost }
  if ($DeployUser) { $UserName = $DeployUser }
  if ($DeployPrivateKey) { $PrivateKey = $DeployPrivateKey }
  if ($DeployWinScp) { $WinScpExe = $DeployWinScp }
  if ($DeployHostKey) { $HostKey = $DeployHostKey }
}

if (-not $PrivateKey) {
  $ppk = Join-Path $env:USERPROFILE ".ssh\Server_Key.ppk"
  $pem = Join-Path $env:USERPROFILE ".ssh\Server_Key.pem"
  # WinSCP needs PPK; convert once from PEM if needed.
  if (-not (Test-Path $ppk) -and (Test-Path $pem)) {
    $comHint = if ($WinScpExe) { $WinScpExe } else { "C:\Program Files (x86)\WinSCP\WinSCP.com" }
    if (Test-Path $comHint) {
      Write-Host "==> convert PEM → PPK for WinSCP"
      & $comHint /keygen $pem /output=$ppk
    }
  }
  $PrivateKey = if (Test-Path $ppk) { $ppk } else { $pem }
}
if (-not (Test-Path $PrivateKey)) {
  throw "Private key not found: $PrivateKey (need .ppk for WinSCP, or convert from Server_Key.pem)"
}

function Resolve-WinScpCom {
  param([string]$Hint)
  $candidates = @()
  if ($Hint) { $candidates += $Hint }
  $candidates += @(
    "C:\Program Files (x86)\WinSCP\WinSCP.com",
    "C:\Program Files\WinSCP\WinSCP.com"
  )
  $lnk = "C:\Users\Public\Desktop\WinSCP.lnk"
  if (Test-Path $lnk) {
    $sh = New-Object -ComObject WScript.Shell
    $target = $sh.CreateShortcut($lnk).TargetPath
    if ($target) {
      $com = [IO.Path]::ChangeExtension($target, ".com")
      $candidates += $com
      $dir = Split-Path $target -Parent
      $candidates += (Join-Path $dir "WinSCP.com")
    }
  }
  foreach ($c in $candidates) {
    if ($c -and (Test-Path $c)) { return (Resolve-Path $c).Path }
  }
  throw "WinSCP.com not found. Install WinSCP or pass -WinScpExe"
}

$WinScpCom = Resolve-WinScpCom -Hint $WinScpExe
Write-Host "==> WinSCP: $WinScpCom"
Write-Host "==> Target: ${UserName}@${HostName}"

if (-not $SkipBuild) {
  Write-Host "==> frontend npm run build"
  Push-Location (Join-Path $RepoRoot "frontend")
  try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "frontend build failed ($LASTEXITCODE)" }
  } finally {
    Pop-Location
  }
} else {
  Write-Host "==> skip frontend build"
}

$ScriptPath = Join-Path $env:TEMP ("winscp-count168-{0}.txt" -f ([guid]::NewGuid().ToString("n")))
$KeyUnix = $PrivateKey -replace "\\", "/"
$RepoUnix = ($RepoRoot.Path -replace "\\", "/")

# WinSCP: synchronize remote = push local → remote
$lines = @(
  "option batch abort",
  "option confirm off",
  "option transfer binary",
  "open sftp://${UserName}@${HostName}/ -privatekey=`"${KeyUnix}`" -hostkey=`"${HostKey}`"",
  "cd /var/www/count168",
  "lcd `"${RepoUnix}`"",
  "call mkdir -p /var/www/count168/services/tx-realtime /var/www/count168/deploy /var/www/count168/api /var/www/count168/frontend/dist",
  "synchronize remote -mirror -criteria=time,size `"${RepoUnix}/frontend/dist`" /var/www/count168/frontend/dist",
  "synchronize remote -mirror -criteria=time,size -filemask=`"|node_modules/;.env`" `"${RepoUnix}/services/tx-realtime`" /var/www/count168/services/tx-realtime",
  "synchronize remote -mirror -criteria=time,size `"${RepoUnix}/deploy`" /var/www/count168/deploy",
  "synchronize remote -mirror -criteria=time,size `"${RepoUnix}/api`" /var/www/count168/api"
)

# Windows checkout often has CRLF; syncing deploy/*.sh as-is breaks `set -o pipefail` on EC2
# and poisons GitHub Actions (which runs deploy/deploy.sh before git reset can repair it).
$lines += @(
  "call bash -lc `"sed -i 's/\r$//' /var/www/count168/deploy/*.sh /var/www/count168/deploy/systemd/*.service; chmod +x /var/www/count168/deploy/*.sh`""
)

if (-not $SkipRealtime) {
  $lines += @(
    "call bash -lc `"bash /var/www/count168/deploy/deploy-realtime.sh`""
  )
}

$lines += @(
  "call bash -lc `"curl -sS --max-time 3 http://127.0.0.1:3911/health || true`"",
  "exit"
)

Set-Content -Path $ScriptPath -Value ($lines -join "`r`n") -Encoding ASCII
Write-Host "==> WinSCP script: $ScriptPath"

try {
  & $WinScpCom /ini=nul /log="$env:TEMP\winscp-count168.log" /script="$ScriptPath"
  if ($LASTEXITCODE -ne 0) {
    throw "WinSCP failed with exit code $LASTEXITCODE (see $env:TEMP\winscp-count168.log)"
  }
} finally {
  Remove-Item -Force $ScriptPath -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "==> Deploy finished."
Write-Host "    Site: https://count168.site/transaction/..."
Write-Host "    Health (on EC2): curl http://127.0.0.1:3911/health"
Write-Host "    Log: $env:TEMP\winscp-count168.log"
