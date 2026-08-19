# =============================================================================
# Verifie la chaine complete entre l'application (Vercel) et la passerelle
# WhatsApp hebergee, DEPUIS le poste de l'ecole.
#
#   powershell -ExecutionPolicy Bypass -File evolution\check-gateway.ps1 -BaseUrl https://wa-benzaoui.up.railway.app -ApiKey VOTRE_CLE -AppUrl https://benzaoui-school.vercel.app
#
# Sans parametres, le script relit .env.local (utile pour le montage local).
# Il ne MODIFIE rien : il ne fait que lire et rapporter.
#
# A lancer chaque fois que "Parametres > WhatsApp" affiche une erreur, et une
# fois apres chaque changement de domaine (Railway, tunnel, ou Vercel).
# =============================================================================

param(
  [string]$BaseUrl,
  [string]$ApiKey,
  [string]$Instance,
  [string]$AppUrl
)

$ErrorActionPreference = "Stop"
# PowerShell 5.1 negocie encore TLS 1.0 par defaut : les hebergeurs modernes
# refusent, et l'erreur ressemble alors a tort a une passerelle injoignable.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$root = Split-Path -Parent $PSScriptRoot
$failures = 0
$warnings = 0

function Read-EnvValue([string]$file, [string]$key) {
  if (-not (Test-Path $file)) { return $null }
  $m = Select-String -Path $file -Pattern ("^\s*" + [regex]::Escape($key) + "=(.*)$")
  if (-not $m) { return $null }
  return $m.Matches[0].Groups[1].Value.Trim()
}

# Les parametres explicites l'emportent ; .env.local ne sert que de repli.
$envLocal = Join-Path $root ".env.local"
if (-not $BaseUrl)  { $BaseUrl  = Read-EnvValue $envLocal "EVOLUTION_BASE_URL" }
if (-not $ApiKey)   { $ApiKey   = Read-EnvValue $envLocal "EVOLUTION_API_KEY" }
if (-not $Instance) { $Instance = Read-EnvValue $envLocal "EVOLUTION_INSTANCE" }
if (-not $Instance) { $Instance = "benzaoui" }
if (-not $AppUrl)   { $AppUrl   = Read-EnvValue $envLocal "NEXT_PUBLIC_SITE_URL" }

if (-not $BaseUrl -or -not $ApiKey) {
  Write-Host "Il manque -BaseUrl et/ou -ApiKey (et .env.local ne les contient pas)." -ForegroundColor Red
  Write-Host "Ces valeurs sont celles configurees dans Vercel : EVOLUTION_BASE_URL et EVOLUTION_API_KEY."
  exit 2
}

$BaseUrl = $BaseUrl.TrimEnd("/")
if ($AppUrl) { $AppUrl = $AppUrl.TrimEnd("/") }
$headers = @{ apikey = $ApiKey }

function Write-Pass([string]$m) { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Fail([string]$m) { $script:failures++; Write-Host "  [KO]   $m" -ForegroundColor Red }
function Write-Warn([string]$m) { $script:warnings++; Write-Host "  [!]    $m" -ForegroundColor Yellow }
function Write-Hint([string]$m) { Write-Host "         -> $m" -ForegroundColor DarkGray }

function Get-HttpStatus($err) {
  if ($err.Exception.Response) { return [int]$err.Exception.Response.StatusCode }
  return 0
}

Write-Host ""
Write-Host "Passerelle : $BaseUrl" -ForegroundColor Cyan
Write-Host "Instance   : $Instance" -ForegroundColor Cyan
if ($AppUrl) { Write-Host "Application: $AppUrl" -ForegroundColor Cyan }
Write-Host ""

# --- 1. La passerelle repond-elle ? ------------------------------------------
# Deux tentatives, largement minutees : un conteneur qui vient de demarrer, ou
# un tunnel qui se reconnecte, peut laisser passer le premier appel dans le
# vide. Conclure trop vite a une panne enverrait l'ecole chercher un probleme
# qui n'existe pas.
Write-Host "1. Joignabilite de la passerelle"
$rootRes = $null
$lastError = $null
foreach ($attempt in 1..2) {
  try {
    $rootRes = Invoke-RestMethod -Uri "$BaseUrl/" -TimeoutSec 30
    break
  } catch {
    $lastError = $_
    if ($attempt -eq 1) { Write-Hint "premiere tentative sans reponse, nouvel essai..." }
  }
}

if ($rootRes) {
  if ($rootRes.version) { Write-Pass "repond, Evolution API version $($rootRes.version)" }
  else { Write-Pass "repond" }
} else {
  Write-Fail "aucune reponse : $($lastError.Exception.Message)"
  Write-Hint "Railway : le service est-il deploye et non endormi (sleepApplication) ?"
  Write-Hint "Tunnel  : le conteneur cloudflared tourne-t-il, et le PC est-il allume ?"
  Write-Hint "Verifier aussi que EVOLUTION_BASE_URL n'a pas de slash final."
  Write-Host ""
  Write-Host "Chaine interrompue des la premiere etape : rien d'autre ne peut etre teste." -ForegroundColor Red
  exit 1
}

if ($BaseUrl -like "http://*") {
  Write-Warn "l'URL est en http:// et non https://"
  Write-Hint "En production l'application refuse un webhook non-HTTPS. Acceptable en local uniquement."
}

# --- 2. La cle API est-elle acceptee ? ---------------------------------------
Write-Host "2. Cle API"
$apiPrefix = ""
try {
  Invoke-RestMethod -Uri "$BaseUrl/instance/fetchInstances" -Headers $headers -TimeoutSec 20 | Out-Null
  Write-Pass "acceptee"
} catch {
  $code = Get-HttpStatus $_
  if ($code -eq 404) {
    # Certaines installations servent l'API sous /api : on le detecte au lieu
    # de conclure a tort que la cle est mauvaise.
    try {
      Invoke-RestMethod -Uri "$BaseUrl/api/instance/fetchInstances" -Headers $headers -TimeoutSec 20 | Out-Null
      $apiPrefix = "/api"
      Write-Warn "l'API repond sous /api, pas a la racine"
      Write-Hint "Mettre EVOLUTION_BASE_URL=$BaseUrl/api dans Vercel, puis redeployer."
    } catch {
      Write-Fail "404 a la racine ET sous /api"
    }
  } elseif ($code -eq 401 -or $code -eq 403) {
    Write-Fail "refusee (HTTP $code)"
    Write-Hint "EVOLUTION_API_KEY (Vercel) doit etre IDENTIQUE a AUTHENTICATION_API_KEY (passerelle)."
    Write-Hint "Apres correction dans Vercel : redeployer, sinon l'ancienne valeur reste active."
  } else {
    Write-Fail "erreur inattendue : $($_.Exception.Message)"
  }
}
$api = "$BaseUrl$apiPrefix"

# --- 3. L'instance existe-t-elle, et est-elle connectee ? --------------------
Write-Host "3. Session WhatsApp"
$state = $null
try {
  $s = Invoke-RestMethod -Uri "$api/instance/connectionState/$Instance" -Headers $headers -TimeoutSec 20
  $state = $s.instance.state
  if (-not $state) { $state = $s.state }
} catch {
  if ((Get-HttpStatus $_) -eq 404) {
    Write-Fail "instance '$Instance' inexistante sur la passerelle"
    Write-Hint "Application > Parametres > WhatsApp > Initialiser l'instance."
  } else {
    Write-Fail "etat illisible : $($_.Exception.Message)"
  }
}

if ($state -eq "open") {
  Write-Pass "connectee"
  try {
    $info = Invoke-RestMethod -Uri "$api/instance/fetchInstances?instanceName=$Instance" -Headers $headers -TimeoutSec 20
    $one = $info; if ($info -is [array]) { $one = $info[0] }
    $node = $one; if ($one.instance) { $node = $one.instance }
    $owner = $node.ownerJid; if (-not $owner) { $owner = $node.owner }
    if ($owner) { Write-Hint ("numero lie : " + ($owner -split "@")[0]) }
  } catch { }
} elseif ($state) {
  Write-Fail "etat '$state' : aucun message ne partira"
  Write-Hint "Parametres > WhatsApp > Connecter WhatsApp, puis scanner le QR avec le telephone de l'ecole."
}

# --- 4. Le webhook est-il enregistre, et vers la bonne adresse ? -------------
Write-Host "4. Webhook declare sur la passerelle"
$hookUrl = $null
try {
  $w = Invoke-RestMethod -Uri "$api/webhook/find/$Instance" -Headers $headers -TimeoutSec 20
  $hookUrl = $w.url
  if (-not $hookUrl -and $w.webhook) { $hookUrl = $w.webhook.url }
} catch { }

if (-not $hookUrl) {
  Write-Fail "aucun webhook enregistre"
  Write-Hint "Sans lui, les statuts restent bloques sur 'En attente'. Cliquer sur Initialiser l'instance."
} else {
  Write-Pass "declare vers $hookUrl"
  if ($hookUrl -notlike "*/api/whatsapp/webhook") {
    Write-Warn "l'adresse ne finit pas par /api/whatsapp/webhook"
  }
  if ($hookUrl -like "*localhost*" -or $hookUrl -like "*host.docker.internal*") {
    # Sur le montage local (passerelle en Docker, application en npm run dev),
    # c'est l'adresse ATTENDUE : ne pas crier au probleme. Depuis une passerelle
    # hebergee, en revanche, elle est injoignable et rien ne remontera.
    if ($BaseUrl -like "*localhost*" -or $BaseUrl -like "*127.0.0.1*") {
      Write-Hint "adresse locale, normale pour le montage de developpement."
    } else {
      Write-Fail "l'adresse designe une machine locale, injoignable depuis un hebergeur"
      Write-Hint "Supprimer EVOLUTION_WEBHOOK_URL des variables Vercel, redeployer, puis re-Initialiser."
    }
  }
  if ($AppUrl) {
    try {
      $expectedHost = ([Uri]$AppUrl).Host
      $gotHost = ([Uri]$hookUrl).Host
      if ($gotHost -ne $expectedHost) {
        Write-Warn "le webhook pointe vers $gotHost alors que l'application est sur $expectedHost"
        Write-Hint "Apres un changement de domaine Vercel : re-cliquer sur Initialiser l'instance."
      }
    } catch { }
  }
}

# --- 5. L'application est-elle joignable, et refuse-t-elle les faux appels ? --
Write-Host "5. Endpoint webhook de l'application"
if ($AppUrl) {
  # On POSTe SANS jeton : une 401 est le resultat ATTENDU. Elle prouve a la
  # fois que Vercel sert bien la route et qu'elle est protegee.
  try {
    Invoke-RestMethod -Uri "$AppUrl/api/whatsapp/webhook" -Method Post -Body "{}" -ContentType "application/json" -TimeoutSec 20 | Out-Null
    Write-Fail "un appel SANS jeton a ete accepte"
    Write-Hint "EVOLUTION_WEBHOOK_TOKEN est probablement absent cote Vercel : n'importe qui pourrait falsifier des statuts."
  } catch {
    $code = Get-HttpStatus $_
    if ($code -eq 401) {
      # Piege classique : la "Deployment Protection" de Vercel repond 401 elle
      # aussi, AVANT que la requete atteigne l'application. Vu de loin les deux
      # 401 sont identiques ; on les distingue au type de contenu, car notre
      # route renvoie du texte brut la ou Vercel renvoie une page HTML.
      $ctype = ""
      if ($_.Exception.Response) { $ctype = [string]$_.Exception.Response.ContentType }
      if ($ctype -like "*text/html*") {
        Write-Fail "401 emis par la protection de deploiement Vercel, pas par l'application"
        Write-Hint "Vercel > Settings > Deployment Protection : la desactiver pour la Production."
        Write-Hint "Tant qu'elle est active, la passerelle ne peut livrer aucun statut de remise."
      } else {
        Write-Pass "joignable et protege (401 sans jeton, comportement attendu)"
      }
    }
    elseif ($code -eq 404) {
      Write-Fail "route absente (404)"
      Write-Hint "Le deploiement Vercel est-il a jour ? -AppUrl designe-t-il bien l'application ?"
    }
    elseif ($code -eq 0) { Write-Fail "application injoignable : $($_.Exception.Message)" }
    else { Write-Warn "reponse inattendue (HTTP $code)" }
  }
} else {
  Write-Warn "non teste : relancer avec -AppUrl https://votre-app.vercel.app"
}

# --- Verdict -----------------------------------------------------------------
Write-Host ""
if ($failures -eq 0 -and $warnings -eq 0) {
  Write-Host "Tout est en ordre : l'ecole peut envoyer des messages." -ForegroundColor Green
  exit 0
}
if ($failures -eq 0) {
  Write-Host "$warnings avertissement(s), aucun blocage." -ForegroundColor Yellow
  exit 0
}
Write-Host "$failures probleme(s) bloquant(s), $warnings avertissement(s)." -ForegroundColor Red
exit 1
