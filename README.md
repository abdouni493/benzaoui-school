# BENZAOUI SCHOOL — Gestion d'école privée

Application de gestion d'école privée (Next.js App Router + TypeScript + Tailwind + Supabase) :
abonnements (cours & formations), présence par carte RFID, soldes et paiements des étudiants,
paie des enseignants, caisse, dépenses, rapports financiers, annonces, 5 rôles
(admin / réception / enseignant / étudiant / parent), thèmes clair/sombre et FR/AR (RTL).

## Stack

- **Next.js 16** (App Router, Turbopack) — pages dans `app/`, contenu des modules dans `components/pages/`
- **Supabase** — Postgres + Auth + Storage + RLS (`supabase/schema.sql`)
- **Zustand** — store client (`lib/store/`), mappé sur les tables Postgres (`lib/store/data.ts`)

## Développement local

```bash
npm install
cp .env.example .env.local   # puis remplir les variables (voir .env.example)
npm run dev
```

## Base de données

1. Créer un projet Supabase, puis exécuter `supabase/schema.sql` dans **Dashboard → SQL Editor**.
2. Exécuter ensuite chaque fichier de `supabase/migrations/` (dans l'ordre des dates).
3. Créer le premier compte admin depuis la page de connexion (« Créer un compte admin »).

## Messages WhatsApp (Evolution API — passerelle auto-hébergée)

Les fiches élèves et parents envoient des messages WhatsApp (alerte de dette, solde épuisé, solde
faible, frais d'inscription, ou message libre) via **[Evolution API](https://github.com/EvolutionAPI/evolution-api)**,
une passerelle open source qui pilote une **vraie session WhatsApp Web** depuis le numéro de l'école.

```
Navigateur → /api/whatsapp/send → passerelle Evolution (hébergée) → WhatsApp de la famille
WhatsApp → passerelle → /api/whatsapp/webhook → Supabase (statuts, messages entrants)
```

> ### ⚠️ À lire avant de mettre en service
>
> - **La passerelle exige un processus allumé en permanence.** Vercel est serverless — chaque
>   requête réveille une fonction qui s'éteint aussitôt — et ne peut donc pas maintenir la session
>   WhatsApp ouverte. La passerelle tourne ailleurs ; **cela ne veut pas dire un VPS** : deux des
>   trois options ci-dessous n'exigent aucun serveur à administrer. Si elle est arrêtée,
>   **aucun message ne part** — silencieusement.
> - **Le numéro utilisé peut être banni par WhatsApp**, sans préavis ni recours, en cas d'envoi
>   massif ou de plaintes des destinataires. Utilisez un numéro dédié à l'école, jamais un numéro
>   personnel. Ce risque n'existait pas avec un fournisseur officiel : c'est la contrepartie de la
>   gratuité.
> - Une mise à jour de WhatsApp peut casser la passerelle quelques jours. C'est rare, mais possible.

**Ce que la migration a apporté.** Plus aucun modèle à faire approuver : les quatre alertes sont du
texte libre FR/AR, modifiables immédiatement dans `lib/whatsapp/templates.ts` ou directement dans la
fenêtre d'envoi. Plus de fenêtre de service client de 24 h : l'école écrit quand elle veut. Et le
coût par message est nul, quel que soit le volume.

### Où héberger la passerelle

Procédure complète, option par option, dans **[`evolution/README.md`](evolution/README.md)**.
L'application est identique dans tous les cas : seule change la valeur de `EVOLUTION_BASE_URL`.

| | **Tailscale Funnel** *(retenu)* | **Cloudflare** | **Railway** | **VPS** |
| --- | --- | --- | --- | --- |
| Coût mensuel | **0 DA** | **0 DA** | 7–10 $ | ≈ 4 € |
| Nom de domaine | **aucun** | obligatoire | aucun | obligatoire |
| Serveur à administrer | aucun | aucun | aucun | oui |
| Fonctionne PC éteint | non | non | oui | oui |
| Fichiers | [`docker-compose.funnel.yml`](evolution/docker-compose.funnel.yml) | [`docker-compose.tunnel.yml`](evolution/docker-compose.tunnel.yml) | [`railway/`](evolution/railway/) | [`docker-compose.yml`](evolution/docker-compose.yml) |

**L'option retenue par l'école** fait tourner la passerelle sur le poste du secrétariat — le même
que celui qui scanne les cartes RFID — et **Tailscale Funnel** lui donne une adresse HTTPS publique
et stable (`https://benzaoui-wa.tailXXXX.ts.net`), fournie gratuitement avec le compte. Aucun port
n'est ouvert sur la box de l'école : c'est le conteneur qui ouvre la connexion vers l'extérieur, ce
qui fonctionne derrière une IP dynamique ou un partage 4G. Contrairement à Cloudflare, **aucun nom
de domaine n'est nécessaire** — d'où ce choix.

> **La contrepartie** : PC éteint, en veille ou sans Internet, **rien ne part sur le moment**.
> Mais rien n'est perdu non plus : les messages sont **mis en file d'attente** et repartent
> automatiquement dès que la passerelle revient — y compris les alertes déclenchées par un scan de
> carte, que personne n'aurait pensé à renvoyer à la main.
> [`evolution/keep-alive.ps1`](evolution/keep-alive.ps1) supprime les causes évitables (mise en
> veille, Docker non relancé après une coupure de courant) et signale ce qui reste à régler à la
> main. À lancer une fois à l'installation, puis après chaque grosse mise à jour de Windows.

**Railway** est la seule option qui continue d'envoyer quand le poste est éteint — utile si les
alertes doivent partir le soir ou le week-end. Basculer plus tard est rapide : changer
`EVOLUTION_BASE_URL`, redéployer, rescanner le QR.

Avant tout hébergement, `evolution/docker-compose.local.yml` permet de valider la chaîne complète
sur le PC de l'école, sans rien exposer.

### Vérifier l'installation

```powershell
# Le poste est-il prêt à tenir le service jour et nuit ? (rapport seul)
powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1

# La chaîne Vercel <-> passerelle est-elle complète ?
powershell -ExecutionPolicy Bypass -File evolution\check-gateway.ps1 `
  -BaseUrl https://VOTRE-PASSERELLE -ApiKey VOTRE_CLE -AppUrl https://VOTRE-APP.vercel.app
```

Le script contrôle la joignabilité de la passerelle, la clé API, l'état de la session, le webhook
déclaré, et le fait que l'application rejette bien les appels non signés — en indiquant pour chaque
échec la manœuvre à faire. Il détecte aussi les installations qui servent l'API sous `/api`.

### Première connexion

1. Renseigner les variables d'environnement (voir [`.env.example`](.env.example)).
2. Dans l'application : **Paramètres → WhatsApp**.
3. **Initialiser l'instance** — crée la session sur la passerelle et y enregistre l'adresse du
   webhook. À refaire après tout changement de domaine.
4. **Connecter WhatsApp** — un QR code s'affiche.
5. Sur le téléphone de l'école : WhatsApp → ⋮ → **Appareils connectés** → **Connecter un appareil**
   → scanner. Le badge passe au vert et le numéro lié s'affiche.

Le QR expire en moins d'une minute ; le bouton **Nouveau QR code** en génère un autre.

### Webhook

L'adresse est enregistrée automatiquement par « Initialiser l'instance ». Elle est dérivée
**uniquement de la configuration serveur** (`EVOLUTION_WEBHOOK_URL`, `NEXT_PUBLIC_SITE_URL`, ou
l'URL Vercel) — jamais d'un en-tête de la requête, qui serait falsifiable par l'appelant.

La passerelle ne signant pas ses appels, `/api/whatsapp/webhook` les authentifie par un **jeton
partagé** (`EVOLUTION_WEBHOOK_TOKEN`, comparé en temps constant) et vérifie que le champ
`server_url` du corps désigne bien la passerelle configurée. Toute requête qui échoue à l'un des
deux contrôles est rejetée en 401/403. Le endpoint met à jour les statuts
(`queued` → `sent` → `delivered` → `read` | `failed`) et enregistre les messages entrants.

### Règles d'exploitation

Ce sont elles qui décident si le numéro de l'école survit :

- n'écrire qu'aux **familles inscrites**, jamais à une liste importée ou achetée ;
- monter en charge progressivement : ~50 messages/jour la première semaine, ~200/jour ensuite ;
- **ne jamais retirer la temporisation** de `app/api/whatsapp/send/route.ts` (3 à 7 s entre deux
  messages, avec jitter) — c'est la principale protection contre le bannissement ;
- si des parents bloquent ou signalent les messages, arrêter et revoir le texte : c'est le signal
  qui précède le bannissement ;
- garder le téléphone lié connecté à Internet régulièrement, sinon WhatsApp délie l'appareil.

Un envoi groupé est découpé en lots de 8 destinataires, envoyés séquentiellement. Comptez environ
5 secondes par destinataire : 40 élèves ≈ 3 à 4 minutes, fenêtre ouverte.

## Déploiement sur Vercel

1. Importer ce dépôt sur [vercel.com/new](https://vercel.com/new) (framework détecté : Next.js, aucun réglage build à changer).
2. Dans **Project Settings → Environment Variables**, ajouter :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (secret — requis par `/api/admin/users` et le journal WhatsApp)
   - Variables **WhatsApp** (facultatif — messages WhatsApp) : `EVOLUTION_BASE_URL`,
     `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `EVOLUTION_WEBHOOK_TOKEN`
     (voir [`.env.example`](.env.example)). Aucune ne doit être préfixée `NEXT_PUBLIC_`.

   > **Ne pas définir `EVOLUTION_WEBHOOK_URL` sur Vercel.** Laissée vide, l'application dérive
   > l'adresse de rappel de son propre domaine de production. Renseignée avec une valeur locale
   > (`localhost`, `host.docker.internal`) recopiée depuis `.env.local`, elle ferait rappeler par la
   > passerelle une machine qui n'existe pas pour elle : les messages partiraient, mais aucun statut
   > de remise ni aucune réponse de parent ne reviendrait — sans erreur visible.

3. Déployer. Dans Supabase, ajouter l'URL Vercel aux **Auth → URL Configuration → Site URL / Redirect URLs**.
4. Reconnecter la session depuis **Paramètres → WhatsApp → Initialiser l'instance**, puis
   **Connecter WhatsApp** : l'instance de production est distincte de celle utilisée en local, il
   faut rescanner le QR code. « Initialiser » est aussi le geste à refaire après **tout changement
   de domaine**, côté Vercel comme côté passerelle — c'est lui qui réenregistre l'adresse du webhook.
5. Contrôler le tout avec `evolution\check-gateway.ps1` (voir plus haut).

> Les variables d'environnement ne sont lues qu'au déploiement : après en avoir ajouté ou modifié
> une, **redéployer** — un simple enregistrement ne suffit pas.

Le favicon et le logo affichés dans l'application suivent le logo téléversé dans **Paramètres** ;
les fichiers statiques `app/icon.png` / `app/favicon.ico` servent de secours avant le chargement.
