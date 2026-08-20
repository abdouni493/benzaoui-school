# Prompt réutilisable — Passerelle WhatsApp gratuite, sans VPS

Ce fichier est un **prompt à donner tel quel à Claude Code** pour ajouter l'envoi WhatsApp à
n'importe quel projet web hébergé en serverless (Vercel, Netlify, Cloudflare Pages…), **sans VPS et
sans frais mensuels**.

Il condense un montage réellement mis en production, **avec les pièges rencontrés** — c'est cette
dernière partie qui a le plus de valeur : sans elle, les mêmes erreurs coûtent plusieurs heures.

## Comment l'utiliser

1. Remplir le bloc **« Contexte du projet »** ci-dessous.
2. Copier **tout ce qui suit la ligne de séparation** dans Claude Code.
3. Certaines étapes se font à la main dans la console Tailscale : le prompt les identifie
   explicitement et demande à Claude de s'arrêter pour les réclamer.

---

## Contexte du projet (à remplir avant d'envoyer)

```
Projet            : <nom>
Framework         : <ex. Next.js 15, App Router>
Hébergeur         : <ex. Vercel>
Domaine public    : <ex. mon-app.vercel.app>
Base de données   : <ex. Supabase / Postgres / Prisma>
OS du poste hôte  : <ex. Windows 11 + Docker Desktop>
Langue du code    : <ex. commentaires en français>
Qui reçoit les messages : <ex. les parents d'élèves, depuis le numéro de l'école>
```

---

# PROMPT

Tu vas ajouter à ce projet l'envoi de messages **WhatsApp** depuis le numéro de téléphone de
l'organisation, **sans passer par la WhatsApp Business API** (pas de modèle à faire approuver, pas
de frais par message), et **sans louer de serveur**.

Avant d'écrire la moindre ligne, lis la documentation du framework présente dans le projet et
respecte les conventions du dépôt (nommage, langue des commentaires, style des fichiers existants).

## 1. Contrainte d'architecture — la comprendre avant de coder

Une session WhatsApp Web (moteur **Baileys**) doit maintenir une connexion **ouverte en
permanence**. Un hébergeur serverless réveille une fonction par requête puis l'éteint : les deux
modèles sont **incompatibles**. Aucun réglage de l'hébergeur ne peut contourner cela.

La passerelle doit donc tourner **ailleurs**, sur une machine qui reste allumée, et l'application la
pilote en HTTPS :

```
App serverless ──HTTPS──►  passerelle Evolution API  ──►  WhatsApp des destinataires
App (webhook)  ◄──HTTPS──  passerelle Evolution API  ◄──  statuts de remise, réponses
```

« Ailleurs » ne veut dire ni « VPS » ni « payant » : la passerelle tourne sur **un poste que
l'organisation possède déjà**, exposé par **Tailscale Funnel**, qui fournit gratuitement une adresse
HTTPS publique et stable **sans nom de domaine**.

**Contrepartie à annoncer clairement à l'utilisateur, sans l'enjoliver** : poste éteint, en veille
ou sans Internet ⇒ aucun message ne part, et personne n'est prévenu automatiquement.

## 2. Pile technique imposée

| Composant | Version | Remarque |
| --- | --- | --- |
| `evoapicloud/evolution-api` | **`v2.3.7`** | **Épingler.** Ne jamais utiliser `latest` : une montée de version silencieuse casse la session. |
| `postgres` | `16-alpine` | Persistance des instances Evolution |
| `tailscale/tailscale` | `latest` | Sidecar qui publie la passerelle |

## 3. Partie A — Infrastructure (à créer par toi)

### `<infra>/docker-compose.funnel.yml`

Trois services : `evolution`, `postgres`, `tailscale`.

**Service `evolution`** :
- `restart: unless-stopped`
- port publié **sur `127.0.0.1` uniquement** : `"127.0.0.1:8081:8080"` — permet le diagnostic local
  sans rien exposer au réseau local ; le trafic public passe exclusivement par le Funnel ;
- `SERVER_URL=${TUNNEL_PUBLIC_URL}` — **doit valoir exactement** la variable `EVOLUTION_BASE_URL`
  côté application (voir piège 6.1) ;
- `AUTHENTICATION_API_KEY=${EVOLUTION_API_KEY}` ;
- `AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false` ;
- `DATABASE_ENABLED=true`, `DATABASE_PROVIDER=postgresql`, URI vers le service `postgres` ;
- `DATABASE_SAVE_DATA_NEW_MESSAGE=false` et `DATABASE_SAVE_MESSAGE_UPDATE=false` — le journal
  applicatif vit dans la base du projet, ne pas dupliquer les messages sur le disque du poste ;
- `DEL_INSTANCE=false` — **essentiel** : une instance déconnectée ne doit pas être supprimée, sinon
  une simple coupure imposerait de tout reconfigurer au lieu d'un simple rescan ;
- `WEBHOOK_GLOBAL_ENABLED=false` — les webhooks sont déclarés **par instance**, depuis l'application,
  avec un jeton d'authentification ;
- `QRCODE_LIMIT=30`, `LOG_LEVEL=ERROR`, `CACHE_LOCAL_ENABLED=true`, `CACHE_REDIS_ENABLED=false` ;
- volume nommé sur `/evolution/instances` — **c'est la session WhatsApp** ; la perdre impose un
  nouveau scan du QR ;
- `depends_on: postgres: condition: service_healthy`.

**Service `postgres`** : volume de données + `healthcheck` avec `pg_isready` (sans lui, Evolution
démarre en erreur avant que la base accepte les connexions).

**Service `tailscale`** :
- `TS_AUTHKEY=${TAILSCALE_AUTHKEY}`
- `TS_HOSTNAME=${TAILSCALE_HOSTNAME}` — détermine la première moitié de l'adresse publique
- `TS_SERVE_CONFIG=/config/funnel.json`
- `TS_STATE_DIR=/var/lib/tailscale` **+ volume nommé** (voir piège 6.2)
- `TS_USERSPACE=true` — évite `/dev/net/tun` et les privilèges réseau ; indispensable sous Docker
  Desktop / Windows
- monter le **dossier** de configuration, pas le fichier : `./tailscale:/config:ro` (piège 6.5)

### `<infra>/tailscale/funnel.json`

**Aucun commentaire, aucune clé étrangère** — Tailscale désérialise ce fichier (piège 6.6) :

```json
{
  "TCP": { "443": { "HTTPS": true } },
  "Web": {
    "${TS_CERT_DOMAIN}:443": {
      "Handlers": { "/": { "Proxy": "http://evolution:8080" } }
    }
  },
  "AllowFunnel": { "${TS_CERT_DOMAIN}:443": true }
}
```

`${TS_CERT_DOMAIN}` est substitué au démarrage par le FQDN réel du nœud : **ne jamais l'écrire en
dur**. Le Funnel n'accepte que les ports **443, 8443 et 10000**.

### `<infra>/keep-alive.ps1` (ou l'équivalent pour l'OS du poste)

Script qui **verrouille le poste en service continu**. Il rapporte par défaut et ne modifie qu'avec
`-Apply`. Il doit traiter :

1. **mise en veille et veille prolongée → « jamais »** (elles suspendent les conteneurs et font
   tomber la session : cause n°1 d'un service qui « marche la journée et plus le soir ») ;
2. **démarrage automatique du moteur Docker** — après une coupure de courant, `unless-stopped` ne
   sert à rien tant que Docker Desktop n'est pas lancé ;
3. contrôle de l'état et de la politique de redémarrage des conteneurs ;
4. détection d'un **montage concurrent** partageant les mêmes volumes.

**Ne signaler que ce qui casse réellement le service.** Exemple vécu : l'arrêt des disques inactifs
avait été signalé à tort — le disque se réveille au premier accès, cela ne coupe rien. Un faux
signalement apprend à ignorer le rapport.

Signaler sans les modifier : l'**ouverture de session automatique** (elle stocke un mot de passe) et
les **heures d'activité des mises à jour système**.

### `<infra>/check-gateway.ps1`

Diagnostic de bout en bout, exécutable sans rien modifier. Il vérifie **dans cet ordre**, avec pour
chaque échec la manœuvre correspondante :

1. la passerelle répond ;
2. la clé API est acceptée ;
3. l'instance existe et la session est connectée ;
4. **le webhook est déclaré vers le bon domaine** (piège 6.3) ;
5. l'endpoint webhook de l'application répond **401 sans jeton**.

## 4. Partie B — Intégration applicative

### Variables d'environnement (côté serveur uniquement)

| Variable | Rôle |
| --- | --- |
| `EVOLUTION_BASE_URL` | adresse publique de la passerelle, **sans slash final** |
| `EVOLUTION_API_KEY` | identique à `AUTHENTICATION_API_KEY` de la passerelle |
| `EVOLUTION_INSTANCE` | nom de l'instance |
| `EVOLUTION_WEBHOOK_TOKEN` | secret **différent** de la clé API, pour authentifier les webhooks entrants |

**`EVOLUTION_WEBHOOK_URL` ne doit PAS être définie en production** : l'application dérive l'adresse
de son propre domaine. La définir par erreur avec la valeur locale est le piège 6.3.

**Aucune de ces variables ne doit porter le préfixe public du framework** (`NEXT_PUBLIC_`, `VITE_`,
`PUBLIC_`…) : cela publierait la clé de la passerelle dans le navigateur de chaque visiteur.

### Module client (serveur)

Fonctions attendues, toutes côté serveur :

- `sendText(recipients, message)` — envoi, avec **temporisation entre destinataires** ;
- `sessionState()` — état de la session (`open`, `connecting`, `close`) + numéro lié ;
- `createInstance(webhookUrl)` — **idempotent** : doit avaler « already exists » ;
- `setWebhook(webhookUrl)` — réenregistre le webhook **sans toucher à la session en cours** ;
- `logoutInstance()`, `restartInstance()`.

Charge utile du webhook à enregistrer :

```json
{
  "enabled": true,
  "url": "<URL publique de l'app>/api/whatsapp/webhook",
  "byEvents": false,
  "headers": {
    "Authorization": "Bearer <EVOLUTION_WEBHOOK_TOKEN>",
    "Content-Type": "application/json"
  },
  "events": ["MESSAGES_UPSERT", "MESSAGES_UPDATE", "CONNECTION_UPDATE"]
}
```

### Routes serveur

| Route | Rôle |
| --- | --- |
| `POST /api/whatsapp/send` | **Seul chemin détenant la clé.** Limite le nombre de destinataires par appel, temporise les envois groupés. |
| `POST /api/whatsapp/webhook` | Vérifie le `Bearer`, **et que le champ `server_url` du corps correspond à `EVOLUTION_BASE_URL`**. Répond `401` sans jeton, `403` si `server_url` diffère. |
| `GET /api/whatsapp/status` | État de session pour l'interface. Ne renvoie **jamais** la clé. |
| `POST /api/whatsapp/session` | Actions explicites : `setup`, `connect`, `logout`, `restart`. |

`setup` doit enchaîner `createInstance(url)` **puis** `setWebhook(url)`, et rester exécutable **sur
une session déjà ouverte**.

### Interface — panneau « Réglages → WhatsApp »

**C'est la pièce qui rend le montage utilisable par une secrétaire plutôt que par un développeur.**
Sans elle, connecter le téléphone imposerait de manipuler l'API à la main. Elle doit être autonome :
tout se fait depuis cet écran, sans terminal, sans copier-coller de jeton.

Créer un composant client dédié (`WhatsAppSettingsPanel` ou équivalent), monté dans la page de
réglages de l'application.

#### Contrat de `GET /api/whatsapp/status`

Le panneau se pilote entièrement à partir de cette réponse. **Aucun champ ne doit exposer de
secret** :

| Champ | Type | Rôle |
| --- | --- | --- |
| `configured` | `boolean` | les variables minimales pour envoyer sont présentes |
| `state` | `"open" \| "connecting" \| "close"` | état brut renvoyé par la passerelle |
| `connected` | `boolean` | raccourci : la session est utilisable |
| `linkedNumber` | `string \| null` | numéro lié, ex. `"213555123456"` |
| `profileName` | `string \| null` | nom de profil WhatsApp du compte lié |
| `instanceMasked` | `string \| null` | nom d'instance **masqué**, ex. `"•••••aoui"` |
| `baseUrlHost` | `string \| null` | **hôte seul**, jamais l'URL complète, jamais la clé |
| `webhookConfigured` | `boolean` | le webhook pointe bien vers **cette** application |
| `error` | `string \| null` | message lisible si l'interrogation a échoué |
| `qrBase64` | `string \| null` | QR en **data-URI**, prêt pour un `<img src>` ; `null` si connecté |
| `pairingCode` | `string \| null` | code d'appairage à saisir sur le téléphone, si fourni |

#### Actions — `POST /api/whatsapp/session`

Un seul endpoint, discriminé par `{ action }`, renvoyant l'état à jour :

| Action | Effet | Disponible quand |
| --- | --- | --- |
| `setup` | crée l'instance **puis** enregistre le webhook | **toujours**, y compris session ouverte |
| `connect` | génère un QR / code d'appairage | session fermée |
| `restart` | relance la session **sans délier** le téléphone | session ouverte |
| `logout` | délie le téléphone | session ouverte, **après confirmation** |

#### Disposition

1. **Badge d'état** en tête : vert si `connected`, rouge sinon.
2. **Numéro lié** et nom de profil, quand la session est ouverte — c'est ce qui permet de vérifier
   d'un coup d'œil que c'est bien le bon téléphone qui est branché.
3. **Grille d'informations** (4 lignes) : `Instance` (masquée), `Serveur` (hôte seul),
   `Webhook` (« Jeton configuré » / « Non configuré », ton d'alerte si non), `État brut`.
4. **Deux branches d'actions**, selon `connected`.

#### Branche « session ouverte »

- Bandeau **conditionné à `webhookConfigured`** :
  - configuré → message de succès « la passerelle est prête » ;
  - **non configuré → message d'alerte** expliquant que les messages partiront mais qu'aucun accusé
    ne reviendra, et **désignant le bouton à cliquer**.
    Afficher « prête » dans ce cas serait faux : les statuts resteraient bloqués sur `queued`
    pendant que l'écran affirme que tout va bien.
- Boutons : **Redémarrer la session**, **Réenregistrer le webhook** (action `setup` — voir piège
  6.4, il doit être présent **ici**), **Déconnecter**.
- **Déconnecter en deux temps** : un premier clic remplace le bouton par « Oui, déconnecter » +
  « Annuler ». Le geste est destructeur — il arrête tous les envois automatiques jusqu'à un nouveau
  scan — et ne doit pas partir d'un clic isolé.
- Phrase d'avertissement sous les boutons, disant exactement cela.

#### Branche « session fermée »

- Boutons : **Connecter WhatsApp** (devient **Nouveau QR code** si un QR est déjà affiché) et
  **Initialiser l'instance** (même action `setup`).
- Ligne d'explication : « Initialiser » crée l'instance et y enregistre l'adresse du webhook ; à
  faire une fois, et de nouveau après un changement de domaine.
- **Bloc QR** quand `qrBase64` est présent : le data-URI dans un `<img>`, centré, encadré, avec la
  marche à suivre côté téléphone (**WhatsApp → ⋮ → Appareils connectés → Connecter un appareil**).
- Afficher le **code d'appairage** s'il est fourni, en gros et en `font-mono` : c'est l'alternative
  quand la caméra ne coopère pas.

#### Comportements dynamiques — ce qui fait la différence à l'usage

- **Sondage tant que le QR est affiché** : un QR WhatsApp expire en moins d'une minute. Tant qu'il
  est à l'écran et que la session n'est pas ouverte, interroger l'état toutes les ~3 s pour basculer
  **dès que le scan est pris en compte**, sans que l'utilisateur ait à rafraîchir.
  **Nettoyer l'intervalle au démontage.**
- **Effacer le QR dès que `connected` passe à vrai** — laisser un QR périmé à l'écran invite à
  scanner dans le vide.
- **Ne sonder que dans ce cas.** Pas de sondage permanent : cet écran reste parfois ouvert des
  heures, et chaque appel réveille une fonction serverless.
- **Un seul bouton actif à la fois** : mémoriser l'action en cours et désactiver tous les boutons
  pendant qu'elle tourne.
- **Libellés de progression** : « Connecter WhatsApp » → « Connexion… », « Réenregistrer le
  webhook » → « Enregistrement… ». Une action passerelle prend plusieurs secondes ; sans retour
  visuel, l'utilisateur cliquera deux fois.
- **Garde de démontage** : ne pas appeler `setState` après démontage du composant (les actions sont
  longues, l'utilisateur peut changer de page).
- **Zone d'erreur** affichant `error` en clair, avec la manœuvre correspondante quand elle est
  connue (passerelle injoignable → le poste est-il allumé ?).

#### Règles d'affichage non négociables

- **Jamais** la clé API, ni le jeton de webhook, ni l'URL complète de la passerelle : hôte seul, et
  nom d'instance masqué. Cet écran est visible par du personnel administratif.
- `webhookConfigured` traduit une **présence**, pas une valeur : ne jamais afficher le jeton.

#### Bloc pédagogique « À savoir »

Terminer le panneau par quelques lignes que le personnel doit avoir sous les yeux :

- les messages partent du numéro de l'organisation via une passerelle auto-hébergée : aucun modèle à
  faire approuver, les textes se modifient librement ;
- **la passerelle doit rester allumée** — poste éteint, aucun message ne part ;
- le téléphone qui a scanné doit se reconnecter à Internet de temps en temps, sinon WhatsApp finit
  par délier l'appareil ;
- écrire trop, ou à des gens qui n'attendent rien, **fait bannir le numéro** ; les envois groupés
  sont temporisés volontairement ;
- les identifiants sont configurés côté serveur et ne sont jamais exposés ici.

### Envois automatiques

S'il existe des alertes automatiques (événement métier → message) :

- **fire-and-forget**, sans jamais lever d'exception : une passerelle éteinte ne doit casser ni
  l'action métier ni la transaction déjà écrite ;
- **déduplication** par clé, **relâchée en cas d'échec** pour qu'une prochaine tentative reparte ;
- ne jamais journaliser la clé ni le corps complet en clair.

### File d'attente (outbox) — **obligatoire**

C'est le complément indispensable d'une passerelle auto-hébergée. Le poste qui l'héberge sera
éteint, en veille ou hors ligne à un moment ou à un autre : **sans file d'attente, chaque message
émis pendant ce temps est purement perdu.** Pour une alerte automatique déclenchée par un événement
métier, personne ne revient jamais la renvoyer à la main.

Comportement attendu : la passerelle est injoignable ⇒ le message est **mis en attente**, pas
rejeté ; il repart **tout seul** dès qu'elle revient.

#### Table dédiée — surtout pas le journal d'envoi

Le journal (`whatsapp_messages`) enregistre ce qui a été confié à la passerelle et son statut de
remise ; **il ne stocke même pas le texte**, n'ayant jamais eu à renvoyer un message. Une file a
besoin de l'inverse. Créer une table distincte :

| Colonne | Rôle |
| --- | --- |
| `recipient_phone` | MSISDN **normalisé dès la mise en file** — un numéro invalide doit être refusé tout de suite, pas découvert trois jours plus tard |
| `recipient_display`, `recipient_name` | affichage |
| `body` | **le texte à envoyer** — ce que le journal ne conserve pas |
| `status` | `pending` \| `sent` \| `abandoned` |
| `attempts`, `last_error`, `last_attempt_at` | suivi des échecs |
| `created_at`, `sent_at`, `abandoned_at`, `abandoned_reason` | horodatage |

Index sur `(status, created_at)` : le vidage lit toujours « les plus anciens en attente d'abord ».
Un message parti est marqué `sent` **et** journalisé normalement, pour que le suivi de remise
(`sent → delivered → read`) reste au même endroit que pour un envoi direct.

#### Règles de reprise — les trois qui comptent

1. **Une passerelle injoignable ne consomme JAMAIS de tentative.** Ce n'est pas la faute du
   message. Sans cette règle, un week-end hors ligne épuiserait le compteur de toute la file et
   ferait abandonner des messages parfaitement valides.
2. **Un échec propre au destinataire incrémente les tentatives** (numéro sans compte WhatsApp,
   refus de la passerelle) ; au bout de 3, le message est abandonné plutôt que réessayé sans fin.
3. **Expirer les messages trop anciens** (~7 jours). Un rappel de solde vieux d'une semaine peut
   être devenu **faux** — la famille a pu payer entre-temps. Mieux vaut ne rien envoyer qu'envoyer
   une information périmée à un parent.

#### Le vidage doit respecter la MÊME cadence que l'envoi direct

Extraire la temporisation anti-bannissement dans un module partagé (`pacing.ts`) et l'utiliser des
deux côtés. Le rattrapage traite justement des lots accumulés : c'est le moment où l'on ressemble le
plus à un robot, donc le dernier endroit où accélérer. Dupliquer les constantes les laisserait
diverger, et une divergence ici coûte le numéro.

#### Qui déclenche le rattrapage ?

En serverless, rien ne tourne entre deux requêtes. C'est donc **l'application ouverte dans le
navigateur** qui déclenche le vidage — un composant monté dans la coquille applicative :

- sonde une route `GET /api/whatsapp/outbox` qui **compte des lignes et n'appelle jamais la
  passerelle** (sondage bon marché : un écran ouvert des heures ne doit pas réveiller la passerelle
  en boucle) ;
- n'appelle `POST /api/whatsapp/outbox/flush` **que s'il reste quelque chose** ;
- verrou anti-chevauchement : un vidage est lent, le sondage suivant peut tomber pendant ;
- s'arrête définitivement sur 401/403 plutôt que de boucler sur un refus ;
- premier passage **différé** de quelques secondes : ce composant est remonté à chaque navigation.

Ce n'est pas un pis-aller : le poste de l'organisation a l'application ouverte toute la journée, et
c'est **le même poste** qui héberge la passerelle. Quand il est allumé, le rattrapage part.

#### Retour visible, sans mentir

- La réponse d'envoi distingue **trois** issues : `sent`, `queued` (en attente), `failed`.
  **Un message en attente n'est pas un échec** — l'afficher en rouge ferait croire à une perte.
- Compte rendu par destinataire à trois états : envoyé (vert), **en attente** (orange), échec
  (rouge).
- Indicateur discret tant qu'il reste des messages en file, et bouton **« Envoyer maintenant »**
  dans les réglages pour ne pas attendre l'intervalle.
- Ne rien afficher quand la file est vide : un encart permanent finit par ne plus être lu.

## 5. Partie C — Sécurité, non négociable

- La clé de la passerelle ne quitte **jamais** le serveur.
- Le webhook entrant est authentifié par `Bearer`, **et** par correspondance de `server_url`.
- Le fichier de secrets de l'infrastructure est couvert par `.gitignore`, et **n'est pas dans Git** :
  prévoir explicitement son transport lors d'un déménagement.
- **Protection du numéro** : n'écrire qu'à des personnes qui attendent quelque chose de
  l'organisation ; monter en charge progressivement (~50 messages/jour la première semaine) ; ne
  jamais désactiver la temporisation des envois groupés. **Un numéro banni par WhatsApp l'est sans
  recours.** Utiliser un numéro dédié.

## 6. Partie D — Pièges connus (les respecter dès le départ)

### 6.1 `SERVER_URL` doit correspondre au caractère près
C'est la valeur inscrite dans le champ `server_url` de chaque webhook, comparée par l'application.
Un slash final en trop ⇒ **tous les statuts de remise rejetés en 403**.

### 6.2 Le volume d'état Tailscale rend l'URL stable
Sans lui, le nœud se réenregistre à chaque démarrage et reçoit un nom suffixé (`-1`, `-2`…).
**L'adresse publique change** et l'application n'atteint plus rien. Ce volume est aussi important
que celui de la session WhatsApp.

### 6.3 Le webhook survit aux déménagements — et pointe vers l'ancienne adresse
Il est stocké **sur la passerelle**, pas dans l'application. Après un passage de `localhost` à la
production, il pointe encore vers la machine de développement. Symptôme : les messages partent, les
statuts restent sur `queued`, **aucune erreur nulle part**. C'est la raison d'être du contrôle n°4
de `check-gateway`.

### 6.4 Le bouton de réenregistrement doit exister en session ouverte
Erreur vécue : il n'était rendu que si la session était **fermée**. Session ouverte + webhook
périmé = le cas qui a besoin du bouton, et celui où il disparaissait. Le seul contournement était de
délier le téléphone — casser une session saine pour corriger une URL.

### 6.5 Monter le **dossier** de configuration, pas le fichier
La documentation Tailscale l'impose : un bind-mount de fichier unique empêche le conteneur de voir
les modifications ultérieures.

### 6.6 `funnel.json` ne supporte aucun commentaire
Tailscale le désérialise. Mettre les explications dans un `README.md` voisin.

### 6.7 **`tailscale funnel status` ment** — le piège le plus coûteux
Sans l'attribut `funnel` accordé par les ACL, le conteneur démarre, applique sa configuration,
**obtient même son certificat TLS**, et affiche `# Funnel on: https://…`. Cet affichage vient du
fichier **local**, qui s'applique quoi qu'il arrive. Le plan de contrôle, lui, refuse silencieusement
de publier le DNS public : l'adresse ne résout nulle part, sans le moindre message d'erreur.

**La seule vérification qui fasse foi :**

```bash
docker exec <conteneur-tailscale> tailscale status --json | grep funnel
```

Doit contenir `funnel` **et** `funnel-ports?ports=443,8443,10000`. Si `https` est présent mais pas
`funnel`, le certificat fonctionnera et le Funnel non — c'est exactement le symptôme observé.

### 6.8 Deux montages Compose peuvent partager les mêmes volumes
Deux fichiers dans le même dossier résolvent le **même nom de projet**, donc les **mêmes volumes**.
Avantage : basculer d'un montage d'essai vers la production **conserve la session WhatsApp**, sans
rescanner le QR. Danger : les démarrer ensemble met deux passerelles et deux bases sur les mêmes
données. Documenter l'arrêt préalable, et le détecter dans le script de contrôle.

### 6.9 Le mot de passe Postgres ne peut plus changer
Il n'est appliqué qu'à l'**initialisation** du volume. Le modifier ensuite ⇒ la base rejette la
connexion et la passerelle ne démarre plus. Le conserver tel quel lors d'une bascule qui réutilise
le volume.

### 6.10 Sans file d'attente, tout message émis passerelle éteinte est PERDU
Le poste hôte sera éteint un jour ou l'autre. Un envoi qui échoue franchement laisse
l'utilisateur devant une erreur — et une alerte automatique, elle, ne laisse rien du tout : personne
ne revient la renvoyer. La file d'attente n'est donc pas un raffinement, c'est ce qui rend
l'hébergement sur un poste acceptable. Voir « File d'attente (outbox) » en partie B.

### 6.11 Déménager la passerelle : supprimer l'ancien nœud **d'abord**
Tailscale n'attribue jamais deux fois le même nom. Tant que l'ancien nœud existe, le nouveau devient
`<nom>-1` et **l'adresse publique change**. Supprimer l'ancien nœud dans la console **avant** de
démarrer le nouveau ⇒ l'adresse reste identique et l'hébergeur n'a **rien** à savoir du
déménagement. Oublier cette étape *ressemble* à une réussite : tout démarre, tout paraît sain, seule
l'adresse a discrètement changé.

## 7. Partie E — Étapes manuelles à réclamer à l'utilisateur

Tu **ne peux pas** faire ces étapes toi-même. Arrête-toi et demande-les explicitement, avec les
valeurs exactes à reporter :

1. Créer un compte **Tailscale** gratuit (plan Personal) et relever le **nom du tailnet**
   (`tailXXXX.ts.net`) dans **DNS**.
2. **DNS → MagicDNS actif**, puis **Enable HTTPS**.
3. **Access controls** — ajouter `nodeAttrs` **à l'intérieur** de la politique existante :
   ```jsonc
   "nodeAttrs": [
     { "target": ["autogroup:member"], "attr": ["funnel"] },
   ],
   ```
   ⚠️ Le fichier ne peut contenir **qu'un seul** objet de haut niveau. Coller ce bloc *au-dessus* de
   la politique existante produit `invalid character '{' after top-level value`. Les tailnets récents
   utilisent `grants`, les anciens `acls` : ne pas mettre les deux.
4. **Settings → Keys → Generate auth key**, cochée **Reusable**, **jamais Ephemeral** (un nœud
   éphémère disparaît hors ligne et revient sous un autre nom, changeant l'adresse).
5. Après le premier démarrage : **Machines → `<nœud>` → Disable key expiry**. Sans ce clic, le nœud
   se déconnecte au bout de quelques mois et **les envois s'arrêtent sans aucun avertissement**.
6. Renseigner les variables d'environnement chez l'hébergeur, **puis redéployer** — elles ne sont
   lues qu'au déploiement.

`TAILSCALE_HOSTNAME` ne se récupère nulle part : **c'est un nom choisi**. L'adresse publique vaut
`https://` + ce nom + `.` + le nom du tailnet.

## 8. Critères d'acceptation

Ne déclare la tâche terminée que si **tout** ceci est vérifié, en montrant les sorties réelles :

- [ ] `docker compose config` valide, images **épinglées**, trois conteneurs `unless-stopped` ;
- [ ] `tailscale status --json` contient **`funnel`** et `funnel-ports` ;
- [ ] le nom obtenu est **exactement** celui attendu, **sans suffixe `-1`** ;
- [ ] l'adresse publique répond en HTTPS **depuis l'extérieur du réseau** (pas seulement depuis le
      poste : un test local ne prouve rien) ;
- [ ] la clé API est acceptée à travers le tunnel ;
- [ ] le webhook est déclaré vers le **domaine de production**, pas vers `localhost` ni
      `host.docker.internal` ;
- [ ] l'endpoint webhook répond **401 sans jeton** ;
- [ ] un message réel atteint **`delivered`** — franchir `queued` est la seule preuve que la boucle
      est complète ;
- [ ] **le panneau de réglages permet de connecter le téléphone de bout en bout, sans terminal** :
      QR affiché, scanné, badge qui passe au vert **tout seul** grâce au sondage, numéro lié affiché ;
- [ ] le panneau expose **« Réenregistrer le webhook » en session ouverte**, et n'annonce pas
      « prête » quand `webhookConfigured` est faux ;
- [ ] aucun secret visible dans le panneau ni dans la réponse de `/status` (vérifier l'onglet réseau :
      ni clé API, ni jeton, ni URL complète de la passerelle) ;
- [ ] **passerelle arrêtée, un envoi est MIS EN ATTENTE et non perdu** — l'interface l'annonce
      comme tel, jamais comme un échec ;
- [ ] **passerelle rallumée, les messages en attente repartent SEULS**, sans action de
      l'utilisateur, en respectant la même temporisation qu'un envoi direct ;
- [ ] une passerelle injoignable **ne consomme pas de tentative** (vérifiable par un test) ;
- [ ] la suite de tests du projet passe, le build de production réussit ;
- [ ] le script de service continu a été exécuté sur le poste hôte ;
- [ ] la documentation créée mentionne **explicitement** la contrepartie : poste éteint = aucun
      message, sans alerte.

## 9. Ce qu'il ne faut pas faire

- Ne **pas** proposer la WhatsApp Business API « au cas où » : elle impose des modèles à faire
  approuver et une facturation par message, tout ce que ce montage évite.
- Ne **pas** utiliser le tag `latest` pour la passerelle.
- Ne **pas** annoncer un coût sans le vérifier : le prix affiché d'un hébergeur géré est souvent le
  plancher de l'abonnement, pas la facture d'un service tournant en continu.
- Ne **pas** minimiser la dépendance au poste allumé : c'est le vrai prix de la gratuité, et
  l'utilisateur doit le décider en connaissance de cause.
