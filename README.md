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

## Déploiement sur Vercel

1. Importer ce dépôt sur [vercel.com/new](https://vercel.com/new) (framework détecté : Next.js, aucun réglage build à changer).
2. Dans **Project Settings → Environment Variables**, ajouter :
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (secret — requis par `/api/admin/users` pour créer les comptes)
3. Déployer. Dans Supabase, ajouter l'URL Vercel aux **Auth → URL Configuration → Site URL / Redirect URLs**.

Le favicon et le logo affichés dans l'application suivent le logo téléversé dans **Paramètres** ;
les fichiers statiques `app/icon.png` / `app/favicon.ico` servent de secours avant le chargement.
