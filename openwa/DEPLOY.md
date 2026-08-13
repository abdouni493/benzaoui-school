# Déployer la passerelle WhatsApp pour le site en ligne (Vercel)

Le site déployé (`benzaoui-school.vercel.app`) est **serverless** : il ne peut pas
faire tourner OpenWA, ni joindre le `localhost:2785` de votre PC. Tant que les
variables `OPENWA_*` de Vercel ne pointent pas vers une passerelle **joignable
depuis Internet**, l'appli renvoie `503 « Passerelle WhatsApp non configurée »`.
C'est le comportement normal, pas un bug de code.

```
Vercel (cloud)  ──HTTPS──▶  https://wa.mon-ecole.dz  (VPS : Caddy TLS ──▶ OpenWA)  ──▶  WhatsApp
```

Ce guide met OpenWA sur un petit **VPS toujours allumé**, derrière HTTPS, et
branche Vercel dessus. Aucune modification du code de l'application n'est requise.

---

## Prérequis

- Un **VPS** Linux (≈ 2 Go de RAM pour une session Chromium ; Ubuntu 22.04+).
- Un **nom de domaine** ou sous-domaine, ex. `wa.mon-ecole.dz`, avec un
  enregistrement **A** vers l'IP du VPS. Ports **80** et **443** ouverts.
- Un **numéro WhatsApp dédié** à l'école (idéalement pas un numéro personnel).
  Vous avez déjà lié `+213 799 047 248` en local — voir l'étape 4 pour le
  réutiliser ou repartir de zéro.

---

## Étape 1 — Installer Docker sur le VPS

```bash
curl -fsSL https://get.docker.com | sh
```

## Étape 2 — Copier la configuration OpenWA sur le VPS

Copiez le dossier `openwa/` du dépôt sur le VPS (git clone, `scp`, etc.), puis
créez `openwa/.env` **sur le VPS** (il n'est jamais commité) :

```bash
cd openwa
cat > .env <<'EOF'
API_MASTER_KEY=<UNE VALEUR ALÉATOIRE 64 hex — voir ci-dessous>
OPENWA_DOMAIN=wa.mon-ecole.dz
RATE_LIMIT_MAX=20
RATE_LIMIT_WINDOW_MS=60000
EOF
```

- Générer une clé maître : `openssl rand -hex 32`.
- **Si vous migrez la session locale (Étape 4, chemin A), réutilisez la MÊME
  `API_MASTER_KEY` que votre `openwa/.env` local** — sinon la clé opérateur et la
  session migrées ne seront pas reconnues.

## Étape 3 — Démarrer la passerelle (OpenWA + Caddy TLS)

```bash
docker compose -f docker-compose.prod.yml --env-file .env up -d
docker compose -f docker-compose.prod.yml ps          # openwa doit passer « healthy »
```

Caddy obtient tout seul un certificat Let's Encrypt pour `OPENWA_DOMAIN`
(le domaine doit résoudre vers le VPS et 80/443 être ouverts). Vérifier :

```bash
curl https://wa.mon-ecole.dz/api/health/ready         # -> {"status":"ok",...}
```

## Étape 4 — Session WhatsApp + clé opérateur

Deux chemins. **A** garde le numéro déjà lié et les valeurs Vercel identiques ;
**B** repart de zéro sur le VPS.

### Chemin A — Migrer la session déjà liée (recommandé)

Conserve `+213 799 047 248` déjà connecté, la clé opérateur et l'UUID de session
existants (donc rien à changer côté Vercel plus tard).

**Sur le PC local** (sauvegarde du volume) :

```bash
docker run --rm -v openwa_openwa-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/openwa-data.tar.gz -C /data .
```

Copier `openwa-data.tar.gz` sur le VPS, puis **sur le VPS** :

```bash
docker compose -f docker-compose.prod.yml down          # sans -v : NE PAS supprimer le volume
docker run --rm -v openwa_openwa-data:/data -v "$PWD":/backup alpine \
  sh -c "rm -rf /data/* && tar xzf /backup/openwa-data.tar.gz -C /data"
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

> Le `openwa/.env` du VPS doit contenir la **même** `API_MASTER_KEY` que le local.
> Les valeurs `OPENWA_API_KEY` et `OPENWA_SESSION_ID` à mettre dans Vercel sont
> alors **exactement celles de votre `.env.local`** (étape 5).

### Chemin B — Repartir de zéro sur le VPS

1. Ouvrir le tableau de bord `https://wa.mon-ecole.dz`, se connecter avec
   `API_MASTER_KEY`.
2. **API Keys → Create** : rôle **OPERATOR**, nom `ecole-app`. Copier la clé
   (affichée une seule fois) → ce sera `OPENWA_API_KEY`.
3. **Sessions → Create** (nom `ecole`) → **Start** → scanner le QR avec le
   téléphone de l'école. Noter l'**UUID** de la session → ce sera
   `OPENWA_SESSION_ID`.

## Étape 5 — Brancher Vercel

Dans **Vercel → votre projet → Settings → Environment Variables**, ajouter (pour
Production, et Preview si besoin) :

| Variable            | Valeur                                                        |
| ------------------- | ------------------------------------------------------------ |
| `OPENWA_BASE_URL`   | `https://wa.mon-ecole.dz`                                     |
| `OPENWA_API_KEY`    | la clé **opérateur** (chemin A : copier depuis `.env.local`) |
| `OPENWA_SESSION_ID` | l'UUID de session (chemin A : copier depuis `.env.local`)    |

> ⚠️ Ne **jamais** préfixer par `NEXT_PUBLIC_` : ces valeurs sont serveur
> uniquement. Ne les collez que dans Vercel, pas dans le code.

## Étape 6 — Redéployer et vérifier

Vercel → **Deployments → Redeploy** (les variables d'env ne sont prises en compte
qu'au déploiement suivant). Puis, sur le site en ligne, connecté en `admin` /
`reception` : **Paramètres → WhatsApp** doit afficher **« Connectée »** et le
numéro lié. Faire un envoi de test **vers votre propre numéro** d'abord.

---

## Sécurité & fiabilité

- OpenWA n'est exposé **que** via Caddy (TLS) ; le port 2785 n'est pas publié.
  L'API est protégée par la **clé opérateur**. Ne publiez jamais 2785 en clair.
- **Numéro dédié + montée en charge douce** : WhatsApp restreint les clients non
  officiels. Garder la limite à ~20 msg/min (déjà réglée), privilégier les
  alertes aux familles inscrites (elles s'y attendent).
- Le téléphone lié doit rester joignable ; une longue coupure force un rescan.
- **Sauvegarde** régulière du volume `openwa-data` (commande de l'Étape 4-A).

## Alternative (plus tard) : API officielle WhatsApp Cloud (Meta)

Si vous voulez zéro maintenance et aucun risque de bannissement : l'API Cloud de
Meta s'appelle en HTTPS **directement depuis Vercel, sans VPS**. En contrepartie :
vérification d'un compte Meta Business, **modèles de messages pré-approuvés**, et
un coût par message. Côté code, seul `lib/whatsapp/client.ts` (le transport)
changerait — routes, modèles, normalisation des numéros et intégration au scan
restent identiques. À considérer si le volume grandit ou si OpenWA pose problème.

## Exploitation courante (VPS)

```bash
docker compose -f openwa/docker-compose.prod.yml ps                 # état
docker compose -f openwa/docker-compose.prod.yml logs --tail 100    # logs
docker compose -f openwa/docker-compose.prod.yml restart            # redémarrer
docker compose -f openwa/docker-compose.prod.yml down               # arrêter (SANS -v)
```

> Ne jamais utiliser `down -v` : cela supprime le volume `openwa-data` (session
> WhatsApp + clés) et oblige à tout recréer.
