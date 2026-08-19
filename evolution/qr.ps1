# Affiche un QR code frais pour lier le telephone de l'ecole a la passerelle.
#
#   powershell -ExecutionPolicy Bypass -File evolution\qr.ps1
#
# Le QR expire en ~40 secondes : relancer autant de fois que necessaire.
# Une fois connecte, le script le dit et n'affiche plus de QR.

$ErrorActionPreference = "Stop"

# Lit la cle et le nom d'instance depuis evolution/.env et .env.local
$root = Split-Path -Parent $PSScriptRoot
$key = (Select-String -Path (Join-Path $PSScriptRoot ".env") -Pattern '^EVOLUTION_API_KEY=(.+)$').Matches.Groups[1].Value.Trim()
$instance = "benzaoui"
$envLocal = Join-Path $root ".env.local"
if (Test-Path $envLocal) {
  $m = Select-String -Path $envLocal -Pattern '^EVOLUTION_INSTANCE=(.+)$'
  if ($m) { $instance = $m.Matches.Groups[1].Value.Trim() }
}
$base = "http://localhost:8081"
$headers = @{ apikey = $key }

# Deja connecte ? Inutile d'afficher un QR (et le rescanner delierait la session).
$state = $null
try {
  $s = Invoke-RestMethod -Uri "$base/instance/connectionState/$instance" -Headers $headers -TimeoutSec 10
  $state = $s.instance.state
} catch { }

if ($state -eq "open") {
  Write-Host "Deja connectee. Rien a scanner." -ForegroundColor Green
  try {
    $info = Invoke-RestMethod -Uri "$base/instance/fetchInstances?instanceName=$instance" -Headers $headers -TimeoutSec 10
    $one = if ($info -is [array]) { $info[0] } else { $info }
    $owner = $one.ownerJid; if (-not $owner) { $owner = $one.owner }
    if ($owner) { Write-Host ("Numero lie : " + ($owner -split "@")[0]) }
  } catch { }
  exit 0
}

Write-Host "Etat actuel : $state - demande d'un nouveau QR..."
$res = Invoke-RestMethod -Uri "$base/instance/connect/$instance" -Headers $headers -TimeoutSec 30

$b64 = $res.base64
if (-not $b64 -and $res.qrcode) { $b64 = $res.qrcode.base64 }
if (-not $b64) {
  Write-Host "Aucun QR renvoye. Etat : $($res.instance.state)" -ForegroundColor Yellow
  exit 1
}
if ($b64 -notlike "data:image*") { $b64 = "data:image/png;base64," + $b64 }
if ($res.pairingCode) { Write-Host ("Code d'appairage : " + $res.pairingCode) -ForegroundColor Cyan }

$out = Join-Path $env:TEMP "qr-$instance.html"
$html = "<html><head><meta charset='utf-8'><title>QR WhatsApp</title></head>" +
        "<body style='font-family:sans-serif;text-align:center;padding:24px;background:#fff'>" +
        "<h2>Scanner avec le telephone de l'ecole</h2>" +
        "<ol style='display:inline-block;text-align:left;font-size:15px;line-height:1.7'>" +
        "<li>WhatsApp sur le telephone de l'ecole</li>" +
        "<li>Menu &#8942; (ou Reglages) &rarr; <b>Appareils connectes</b></li>" +
        "<li><b>Connecter un appareil</b></li><li>Scanner le code ci-dessous</li></ol><br>" +
        "<img src='$b64' style='width:340px;height:340px'>" +
        "<p style='color:#888;font-size:13px'>Expire en ~40 s. Relancer evolution\qr.ps1 pour un code neuf.</p>" +
        "</body></html>"
Set-Content -Path $out -Value $html -Encoding utf8
Invoke-Item $out
Write-Host "QR ouvert dans le navigateur. Scannez maintenant." -ForegroundColor Green
