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
cp .env.example .env.local   # puis remplir les 3 variables
npm run dev
```

## Base de données

1. Créer un projet Supabase, puis exécuter `supabase/schema.sql` dans **Dashboard → SQL Editor**.
2. Exécuter ensuite chaque fichier de `supabase/migrations/` (dans l'ordre des dates).
3. Créer le premier compte admin depuis la page de connexion (« Créer un compte admin »).

## Messages WhatsApp

Les fiches élèves et parents peuvent envoyer un message WhatsApp (alerte de dette, solde épuisé,
frais d'inscription, ou message libre) via [OpenWA](https://github.com/rmyndharis/OpenWA), une
passerelle open source **auto-hébergée** — un service à part, pas une dépendance npm.

Mise en route complète : **[`openwa/README.md`](openwa/README.md)**. En résumé :

```bash
cp openwa/.env.example openwa/.env      # y mettre une API_MASTER_KEY aléatoire
docker compose -f openwa/docker-compose.yml up -d
```

puis créer une clé et une session dans le tableau de bord (<http://localhost:2785>), renseigner
`OPENWA_BASE_URL` / `OPENWA_API_KEY` / `OPENWA_SESSION_ID` dans `.env.local`, et scanner le QR code
depuis **Paramètres → WhatsApp**. Sans ces variables, les boutons affichent une erreur explicite
et le reste de l'application fonctionne normalement.

## Déploiement sur Vercel

1. Importer ce dépôt sur [vercel.com/new](https://vercel.com/new) (framework détecté : Next.js, aucun réglage build à changer).
2. Dans **Project Settings → Environment Variables**, ajouter :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (secret — requis par `/api/admin/users` pour créer les comptes)
   - `OPENWA_BASE_URL`, `OPENWA_API_KEY`, `OPENWA_SESSION_ID` (facultatif — messages WhatsApp)
3. Déployer. Dans Supabase, ajouter l'URL Vercel aux **Auth → URL Configuration → Site URL / Redirect URLs**.

> Vercel étant *serverless*, la passerelle OpenWA ne peut pas y tourner : elle doit être hébergée
> sur un VPS joignable depuis Vercel (voir `openwa/README.md`).

Le favicon et le logo affichés dans l'application suivent le logo téléversé dans **Paramètres** ;
les fichiers statiques `app/icon.png` / `app/favicon.ico` servent de secours avant le chargement.
