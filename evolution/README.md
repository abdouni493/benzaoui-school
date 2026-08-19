# Passerelle WhatsApp — Evolution API

Ce dossier contient tout ce qui fait tourner la passerelle WhatsApp de l'école.
Elle est **séparée de l'application** : Vercel est serverless — chaque requête réveille une fonction
qui s'éteint aussitôt — alors qu'une session WhatsApp Web doit rester **ouverte en permanence**.
Aucun réglage Vercel ne peut changer cela. La passerelle vit donc ailleurs, et l'application la
pilote par HTTPS.

```
Vercel (application)  ──HTTPS──►  passerelle Evolution  ──►  WhatsApp des familles
Vercel (webhook)      ◄──HTTPS──  passerelle Evolution  ◄──  statuts, réponses
```

**« Ailleurs » ne veut pas dire « VPS ».** Deux des trois options ci-dessous ne demandent aucun
serveur à administrer.

| Fichier | Rôle |
| --- | --- |
| `docker-compose.local.yml` | Essai sur le PC de l'école, sans rien exposer — pour valider la chaîne |
| `railway/` | **Hébergement géré, sans VPS** (recommandé) : image, `railway.json`, variables |
| `docker-compose.tunnel.yml` | **PC de l'école + tunnel Cloudflare, sans VPS ni frais** |
| `docker-compose.yml` | VPS classique : passerelle + Postgres + Redis + Caddy (HTTPS) |
| `Caddyfile` | Reverse proxy et certificat Let's Encrypt, pour l'option VPS |
| `check-gateway.ps1` | **Diagnostic** : vérifie toute la chaîne Vercel ↔ passerelle depuis Windows |
| `qr.ps1` | Affiche un QR de connexion depuis Windows, sans passer par l'application |
| `.env` | Secrets — **jamais commité** (couvert par `.gitignore`) |

---

## Choisir l'hébergement

|  | **B. Railway** (recommandé) | **C. Tunnel Cloudflare** | **D. VPS** |
| --- | --- | --- | --- |
| Serveur à administrer | aucun | aucun | oui (Ubuntu, SSH, mises à jour) |
| Coût mensuel | ≈ 5 $ | **0 €** | ≈ 4 € |
| Fonctionne PC éteint | **oui** | non | oui |
| Il faut | une carte bancaire internationale | un domaine sur Cloudflare + un PC allumé | une carte + gérer un serveur |
| HTTPS | fourni | fourni | Caddy (automatique) |
| Mise en service | ~20 min | ~30 min | ~45 min |

**Le vrai critère** : si le secrétariat éteint son poste le soir, l'option C n'enverra plus rien
la nuit ni le week-end — sans prévenir personne. Si les alertes doivent partir à toute heure,
prendre l'option B.

Dans les trois cas, l'application est identique : seule change la valeur de `EVOLUTION_BASE_URL`.

---

## A. Essai local (gratuit, ~20 min)

À faire **avant** tout hébergement : cela valide toute la chaîne sans rien dépenser et sans exposer
quoi que ce soit sur Internet.

```powershell
docker compose -f evolution/docker-compose.local.yml up -d
docker compose -f evolution/docker-compose.local.yml logs -f evolution
```

Vérifier que l'API répond, et **noter lequel des deux chemins fonctionne** :

```powershell
curl.exe -s -H "apikey: VOTRE_CLE" http://localhost:8081/instance/fetchInstances
# si 404, essayer :
curl.exe -s -H "apikey: VOTRE_CLE" http://localhost:8081/api/instance/fetchInstances
```

Celui qui répond `[]` donne votre `EVOLUTION_BASE_URL`.

Dans `.env.local` de l'application :

```
EVOLUTION_BASE_URL=http://localhost:8081
EVOLUTION_API_KEY=<la même valeur que dans evolution/.env>
EVOLUTION_INSTANCE=benzaoui
EVOLUTION_WEBHOOK_TOKEN=<une autre chaîne aléatoire>
EVOLUTION_WEBHOOK_URL=http://host.docker.internal:3000/api/whatsapp/webhook
```

> `host.docker.internal` désigne le PC vu depuis le conteneur. C'est ce qui permet à la passerelle
> de rappeler `npm run dev` **sans tunnel ni domaine**.

Puis dans l'application : **Paramètres → WhatsApp → Initialiser → Connecter →** scanner le QR.

**Limite de ce mode** : rien n'est joignable depuis Vercel. C'est un banc d'essai, pas une mise en
production.

---

## B. Railway — hébergement géré, sans VPS *(recommandé)*

Railway exécute des conteneurs sans serveur à administrer : ni SSH, ni Ubuntu, ni certificat, ni
mise à jour système. On y déploie **exactement la même image** qu'en local, et l'on obtient une
adresse HTTPS publique et stable.

**Prévoir** : une carte bancaire internationale (Visa/Mastercard). Le plan Hobby coûte 5 $/mois et
inclut 5 $ de consommation ; la passerelle + Postgres consomment à peu près ce montant, donc
compter **5 à 8 $/mois** selon le trafic. Sans carte utilisable, passer à l'option C.

### 1. Créer le projet et sa base

1. Créer un compte sur [railway.com](https://railway.com) (connexion par GitHub), puis activer le
   plan **Hobby**.
2. **New Project → Deploy PostgreSQL**. Railway crée un service `Postgres` ; ne rien y toucher, ses
   identifiants seront injectés automatiquement.

### 2. Ajouter le service de la passerelle

Deux façons — la première est la plus simple, la seconde garde la version épinglée dans ce dépôt.

**Depuis l'image Docker (le plus simple)**
> **+ New → Docker Image**, saisir : `evoapicloud/evolution-api:v2.3.7`

**Depuis ce dépôt (versions suivies dans Git)**
> **+ New → GitHub Repo →** `abdouni493/benzaoui-school`, puis **Settings → Root Directory** =
> `evolution/railway`.
> Railway construit alors [`railway/Dockerfile`](railway/Dockerfile). Le fichier
> [`railway/railway.json`](railway/railway.json) limite les redéploiements aux modifications de ce
> dossier (`watchPatterns`) : pousser du code applicatif ne coupera pas la passerelle.

### 3. Attacher un volume — **l'étape à ne pas sauter**

**Service passerelle → Settings → Volumes → New Volume**, chemin de montage :

```
/evolution/instances
```

C'est là que vit la session WhatsApp. **Sans volume, chaque redéploiement délie le téléphone** et
il faut retourner scanner un QR code au secrétariat.

### 4. Générer le domaine public

**Settings → Networking → Public Networking → Generate Domain.** Railway renvoie une adresse du type
`benzaoui-wa-production.up.railway.app`. La noter : c'est le `EVOLUTION_BASE_URL` de Vercel.

### 5. Renseigner les variables

**Variables → Raw Editor**, coller le contenu de [`railway/env.example`](railway/env.example), puis
remplacer deux valeurs :

- `SERVER_URL` → `https://` + le domaine de l'étape 4, **sans slash final** ;
- `AUTHENTICATION_API_KEY` → une chaîne aléatoire, générée sous PowerShell :

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

Laisser `${{Postgres.DATABASE_URL}}` tel quel : Railway le remplace tout seul.

> `SERVER_URL` doit correspondre **au caractère près** au domaine servi. C'est la valeur que la
> passerelle inscrit dans le champ `server_url` de chaque webhook, et que `/api/whatsapp/webhook`
> compare à `EVOLUTION_BASE_URL` : la moindre différence fait rejeter tous les statuts en 403.

### 6. Interdire la mise en veille

**Settings → Deploy →** vérifier que **Serverless / App Sleeping** est **désactivé**. Une passerelle
endormie perd sa session WhatsApp : au réveil, plus rien ne part tant que personne n'a rescanné.
(Le service déployé depuis le dépôt hérite déjà de `sleepApplication: false`.)

### 7. Vérifier avant d'aller plus loin

```powershell
curl.exe -s https://VOTRE-DOMAINE.up.railway.app/
```

Doit répondre un JSON avec la version. Sinon, consulter **Deployments → Logs** dans Railway.

### 8. Configurer Vercel, puis connecter le téléphone

Suivre [« Variables Vercel »](#variables-vercel-communes-à-b-c-et-d) puis
[« Première connexion »](#première-connexion) ci-dessous.

---

## C. PC de l'école + tunnel Cloudflare — sans VPS et sans frais

La passerelle reste sur le poste du secrétariat, mais un **tunnel Cloudflare** lui donne une adresse
HTTPS publique et stable. Aucun port n'est ouvert sur la box de l'école : c'est le conteneur
`cloudflared` qui ouvre la connexion **vers l'extérieur**. Cela fonctionne donc derrière une IP
dynamique, un routeur d'opérateur, et même un partage de connexion 4G.

> **La contrepartie, à assumer clairement** : PC éteint, en veille, ou sans Internet = **aucun
> message ne part**. L'application affiche « Passerelle injoignable » dans Paramètres, mais personne
> n'est alerté automatiquement.

### 1. Mettre un domaine sur Cloudflare

Ajouter le domaine de l'école sur [cloudflare.com](https://cloudflare.com) (offre gratuite) et
pointer les serveurs de noms chez le registrar. Sans domaine, cette option n'est pas possible :
prendre l'option B.

### 2. Créer le tunnel

**Cloudflare Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared.** Le nommer
(`ecole-whatsapp`), puis **copier le jeton** affiché dans la commande d'installation — la longue
chaîne après `--token`.

### 3. Déclarer le nom public

Dans l'onglet **Public Hostname** du tunnel :

| Champ | Valeur |
| --- | --- |
| Subdomain | `wa` |
| Domain | `votre-domaine.dz` |
| Service Type | `HTTP` |
| URL | `evolution:8080` |

`evolution:8080` est le nom du conteneur sur le réseau Docker — c'est `cloudflared` qui le résout,
pas Internet.

### 4. Renseigner les secrets et démarrer

Dans `evolution/.env` (jamais commité) :

```
CLOUDFLARE_TUNNEL_TOKEN=<le jeton de l'étape 2>
TUNNEL_PUBLIC_URL=https://wa.votre-domaine.dz
EVOLUTION_API_KEY=<chaîne aléatoire de 64 caractères>
POSTGRES_PASSWORD=<autre chaîne aléatoire>
```

```powershell
docker compose -f evolution/docker-compose.tunnel.yml up -d
docker compose -f evolution/docker-compose.tunnel.yml logs -f cloudflared
```

Vérifier depuis n'importe quel réseau :

```powershell
curl.exe -s https://wa.votre-domaine.dz/
```

### 5. Empêcher le PC de s'endormir

C'est ce qui fait la différence entre un service qui tient et un service qui tombe une nuit sur deux :

```powershell
# Ne jamais mettre en veille ni éteindre l'écran quand le PC est sur secteur
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
```

Puis, dans **Docker Desktop → Settings → General**, cocher **Start Docker Desktop when you log in**.
Les conteneurs sont en `restart: unless-stopped` : ils repartiront seuls après une coupure de
courant, à condition que la session Windows s'ouvre automatiquement.

### 6. Configurer Vercel, puis connecter le téléphone

Suivre les deux sections ci-dessous.

---

## D. VPS (~4 €/mois)

L'option classique, conservée pour mémoire : elle demande d'administrer un serveur Linux.

### 1. Louer le serveur

2 vCPU, 2 Go de RAM, 20 Go SSD, Ubuntu 24.04. Hetzner CX22 convient largement. Le moteur Baileys
consomme ~150–300 Mo : inutile de surdimensionner.

### 2. Pointer un sous-domaine

Chez votre registrar, enregistrement **A** : `wa.votre-domaine.dz` → IP du VPS.
Attendre la propagation (`ping wa.votre-domaine.dz` doit renvoyer l'IP).

### 3. Installer et démarrer

```bash
ssh root@VOTRE_IP
curl -fsSL https://get.docker.com | sh

mkdir -p /opt/evolution && cd /opt/evolution
# y copier docker-compose.yml et Caddyfile de ce dossier

# Remplacer le domaine dans le Caddyfile
sed -i 's/wa.votre-domaine.dz/wa.VOTRE-VRAI-DOMAINE/' Caddyfile

# Générer les secrets
echo "SERVER_URL=https://wa.VOTRE-VRAI-DOMAINE"   >  .env
echo "EVOLUTION_API_KEY=$(openssl rand -hex 32)"  >> .env
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)"  >> .env
chmod 600 .env
cat .env        # noter la clé API : elle ira dans Vercel

docker compose up -d
docker compose logs -f evolution
```

### 4. Vérifier

```bash
curl -s https://wa.VOTRE-VRAI-DOMAINE/ -H "apikey: VOTRE_CLE"
```

Doit répondre un JSON avec la version, **en HTTPS sans avertissement de certificat**. Si Caddy n'a
pas obtenu son certificat, vérifier que les ports 80 et 443 sont ouverts et que le DNS est propagé
(`docker compose logs caddy`).

---

## Variables Vercel (communes à B, C et D)

**Vercel → Settings → Environment Variables**, en Production *et* Preview :

| Variable | Valeur |
| --- | --- |
| `EVOLUTION_BASE_URL` | l'adresse HTTPS de la passerelle, **sans slash final** |
| `EVOLUTION_API_KEY` | la clé de la passerelle (`AUTHENTICATION_API_KEY`), à l'identique |
| `EVOLUTION_INSTANCE` | `benzaoui` |
| `EVOLUTION_WEBHOOK_TOKEN` | une **nouvelle** valeur aléatoire, différente de la clé API |

> **Ne PAS définir `EVOLUTION_WEBHOOK_URL` sur Vercel.** Laissée vide, l'application dérive
> l'adresse de son propre domaine de production. Renseignée par erreur avec une valeur locale
> (`localhost`, `host.docker.internal`), elle demanderait à la passerelle de rappeler une machine
> qui n'existe pas pour elle : les messages partiraient, mais aucun statut ne reviendrait jamais.

Aucune de ces variables ne doit être préfixée `NEXT_PUBLIC_` : ce préfixe les publierait dans le
navigateur de chaque visiteur, clé de la passerelle comprise.

Puis **redéployer** : les variables ne sont lues qu'au déploiement, les enregistrer ne suffit pas.

---

## Première connexion

1. **Paramètres → WhatsApp → Initialiser l'instance** — crée la session sur la passerelle et y
   enregistre l'adresse du webhook. À refaire après tout changement de domaine (Railway, tunnel,
   ou Vercel).
2. **Connecter WhatsApp** — un QR code s'affiche.
3. Sur le téléphone de l'école : WhatsApp → ⋮ → **Appareils connectés** → **Connecter un appareil**
   → scanner. Le badge passe au vert et le numéro lié s'affiche.

Le QR expire en moins d'une minute ; **Nouveau QR code** en génère un autre.

L'instance de production est **distincte** de celle utilisée en local : il faut rescanner, même si
le téléphone était déjà lié à la passerelle locale.

---

## Vérifier toute la chaîne

Depuis le poste de l'école, sans rien modifier :

```powershell
powershell -ExecutionPolicy Bypass -File evolution\check-gateway.ps1 `
  -BaseUrl https://VOTRE-DOMAINE.up.railway.app `
  -ApiKey  VOTRE_CLE `
  -AppUrl  https://benzaoui-school.vercel.app
```

Le script contrôle, dans l'ordre : la passerelle répond, la clé API est acceptée, l'instance existe
et est connectée, le webhook est déclaré vers le bon domaine, et l'application Vercel répond bien
**401** à un appel sans jeton. Chaque échec est accompagné de la manœuvre correspondante.

Sans paramètres, il relit `.env.local` — pratique pour contrôler le montage local.

---

## Exploitation

### Commandes utiles

Sur le PC de l'école (options A et C) :

```powershell
docker compose -f evolution/docker-compose.tunnel.yml logs -f evolution   # journaux
docker compose -f evolution/docker-compose.tunnel.yml restart evolution   # redémarrer
docker compose -f evolution/docker-compose.tunnel.yml down                # arrêter
```

Sur Railway (option B) : **Deployments → Logs** pour les journaux, **Restart** pour redémarrer.

La session WhatsApp survit aux redémarrages : elle est stockée dans le volume `evolution_instances`
(ou le volume Railway monté sur `/evolution/instances`). Un `docker compose down -v`, ou la
suppression du volume Railway, la détruirait — il faudrait alors rescanner.

### Sauvegarde

Le volume contient les identifiants de session. Sans lui, il faut rescanner le QR code — ce n'est
pas dramatique, mais c'est un déplacement au secrétariat.

```bash
docker run --rm -v evolution_evolution_instances:/data -v $(pwd):/backup \
  alpine tar czf /backup/whatsapp-session.tar.gz -C /data .
```

### Protéger le numéro

C'est le point qui décide de la survie du service :

- n'écrire qu'aux **familles inscrites**, jamais à une liste importée ;
- ~50 messages/jour la première semaine, ~200/jour ensuite ;
- **ne jamais désactiver la temporisation** de `app/api/whatsapp/send/route.ts` ;
- surveiller les blocages : si des parents signalent les messages, arrêter et revoir le texte.

Un numéro banni par WhatsApp l'est **sans recours**. Utilisez un numéro dédié à l'école.

### Diagnostic

| Symptôme | Cause probable |
| --- | --- |
| « Passerelle WhatsApp injoignable » | Service arrêté ou endormi, PC éteint, ou `EVOLUTION_BASE_URL` erroné |
| « Clé API refusée » | `EVOLUTION_API_KEY` différent entre Vercel et la passerelle |
| « Instance introuvable » | Cliquer sur **Initialiser l'instance** dans Paramètres |
| « WhatsApp n'est pas connecté » | Session tombée : rescanner le QR code |
| Statuts bloqués sur `queued` | Le webhook n'arrive pas : jeton, URL, ou HTTPS non joignable |
| Session perdue à chaque déploiement | Volume absent sur `/evolution/instances` (Railway, étape 3) |
| 403 en boucle dans les journaux | `SERVER_URL` de la passerelle ≠ `EVOLUTION_BASE_URL` de Vercel |
| 401 en boucle dans les journaux | `EVOLUTION_WEBHOOK_TOKEN` différent entre Vercel et l'instance — recliquer sur **Initialiser** |

En cas de doute, `check-gateway.ps1` désigne l'étape fautive plus vite que la lecture des journaux.
