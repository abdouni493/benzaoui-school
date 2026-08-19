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
Navigateur → /api/whatsapp/send → passerelle Evolution (VPS) → WhatsApp de la famille
WhatsApp → passerelle → /api/whatsapp/webhook → Supabase (statuts, messages entrants)
```

> ### ⚠️ À lire avant de mettre en service
>
> - **La passerelle exige une machine allumée en permanence.** Vercel est serverless : il ne peut
>   pas l'héberger. Si le serveur est éteint, **aucun message ne part** — silencieusement.
> - **Le numéro utilisé peut être banni par WhatsApp**, sans préavis ni recours, en cas d'envoi
>   massif ou de plaintes des destinataires. Utilisez un numéro dédié à l'école, jamais un numéro
>   personnel. Ce risque n'existait pas avec un fournisseur officiel : c'est la contrepartie de la
>   gratuité.
> - Une mise à jour de WhatsApp peut casser la passerelle quelques jours. C'est rare, mais possible.

**Ce que la migration a apporté.** Plus aucun modèle à faire approuver : les quatre alertes sont du
texte libre FR/AR, modifiables immédiatement dans `lib/whatsapp/templates.ts` ou directement dans la
fenêtre d'envoi. Plus de fenêtre de service client de 24 h : l'école écrit quand elle veut. Et le
coût par message est nul, quel que soit le volume.

### Installation de la passerelle

Procédure complète (VPS, Docker, Caddy, TLS) dans **[`evolution/README.md`](evolution/README.md)**.
En résumé :

1. Louer un VPS (2 vCPU / 2 Go suffisent — Hetzner CX22 ≈ 4 €/mois) sous Ubuntu 24.04.
2. Pointer un sous-domaine (`wa.votre-domaine.dz`) en enregistrement **A** vers l'IP du VPS.
3. Installer Docker, copier `evolution/docker-compose.yml` et `evolution/Caddyfile`, générer les
   secrets dans `evolution/.env`, puis `docker compose up -d`.
4. Vérifier que l'API répond et **noter l'URL de base exacte** — certaines installations servent
   l'API sous `/api` :
   ```bash
   curl -s https://wa.votre-domaine.dz/instance/fetchInstances -H "apikey: VOTRE_CLE"
   ```

Pour un essai **sans VPS**, `evolution/docker-compose.local.yml` fait tourner la même passerelle sur
le poste de l'école. Pratique pour valider la chaîne avant de payer un serveur — mais les envois
s'arrêtent dès que le PC est éteint.

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
3. Déployer. Dans Supabase, ajouter l'URL Vercel aux **Auth → URL Configuration → Site URL / Redirect URLs**.
4. Reconnecter la session depuis **Paramètres → WhatsApp** : l'instance de production est distincte
   de celle utilisée en local, il faut rescanner le QR code.

> Les variables d'environnement ne sont lues qu'au déploiement : après en avoir ajouté ou modifié
> une, **redéployer** — un simple enregistrement ne suffit pas.

Le favicon et le logo affichés dans l'application suivent le logo téléversé dans **Paramètres** ;
les fichiers statiques `app/icon.png` / `app/favicon.ico` servent de secours avant le chargement.
