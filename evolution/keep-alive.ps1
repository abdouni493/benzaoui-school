# =============================================================================
# Verifie - et applique - les reglages Windows qui font tenir la passerelle
# WhatsApp 24 h/24 sur le poste de l'ecole.
#
# L'hebergement gratuit repose entierement sur ce PC : s'il s'endort, s'il
# redemarre sans relancer Docker, ou s'il coupe son reseau la nuit, plus aucun
# message ne part - et personne n'est prevenu.
#
#   powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1
#       -> RAPPORT seul, ne modifie rien.
#
#   powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1 -Apply
#       -> applique les corrections (demande les droits administrateur pour
#          les reglages d'alimentation).
#
# A relancer apres chaque grosse mise a jour de Windows : elles remettent
# volontiers la mise en veille par defaut.
# =============================================================================

param(
  [switch]$Apply
)

$ErrorActionPreference = "Continue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$issues = 0
$fixed = 0

function Write-Pass([string]$m) { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Bad([string]$m)  { $script:issues++; Write-Host "  [KO]   $m" -ForegroundColor Red }
function Write-Fix([string]$m)  { $script:fixed++;  Write-Host "  [FIX]  $m" -ForegroundColor Cyan }
function Write-Info([string]$m) { Write-Host "         $m" -ForegroundColor DarkGray }

$isAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

Write-Host ""
if ($Apply) { Write-Host "Mode APPLIQUER" -ForegroundColor Yellow }
else { Write-Host "Mode RAPPORT (rien ne sera modifie - ajouter -Apply pour corriger)" -ForegroundColor Yellow }
Write-Host ""

# ---------------------------------------------------------------------------
# 1. Mise en veille
# ---------------------------------------------------------------------------
# Une mise en veille suspend les conteneurs Docker : la session WhatsApp tombe
# et le tunnel se ferme. C'est LA cause numero un d'un service qui "marche la
# journee et plus le soir".

# Lit l'index secteur d'un reglage. On repere les valeurs par leur POSITION
# (avant-derniere = secteur, derniere = batterie) et non par le libelle, qui
# est traduit selon la langue de Windows.
function Get-PowerAcIndex([string]$sub, [string]$setting) {
  $out = powercfg /q SCHEME_CURRENT $sub $setting 2>$null
  if (-not $out) { return $null }
  $hits = [regex]::Matches(($out -join "`n"), "0x[0-9a-fA-F]{8}")
  if ($hits.Count -lt 2) { return $null }
  return [Convert]::ToInt64($hits[$hits.Count - 2].Value, 16)
}

$SUB_SLEEP     = "238c9fa8-0aad-41ed-83f4-97be242c8f20"
$STANDBYIDLE   = "29f6c1db-86da-48c5-9fdb-f2b67b1f44da"
$HIBERNATEIDLE = "9d7815a6-7ee4-497e-8888-515a05f02364"

# Volontairement limite a la veille et a la veille prolongee : ce sont les deux
# seuls reglages qui SUSPENDENT les conteneurs. L'arret des disques inactifs,
# lui, ne coupe rien (le disque se reveille au premier acces) - le signaler
# ferait courir apres un faux probleme, et apprendrait a ignorer le rapport.
$checks = @(
  @{ Name = "mise en veille";   Sub = $SUB_SLEEP; Setting = $STANDBYIDLE;   Flag = "standby-timeout-ac" },
  @{ Name = "veille prolongee"; Sub = $SUB_SLEEP; Setting = $HIBERNATEIDLE; Flag = "hibernate-timeout-ac" }
)

Write-Host "1. Alimentation (sur secteur)"
foreach ($c in $checks) {
  $value = Get-PowerAcIndex $c.Sub $c.Setting
  if ($null -eq $value) {
    Write-Info ("$($c.Name) : valeur illisible, a verifier a la main")
    continue
  }
  if ($value -eq 0) {
    Write-Pass "$($c.Name) : jamais"
    continue
  }

  $minutes = [math]::Round($value / 60, 1)
  if (-not $Apply) {
    Write-Bad "$($c.Name) : apres $minutes min - le service s'arretera"
    continue
  }
  if (-not $isAdmin) {
    Write-Bad "$($c.Name) : apres $minutes min - droits administrateur requis pour corriger"
    Write-Info "Relancer PowerShell avec 'Executer en tant qu'administrateur'."
    continue
  }

  powercfg /change $c.Flag 0 2>&1 | Out-Null
  if ((Get-PowerAcIndex $c.Sub $c.Setting) -eq 0) { Write-Fix "$($c.Name) : passe a 'jamais'" }
  else { Write-Bad "$($c.Name) : la correction n'a pas pris" }
}

# ---------------------------------------------------------------------------
# 2. Demarrage automatique de Docker Desktop
# ---------------------------------------------------------------------------
# Apres une coupure de courant, Windows redemarre mais Docker Desktop ne se
# lance pas de lui-meme : les conteneurs restent a l'arret malgre leur
# politique 'unless-stopped', qui ne s'applique qu'une fois le moteur demarre.

Write-Host "2. Demarrage automatique de Docker Desktop"
$dockerCandidates = @(
  (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\Docker Desktop.exe"),
  (Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe")
)
$dockerExe = $dockerCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $dockerExe) {
  Write-Bad "Docker Desktop introuvable"
  Write-Info "Cherche dans : $($dockerCandidates -join ' ; ')"
} else {
  $startup = [Environment]::GetFolderPath("Startup")
  $lnk = Join-Path $startup "Docker Desktop.lnk"
  if (Test-Path $lnk) {
    Write-Pass "raccourci de demarrage present"
  } elseif (-not $Apply) {
    Write-Bad "aucun raccourci de demarrage : Docker ne repartira pas apres un redemarrage"
  } else {
    try {
      $shell = New-Object -ComObject WScript.Shell
      $s = $shell.CreateShortcut($lnk)
      $s.TargetPath = $dockerExe
      $s.WorkingDirectory = Split-Path -Parent $dockerExe
      $s.Description = "Passerelle WhatsApp - demarrage automatique"
      $s.Save()
      Write-Fix "raccourci cree dans $startup"
    } catch {
      Write-Bad "creation du raccourci impossible : $($_.Exception.Message)"
    }
  }
}

# ---------------------------------------------------------------------------
# 3. Conteneurs : politique de redemarrage
# ---------------------------------------------------------------------------
Write-Host "3. Conteneurs de la passerelle"
$dockerCli = @(
  (Join-Path $env:LOCALAPPDATA "Programs\DockerDesktop\resources\bin\docker.exe"),
  (Join-Path $env:ProgramFiles "Docker\Docker\resources\bin\docker.exe"),
  "docker"
) | Where-Object { ($_ -eq "docker") -or (Test-Path $_) } | Select-Object -First 1

$names = @("evolution-funnel", "evolution-funnel-postgres", "evolution-tailscale")
$seen = $false
foreach ($n in $names) {
  $policy = & $dockerCli inspect -f "{{.HostConfig.RestartPolicy.Name}}" $n 2>$null
  $running = & $dockerCli inspect -f "{{.State.Running}}" $n 2>$null
  if (-not $policy) { continue }
  $seen = $true
  if ($running -eq "true" -and ($policy -eq "unless-stopped" -or $policy -eq "always")) {
    Write-Pass "$n : demarre, politique '$policy'"
  } elseif ($running -ne "true") {
    Write-Bad "$n : a l'arret"
    Write-Info "docker compose -f evolution/docker-compose.funnel.yml up -d"
  } else {
    Write-Bad "$n : politique '$policy' - ne repartira pas tout seul"
  }
}
if (-not $seen) {
  Write-Bad "aucun conteneur de la passerelle trouve"
  Write-Info "Demarrer : docker compose -f evolution/docker-compose.funnel.yml up -d"
}

# ---------------------------------------------------------------------------
# 4. A verifier a la main
# ---------------------------------------------------------------------------
# Deux reglages que ce script ne touche pas volontairement : l'un exige un mot
# de passe en clair dans le registre, l'autre depend du rythme de l'ecole.

Write-Host "4. A regler a la main (non modifie par ce script)"
Write-Info "Ouverture de session automatique : sans elle, apres une coupure de"
Write-Info "courant Windows redemarre sur l'ecran de connexion et Docker Desktop"
Write-Info "n'ouvre jamais. A activer via netplwiz, sur un compte dedie et si la"
Write-Info "securite physique du poste le permet - le mot de passe est stocke."
Write-Info ""
Write-Info "Windows Update : Parametres > Windows Update > Heures d'activite,"
Write-Info "pour que les redemarrages automatiques tombent hors des heures de"
Write-Info "cours plutot qu'en plein envoi."

# ---------------------------------------------------------------------------
Write-Host ""
if ($issues -eq 0) {
  if ($fixed -gt 0) { Write-Host "$fixed correction(s) appliquee(s). Le poste est pret pour un service continu." -ForegroundColor Green }
  else { Write-Host "Tout est conforme : le poste peut tenir le service en continu." -ForegroundColor Green }
  exit 0
}
if (-not $Apply) {
  Write-Host "$issues point(s) a corriger. Relancer avec -Apply, en administrateur." -ForegroundColor Yellow
} else {
  Write-Host "$issues point(s) non resolu(s), $fixed corrige(s)." -ForegroundColor Red
}
exit 1
