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

## Messages WhatsApp (Meta Cloud API)

Les fiches élèves et parents envoient des messages WhatsApp (alerte de dette, solde épuisé, solde
faible, frais d'inscription, ou message libre) via l'**API Cloud officielle de Meta** (WhatsApp
Business Platform). Plus de service auto-hébergé, plus de session WhatsApp Web, plus de QR code :
tout est hébergé par Meta et joignable directement depuis les routes Next.js.

```
Navigateur → /api/whatsapp/send → Graph API Meta → WhatsApp de la famille
WhatsApp → Webhook Meta → /api/whatsapp/webhook → Supabase
```

**Politique de messagerie.** Meta distingue deux cas :

- **Messages proactifs** (alertes automatiques du scan RFID, envois groupés, boutons d'alerte des
  fiches) → **modèles approuvés** par Meta, toujours délivrables.
- **Message libre** (« Message libre » dans la fenêtre d'envoi) → autorisé **uniquement** si la
  famille a écrit à l'école dans les dernières 24 h (fenêtre de service client). Hors fenêtre,
  l'envoi échoue avec un message explicite. La fenêtre est déterminée par les messages entrants
  réels remontés par le webhook — aucun minuteur local fictif.

### Configuration Meta (à faire une fois)

1. Créer un compte développeur Meta : <https://developers.facebook.com>.
2. Créer une **application** Meta (type *Business*).
3. Ajouter le produit **WhatsApp** à l'application.
4. Configurer / sélectionner le **WhatsApp Business Account (WABA)**.
5. Ajouter et **vérifier le numéro** de téléphone professionnel de l'école.
6. Relever le **Phone Number ID** (identifiant numérique, ≠ le numéro affiché) dans WhatsApp Manager.
7. Relever le **WABA ID** (WhatsApp Business Account ID).
8. Créer un **jeton d'accès permanent** via un *System User* (Business Settings → System Users),
   avec les permissions `whatsapp_business_messaging` et `whatsapp_business_management`.
9. Configurer le **webhook** (voir ci-dessous) et s'abonner au champ `messages`.
10. Renseigner les variables d'environnement (`.env.local` en local, Vercel en production) — voir
    [`.env.example`](.env.example). Aucun secret ne doit être préfixé par `NEXT_PUBLIC_`.
11. Créer et faire **approuver les modèles** de message (voir ci-dessous), puis mettre leurs noms
    exacts dans `WHATSAPP_TEMPLATE_*`.
12. Tester l'envoi depuis une fiche élève, et vérifier l'état dans **Paramètres → WhatsApp**.

### Webhook

- **URL de rappel** : `https://VOTRE-DOMAINE/api/whatsapp/webhook`
- **Verify token** : la valeur de `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- **Champ abonné** : `messages`

Le endpoint répond au GET de vérification de Meta et valide chaque POST par la **signature
`X-Hub-Signature-256`** (HMAC de l'App Secret) : les requêtes non signées sont refusées. Il met à
jour les statuts (`sent` → `delivered` → `read` | `failed`) et enregistre les messages entrants
(fenêtre de service client). En local, exposer le port via un tunnel HTTPS (ex. `ngrok`) le temps
des tests.

### Modèles de message requis

Créer ces modèles dans **WhatsApp Manager → Message templates** (catégorie *Utility*), en français
**et** en arabe si les deux langues sont utilisées, puis renseigner leurs noms exacts :

| Variable d'environnement             | Rôle                    | Variables du corps                                   |
| ------------------------------------ | ----------------------- | ---------------------------------------------------- |
| `WHATSAPP_TEMPLATE_BALANCE_DEBT`     | Alerte de dette         | `{{1}}` nom élève · `{{2}}` montant · `{{3}}` école |
| `WHATSAPP_TEMPLATE_BALANCE_EMPTY`    | Solde épuisé            | `{{1}}` nom élève · `{{2}}` montant · `{{3}}` école |
| `WHATSAPP_TEMPLATE_BALANCE_LOW`      | Solde bientôt épuisé    | `{{1}}` nom élève · `{{2}}` montant · `{{3}}` école |
| `WHATSAPP_TEMPLATE_REGISTRATION_DUE` | Frais d'inscription dus | `{{1}}` nom élève · `{{2}}` montant · `{{3}}` école |

Tant qu'un nom de modèle n'est pas configuré, l'alerte correspondante échoue avec une erreur claire
(elle n'est jamais envoyée en texte libre à la place). Sans aucune configuration WhatsApp, les
boutons affichent une erreur explicite et le reste de l'application fonctionne normalement.

## Déploiement sur Vercel

1. Importer ce dépôt sur [vercel.com/new](https://vercel.com/new) (framework détecté : Next.js, aucun réglage build à changer).
2. Dans **Project Settings → Environment Variables**, ajouter :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (secret — requis par `/api/admin/users` et le journal WhatsApp)
   - Variables **WhatsApp Cloud API** (facultatif — messages WhatsApp) : `META_APP_ID`,
     `META_APP_SECRET`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID`,
     `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_WEBHOOK_VERIFY_TOKEN`, `WHATSAPP_API_VERSION`, et les
     `WHATSAPP_TEMPLATE_*` (voir [`.env.example`](.env.example))
3. Déployer. Dans Supabase, ajouter l'URL Vercel aux **Auth → URL Configuration → Site URL / Redirect URLs**.

> L'API Cloud de Meta est hébergée par Meta : **aucun** service séparé, VPS, Docker, Caddy, tunnel
> permanent ni session WhatsApp Web n'est nécessaire. Le webhook `/api/whatsapp/webhook` fonctionne
> directement en serverless — il suffit qu'il soit joignable en HTTPS public (l'URL Vercel).

Le favicon et le logo affichés dans l'application suivent le logo téléversé dans **Paramètres** ;
les fichiers statiques `app/icon.png` / `app/favicon.ico` servent de secours avant le chargement.
