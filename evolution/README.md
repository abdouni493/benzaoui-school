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

**« Ailleurs » ne veut dire ni « VPS », ni « payant ».** L'option retenue par l'école — section B —
ne coûte rien du tout : ni serveur à louer, ni nom de domaine à acheter.

| Fichier | Rôle |
| --- | --- |
| `docker-compose.funnel.yml` | **Option retenue** : PC de l'école + Tailscale Funnel — gratuit, sans domaine |
| `tailscale/` | Configuration du Funnel (ce qui rend la passerelle publique) |
| `keep-alive.ps1` | **Verrouille le poste en service continu** : veille, redémarrage de Docker |
| `check-gateway.ps1` | **Diagnostic** : vérifie toute la chaîne Vercel ↔ passerelle depuis Windows |
| `docker-compose.local.yml` | Essai sur le PC, sans rien exposer — pour valider la chaîne |
| `docker-compose.tunnel.yml` | Variante gratuite avec Cloudflare, si l'école possède déjà un domaine |
| `railway/` | Hébergement géré et payant, indépendant du PC de l'école |
| `docker-compose.yml` + `Caddyfile` | VPS classique |
| `qr.ps1` | Affiche un QR de connexion depuis Windows, sans passer par l'application |
| `.env` | Secrets — **jamais commité** (couvert par `.gitignore`) |

---

## Choisir l'hébergement

|  | **B. Tailscale Funnel** *(retenu)* | **C. Cloudflare** | **D. Railway** | **E. VPS** |
| --- | --- | --- | --- | --- |
| Coût mensuel | **0 DA** | **0 DA** | 7–10 $ | ≈ 4 € |
| Nom de domaine | **aucun** | obligatoire | aucun | obligatoire |
| Serveur à administrer | aucun | aucun | aucun | oui |
| Fonctionne PC éteint | non | non | oui | oui |
| Mise en service | ~30 min | ~30 min | ~20 min | ~45 min |

**Le seul vrai arbitrage** : les options gratuites font tourner la passerelle sur le PC du
secrétariat. Tant qu'il est allumé, tout fonctionne, 24 h/24 s'il le faut. Éteint ou en veille,
**rien ne part sur le moment** — mais rien n'est perdu : les messages sont mis en file d'attente et
repartent seuls au retour de la passerelle (voir « File d'attente » plus bas). `keep-alive.ps1`
supprime les causes évitables (veille, Docker non relancé après une coupure) ; il ne peut rien
contre un poste débranché.

Dans tous les cas l'application est identique : seule change la valeur de `EVOLUTION_BASE_URL`.

---

## A. Essai local (~20 min)

À faire **avant** de publier quoi que ce soit : cela valide toute la chaîne sans rien exposer sur
Internet.

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

Puis : **Paramètres → WhatsApp → Initialiser → Connecter →** scanner le QR.

**Limite de ce mode** : rien n'est joignable depuis Vercel. C'est un banc d'essai, pas une mise en
production — d'où la section suivante.

---

## B. PC de l'école + Tailscale Funnel — **l'option retenue**

Gratuit, sans VPS, et **sans nom de domaine**. Tailscale Funnel donne à la passerelle une adresse
HTTPS publique et stable, du type `https://benzaoui-wa.tailXXXX.ts.net`, fournie avec le compte
gratuit. C'est elle que Vercel appellera.

```
Vercel  ──https──►  edge Tailscale  ──tunnel sortant──►  PC de l'école
```

Aucun port n'est ouvert sur la box : c'est le conteneur `tailscale` qui ouvre la connexion **vers
l'extérieur**. Le montage tient donc derrière une IP dynamique, un routeur d'opérateur, et même un
partage de connexion 4G.

### 1. Créer le compte Tailscale

Sur [tailscale.com](https://tailscale.com), créer un compte **gratuit** (plan Personal). Dans la
console d'administration, relever le **nom du tailnet**, de la forme `tail1a2b3c.ts.net` : il forme
la seconde moitié de l'adresse publique.

### 2. Activer MagicDNS et les certificats HTTPS

Console → **DNS**. Deux réglages sur cette page, dans cet ordre :

1. **MagicDNS** — activé par défaut sur un tailnet neuf ; le Funnel l'exige.
2. **HTTPS Certificates → Enable HTTPS.**

Sans le second, le Funnel ne peut pas servir en HTTPS et Vercel refusera de parler à la passerelle.

### 3. Autoriser le Funnel

Console → **Access controls**. Le bloc `nodeAttrs` doit être ajouté **à l'intérieur** de la
politique existante, comme frère de `grants` — et non collé au-dessus d'elle. Coller un second
objet `{ … }` donne l'erreur `invalid character '{' after top-level value` : le fichier ne peut
contenir **qu'un seul** objet de haut niveau.

Politique complète, telle qu'elle fonctionne sur le tailnet de l'école :

```jsonc
{
  "grants": [
    {"src": ["*"], "dst": ["*"], "ip": ["*"]},
  ],

  // C'est CE bloc qui autorise le Funnel.
  "nodeAttrs": [
    {
      "target": ["autogroup:member"],
      "attr":   ["funnel"],
    },
  ],

  "ssh": [
    {
      "action": "check",
      "src":    ["autogroup:member"],
      "dst":    ["autogroup:self"],
      "users":  ["autogroup:nonroot", "root"],
    },
  ],
}
```

Les virgules finales et les `//` sont volontaires : ce fichier est du HuJSON, pas du JSON strict.
Un tailnet récent utilise `grants` ; les anciens exemples à base de `acls` restent valides, mais
n'ajoutez pas les deux.

> **Piège coûteux — `tailscale funnel status` ment.**
> Sans cet attribut, le conteneur démarre, applique sa configuration, obtient même son certificat
> TLS, et affiche fièrement `# Funnel on: https://…`. Cet affichage vient du fichier de
> configuration **local**, qui s'applique quoi qu'il arrive. Le plan de contrôle, lui, refuse
> silencieusement de publier l'enregistrement DNS public : l'adresse ne résout nulle part et Vercel
> obtient un délai d'attente, sans le moindre message d'erreur nulle part.
>
> La **seule** vérification qui fasse foi est la liste des capacités réellement accordées :
>
> ```powershell
> docker exec evolution-tailscale tailscale status --json | Select-String "funnel"
> ```
>
> Elle doit contenir `funnel` **et** `funnel-ports?ports=443,8443,10000`. Si elle ne renvoie rien,
> l'attribut n'est pas accordé — quoi qu'affiche `funnel status`. La politique est prise en compte
> en quelques secondes, sans redémarrer le conteneur.

### 4. Générer une clé d'authentification

Console → **Settings → Keys → Generate auth key**. Cocher **Reusable** — sinon toute recréation du
conteneur exigerait une nouvelle clé. Copier la valeur `tskey-auth-…`.

### 5. Renseigner `evolution/.env`

Ce fichier n'est **jamais commité** (couvert par `.gitignore`).

```
TAILSCALE_AUTHKEY=tskey-auth-...
TAILSCALE_HOSTNAME=benzaoui-wa
TUNNEL_PUBLIC_URL=https://benzaoui-wa.VOTRE-TAILNET.ts.net
EVOLUTION_API_KEY=<chaîne aléatoire>
POSTGRES_PASSWORD=<autre chaîne aléatoire>
```

L'adresse se déduit sans attendre : `https://` + `TAILSCALE_HOSTNAME` + `.` + le tailnet de
l'étape 1. Générer les deux valeurs aléatoires sous PowerShell :

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

> `TUNNEL_PUBLIC_URL` devient le `SERVER_URL` de la passerelle. Il doit correspondre **au caractère
> près** à `EVOLUTION_BASE_URL` côté Vercel : c'est la valeur inscrite dans le champ `server_url` de
> chaque webhook, et `/api/whatsapp/webhook` compare les deux. Une différence, et tous les statuts
> de remise sont rejetés en 403.

### 6. Démarrer

> **Arrêter d'abord le montage local**, s'il tourne encore :
>
> ```powershell
> docker compose -f evolution/docker-compose.local.yml down
> ```
>
> Les deux fichiers portent le même nom de projet Compose (`evolution`) et
> **partagent donc les mêmes volumes**. C'est voulu : la session WhatsApp validée
> en local est reprise telle quelle, sans nouveau scan du QR. Mais faire tourner
> les deux montages en même temps ferait se disputer deux passerelles et deux
> Postgres autour des mêmes données. `down` (sans `-v`) conserve les volumes.

```powershell
docker compose -f evolution/docker-compose.funnel.yml up -d
docker compose -f evolution/docker-compose.funnel.yml logs -f tailscale
```

Les journaux du conteneur `tailscale` affichent l'adresse publique réellement obtenue. Si elle
diffère de `TUNNEL_PUBLIC_URL`, corriger `.env` et relancer `up -d` — sinon les webhooks seront
rejetés.

### 7. Vérifier depuis Internet

```powershell
curl.exe -s https://benzaoui-wa.VOTRE-TAILNET.ts.net/
```

Doit répondre un JSON avec la version d'Evolution. Idéalement, refaire le test depuis un téléphone
en 4G, hors du réseau de l'école : c'est la preuve que Vercel y arrivera aussi.

### 8. Verrouiller le poste en service continu

C'est l'étape qui fait la différence entre « ça marche aujourd'hui » et « ça marche encore dans six
mois ».

```powershell
# Rapport, ne modifie rien :
powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1

# Puis, dans un PowerShell ouvert en ADMINISTRATEUR :
powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1 -Apply
```

Le script désactive la mise en veille (qui suspend les conteneurs et fait tomber la session), crée
le raccourci de démarrage de Docker Desktop (sans lui, après une coupure de courant, les conteneurs
ne repartent pas malgré leur politique `unless-stopped`), et contrôle l'état des trois conteneurs.

Il signale aussi deux réglages qu'il ne touche pas volontairement : l'**ouverture de session
automatique** (elle exige de stocker un mot de passe — à n'activer que si le poste est physiquement
protégé) et les **heures d'activité de Windows Update**, pour que les redémarrages tombent hors des
heures de cours.

### 9. Configurer Vercel, puis connecter le téléphone

Suivre [« Variables Vercel »](#variables-vercel-communes-à-toutes-les-options) puis
[« Première connexion »](#première-connexion) ci-dessous.

---

## C. PC de l'école + tunnel Cloudflare

Même principe et même gratuité que l'option B, mais **exige un nom de domaine** géré par Cloudflare.
À retenir seulement si l'école en possède déjà un.

1. Ajouter le domaine sur [cloudflare.com](https://cloudflare.com) (offre gratuite) et pointer les
   serveurs de noms chez le registrar.
2. **Zero Trust → Networks → Tunnels → Create a tunnel → Cloudflared.** Nommer le tunnel, puis
   copier le **jeton** affiché dans la commande d'installation (la longue chaîne après `--token`).
3. Onglet **Public Hostname** : sous-domaine `wa`, domaine de l'école, type `HTTP`, URL
   `evolution:8080` — c'est le nom du conteneur sur le réseau Docker, résolu par `cloudflared` et
   non par Internet.
4. Dans `evolution/.env` :
   ```
   CLOUDFLARE_TUNNEL_TOKEN=<le jeton de l'étape 2>
   TUNNEL_PUBLIC_URL=https://wa.votre-domaine.dz
   EVOLUTION_API_KEY=<chaîne aléatoire>
   POSTGRES_PASSWORD=<autre chaîne aléatoire>
   ```
5. Démarrer, puis vérifier :
   ```powershell
   docker compose -f evolution/docker-compose.tunnel.yml up -d
   curl.exe -s https://wa.votre-domaine.dz/
   ```
6. Appliquer l'étape 8 de la section B (`keep-alive.ps1`) : la dépendance au PC est identique.

---

## D. Railway — hébergement géré (payant)

La seule option de cette page qui continue d'envoyer **quand le PC de l'école est éteint**. Ni SSH,
ni Ubuntu, ni certificat à gérer — mais une carte bancaire internationale et **7 à 10 $/mois**
(abonnement Hobby à 5 $ incluant 5 $ d'usage, dépassé par une passerelle et un Postgres qui tournent
en continu).

1. Compte sur [railway.com](https://railway.com), plan **Hobby**, puis **New Project → Deploy
   PostgreSQL**.
2. **+ New → Docker Image** : `evoapicloud/evolution-api:v2.3.7`.
   *Variante suivie dans Git* : **+ New → GitHub Repo**, puis **Settings → Root Directory** =
   `evolution/railway`. Railway construit alors [`railway/Dockerfile`](railway/Dockerfile), et
   [`railway/railway.json`](railway/railway.json) limite les redéploiements à ce dossier — pousser
   du code applicatif ne coupera pas WhatsApp.
3. **Settings → Volumes → New Volume**, chemin `/evolution/instances`. **À ne pas sauter** : sans
   volume, chaque redéploiement délie le téléphone et impose un nouveau scan.
4. **Settings → Networking → Generate Domain**, noter l'adresse.
5. **Variables → Raw Editor** : coller [`railway/env.example`](railway/env.example), puis renseigner
   `SERVER_URL` (le domaine de l'étape 4, sans slash final) et `AUTHENTICATION_API_KEY` (aléatoire).
   Laisser `${{Postgres.DATABASE_URL}}` tel quel.
6. **Settings → Deploy** : vérifier que **Serverless / App Sleeping** est **désactivé** — une
   passerelle endormie perd sa session.
7. Vérifier : `curl.exe -s https://VOTRE-DOMAINE.up.railway.app/`

---

## E. VPS (~4 €/mois)

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

## Variables Vercel (communes à toutes les options)

**Vercel → Settings → Environment Variables**, en Production *et* Preview :

| Variable | Valeur |
| --- | --- |
| `EVOLUTION_BASE_URL` | l'adresse HTTPS publique de la passerelle, **sans slash final** |
| `EVOLUTION_API_KEY` | la clé de la passerelle (`AUTHENTICATION_API_KEY`), à l'identique |
| `EVOLUTION_INSTANCE` | `benzaoui` |
| `EVOLUTION_WEBHOOK_TOKEN` | une **nouvelle** valeur aléatoire, différente de la clé API |

Avec l'option B, `EVOLUTION_BASE_URL` vaut exactement le `TUNNEL_PUBLIC_URL` de `evolution/.env`.

> **`EVOLUTION_BASE_URL` doit commencer par `https://`.** Un tunnel — Funnel comme Cloudflare — ne
> publie **que** le port 443 : `http://mon-poste.tail1234.ts.net` se fait refuser la connexion, et
> l'écran Paramètres affichait alors « passerelle injoignable » **avec le bon nom d'hôte**, puisque
> seul le schéma était faux. L'application relève désormais ce cas toute seule (`http://` → `https://`
> pour un hôte public) et le signale dans son diagnostic, mais autant écrire la bonne valeur.

> **`EVOLUTION_WEBHOOK_TOKEN` absent = aucun accusé de remise.** Les messages partent, les statuts
> restent bloqués sur `queued`, et **Initialiser l'instance** échoue en 503. Le panneau Paramètres
> affiche « Webhook : Non configuré » et nomme la variable manquante.

> **Ne PAS définir `EVOLUTION_WEBHOOK_URL` sur Vercel.** Laissée vide, l'application dérive
> l'adresse de son propre domaine de production. Renseignée par erreur avec la valeur locale
> (`host.docker.internal`) recopiée depuis `.env.local`, elle demanderait à la passerelle de
> rappeler une machine qui n'existe pas pour elle : les messages partiraient, mais aucun statut ni
> aucune réponse de parent ne reviendrait — sans erreur visible.

Aucune de ces variables ne doit être préfixée `NEXT_PUBLIC_` : ce préfixe les publierait dans le
navigateur de chaque visiteur, clé de la passerelle comprise.

Puis **redéployer** : les variables ne sont lues qu'au déploiement, les enregistrer ne suffit pas.

---

## Première connexion

1. **Paramètres → WhatsApp → Initialiser l'instance** — crée la session sur la passerelle et y
   enregistre l'adresse du webhook. À refaire après tout changement de domaine.
2. **Connecter WhatsApp** — un QR code s'affiche.
3. Sur le téléphone de l'école : WhatsApp → ⋮ → **Appareils connectés** → **Connecter un appareil**
   → scanner. Le badge passe au vert et le numéro lié s'affiche.

Le QR expire en moins d'une minute ; **Nouveau QR code** en génère un autre.

L'instance de production est **distincte** de celle utilisée en local : il faut rescanner, même si
le téléphone était déjà lié à la passerelle locale.

---

## Déménager : changer de téléphone, changer de poste

Les deux opérations sont indépendantes. Prises dans le bon ordre, **ni l'une ni l'autre ne demande
de toucher aux variables Vercel**.

### Changer seulement le numéro WhatsApp

Aucune configuration à modifier : ni `evolution/.env`, ni Vercel, ni Tailscale.

1. **Paramètres → WhatsApp → Déconnecter** — délie le téléphone actuel.
2. **Connecter WhatsApp** — un nouveau QR s'affiche.
3. Le scanner avec le **nouveau** téléphone de l'école.

L'instance, le webhook et l'adresse publique ne bougent pas. `DEL_INSTANCE=false` garantit que la
déconnexion ne détruit pas l'instance : seuls les identifiants du téléphone sont remplacés.

### Changer de poste

Tout se joue sur un point : **l'adresse publique doit rester identique**. Elle vaut
`https://` + `TAILSCALE_HOSTNAME` + `.` + nom du tailnet. Si elle change, il faut reprendre
`EVOLUTION_BASE_URL` sur Vercel, redéployer, puis réenregistrer le webhook.

Or Tailscale n'attribue jamais deux fois le même nom : **tant que l'ancien nœud existe, le nouveau
devient `benzaoui-wa-1`** et l'adresse change. D'où l'ordre ci-dessous, qui n'est pas négociable.

**Sur l'ANCIEN poste**

1. Arrêter la passerelle :
   ```powershell
   docker compose -f evolution/docker-compose.funnel.yml down
   ```
2. Copier `evolution/.env` sur une clé USB. **Ce fichier n'est pas dans Git** (il contient les
   secrets) : sans lui, la clé API ne correspondrait plus à celle de Vercel.

**Dans la console Tailscale**

3. **Machines → `benzaoui-wa` → ⋯ → Remove.** C'est cette suppression qui libère le nom. La sauter
   est l'erreur classique du déménagement : tout démarre, tout semble sain, et seule l'adresse a
   discrètement changé.
4. Vérifier la clé d'authentification (**Settings → Keys**). Si elle a expiré, en générer une
   nouvelle — **Reusable**, jamais **Ephemeral** — et la reporter dans `.env`.

**Sur le NOUVEAU poste**

5. Installer **Docker Desktop**, puis cloner le dépôt.
6. Y déposer le `evolution/.env` de l'étape 2.
7. Démarrer, et **vérifier le nom obtenu** :
   ```powershell
   docker compose -f evolution/docker-compose.funnel.yml up -d
   docker compose -f evolution/docker-compose.funnel.yml logs -f tailscale
   ```
   Le nom doit être exactement `benzaoui-wa.tail…ts.net`. **Un suffixe `-1` signifie que l'étape 3
   a été oubliée** : supprimer l'ancien nœud, puis `down` et `up -d` à nouveau.
8. Contrôler que le Funnel est bien accordé — l'affichage de `funnel status` ne fait pas foi :
   ```powershell
   docker exec evolution-tailscale tailscale status --json | Select-String "funnel"
   ```
9. Rendre le poste apte au service continu, **dans un PowerShell administrateur** :
   ```powershell
   powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1 -Apply
   ```
10. **Machines → `benzaoui-wa` → ⋯ → Disable key expiry.** Sans ce clic, le nœud se déconnecte au
    bout de quelques mois et les envois s'arrêtent sans le moindre avertissement.

**Dans l'application**

11. **Paramètres → WhatsApp → Initialiser l'instance** — recrée l'instance et le webhook sur la
    passerelle neuve.
12. **Connecter WhatsApp**, puis scanner avec le téléphone de l'école.
13. Vérifier l'ensemble :
    ```powershell
    powershell -ExecutionPolicy Bypass -File evolution\check-gateway.ps1 `
      -BaseUrl https://benzaoui-wa.tail6ac334.ts.net `
      -ApiKey  VOTRE_CLE `
      -AppUrl  https://benzaoui-school.vercel.app
    ```

### Faut-il transférer les volumes Docker ?

**Non**, dès lors que le téléphone change aussi : la session du volume `evolution_instances`
concerne l'ancien numéro et serait de toute façon remplacée au premier scan. Le nouveau poste
repart donc sur des volumes vides, et l'étape 11 reconstruit ce qu'il faut.

Le journal des messages de l'école n'est pas concerné : il vit dans Supabase, pas sur le poste
(`DATABASE_SAVE_DATA_NEW_MESSAGE=false`).

---

## Vérifier toute la chaîne

Depuis le poste de l'école, sans rien modifier :

```powershell
powershell -ExecutionPolicy Bypass -File evolution\check-gateway.ps1 `
  -BaseUrl https://benzaoui-wa.VOTRE-TAILNET.ts.net `
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

```powershell
docker compose -f evolution/docker-compose.funnel.yml logs -f evolution   # journaux passerelle
docker compose -f evolution/docker-compose.funnel.yml logs -f tailscale   # journaux du Funnel
docker compose -f evolution/docker-compose.funnel.yml restart evolution   # redémarrer
docker compose -f evolution/docker-compose.funnel.yml pull                # mettre à jour l'image
docker compose -f evolution/docker-compose.funnel.yml down                # arrêter (volumes conservés)
```

La session WhatsApp survit aux redémarrages : elle vit dans le volume `evolution_instances`. Un
`docker compose down -v` la détruirait — il faudrait alors rescanner.

Le volume `tailscale_state` est tout aussi important : sans lui, le nœud se réenregistrerait à
chaque démarrage et Tailscale lui donnerait un nom suffixé (`-1`, `-2`…). **L'adresse publique
changerait**, et plus rien n'arriverait de Vercel.

### Sauvegarde

```powershell
docker run --rm -v evolution_evolution_instances:/data -v ${PWD}:/backup `
  alpine tar czf /backup/whatsapp-session.tar.gz -C /data .
```

Sans cette sauvegarde, une perte du volume impose un nouveau scan du QR au secrétariat — gênant,
mais pas dramatique.

### Protéger le numéro

C'est le point qui décide de la survie du service :

- n'écrire qu'aux **familles inscrites**, jamais à une liste importée ;
- ~50 messages/jour la première semaine, ~200/jour ensuite ;
- **ne jamais désactiver la temporisation** de `app/api/whatsapp/send/route.ts` ;
- surveiller les blocages : si des parents signalent les messages, arrêter et revoir le texte.

Un numéro banni par WhatsApp l'est **sans recours**. Utilisez un numéro dédié à l'école.

### File d'attente — ce qui se passe quand le poste est éteint

Un message émis alors que la passerelle est injoignable **n'est pas perdu** : il est mis en file
d'attente (table `whatsapp_outbox`) et repart **tout seul** dès qu'elle revient.

C'est ce qui rend l'hébergement sur un poste acceptable. Sans cela, une alerte de solde déclenchée
par un scan de carte disparaissait sans que personne ne le sache — et personne ne revenait la
renvoyer à la main.

- **Rien à faire** : l'application vide la file d'elle-même, en arrière-plan, dès qu'un écran est
  ouvert et que la passerelle répond.
- Un bandeau discret indique le nombre de messages en attente ; **Paramètres → WhatsApp** les liste
  et offre un bouton **Envoyer maintenant** pour ne pas attendre.
- Le rattrapage respecte **la même temporisation** qu'un envoi normal : c'est justement en traitant
  un lot accumulé que l'on ressemble le plus à un robot.
- Un message est abandonné après **3 échecs qui lui sont propres** (numéro sans compte WhatsApp), ou
  après **7 jours** d'attente — un rappel de solde d'il y a une semaine peut être devenu faux.
- Une passerelle injoignable ne consomme **aucune** tentative : un long week-end hors ligne
  n'épuise pas le compteur.

> Cette fonctionnalité exige la migration `supabase/migrations/20260820_whatsapp_outbox.sql`,
> à exécuter une fois dans **Supabase → SQL Editor**.

### Diagnostic

| Symptôme | Cause probable |
| --- | --- |
| « N messages en attente » | Normal : la passerelle était injoignable. Ils repartent seuls ; rallumer le poste suffit |
| « Passerelle WhatsApp injoignable » | PC éteint ou en veille, Docker non démarré, ou `EVOLUTION_BASE_URL` erroné. Le message porte maintenant le **code système** : `ETIMEDOUT` = poste éteint, `ECONNREFUSED` = mauvais port ou `http://`, `ENOTFOUND` = adresse fausse |
| « Webhook : Non configuré » dans Paramètres | `EVOLUTION_WEBHOOK_TOKEN` n'est pas défini **sur Vercel** — l'ajouter, redéployer, puis **Réenregistrer le webhook** |
| Tout marchait, plus rien le lendemain | Le poste s'est mis en veille — lancer `keep-alive.ps1 -Apply` |
| Plus rien après une coupure de courant | Docker Desktop ne s'est pas relancé — `keep-alive.ps1 -Apply` |
| L'adresse `.ts.net` a changé | Volume `tailscale_state` perdu : reprendre `TUNNEL_PUBLIC_URL`, `EVOLUTION_BASE_URL`, puis **Initialiser** |
| `funnel status` dit « on » mais l'adresse ne résout pas | Attribut `funnel` non accordé. Vérifier avec `tailscale status --json`, pas avec `funnel status` (section B, étape 3) |
| Le Funnel refuse de publier | Attribut `funnel` absent des ACL, ou HTTPS non activé (section B, étapes 2 et 3) |
| « Clé API refusée » | `EVOLUTION_API_KEY` différent entre Vercel et la passerelle |
| « Instance introuvable » | Cliquer sur **Initialiser l'instance** dans Paramètres |
| « WhatsApp n'est pas connecté » | Session tombée : rescanner le QR code |
| Statuts bloqués sur `queued` | Le webhook n'arrive pas : jeton, URL, ou HTTPS non joignable |
| 403 en boucle dans les journaux | `SERVER_URL` de la passerelle ≠ `EVOLUTION_BASE_URL` de Vercel |
| 401 en boucle dans les journaux | `EVOLUTION_WEBHOOK_TOKEN` différent entre Vercel et l'instance — recliquer sur **Initialiser** |

Depuis l'application, **Paramètres → WhatsApp** affiche un bloc **Diagnostic** dès qu'il y a une
anomalie : variables absentes côté serveur (noms seuls), correction appliquée à `EVOLUTION_BASE_URL`,
code système du dernier échec réseau, et adresse du webhook effectivement dérivée. Il existe parce
que les deux familles de pannes — « le poste est éteint » et « une variable Vercel est fausse » —
rendaient jusqu'ici la même phrase, indistinguables sans accès aux journaux du serveur.

Depuis le poste, `check-gateway.ps1` désigne l'étape fautive plus vite que la lecture des journaux.
