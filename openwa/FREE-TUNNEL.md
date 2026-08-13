# Faire fonctionner WhatsApp sur le site en ligne — GRATUITEMENT (tunnel)

Sans VPS ni nom de domaine. On expose la passerelle OpenWA qui tourne déjà sur
le PC de l'école à une URL publique HTTPS, puis on branche Vercel dessus.

```
Vercel (site en ligne)  ──HTTPS──▶  URL publique du tunnel  ──▶  PC de l'école :2785 (OpenWA)  ──▶  WhatsApp
```

> ⚠️ **Condition du gratuit :** le site en ligne n'enverra des WhatsApp que
> **pendant que le PC de l'école est allumé**, avec Docker et le tunnel en marche.
> Comme ce PC tourne déjà toute la journée pour les scans RFID, les alertes de
> solde partent pendant les heures d'ouverture. Le soir / week-end (PC éteint),
> les envois sont en pause. Pour du 24/7, voir [DEPLOY.md](DEPLOY.md) (petit VPS).

Deux variantes. **A** = test immédiat (URL temporaire). **B** = solution
gratuite durable (URL stable) — **recommandée**.

---

## A. Test immédiat — Cloudflare Quick Tunnel (URL temporaire, sans compte)

Utile pour vérifier tout de suite. **L'URL est aléatoire et change à chaque
redémarrage** — donc à ne pas garder pour un usage réel.

```bash
# La passerelle locale doit déjà tourner (docker compose ... up -d)
docker run -d --name owa-tunnel --network openwa_default \
  cloudflare/cloudflared:latest tunnel --url http://openwa:2785

# Récupérer l'URL publique :
docker logs owa-tunnel 2>&1 | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com'
```

Mettre cette URL dans `OPENWA_BASE_URL` côté Vercel (voir §Vercel), redéployer,
tester. Pour arrêter : `docker rm -f owa-tunnel`.

---

## B. Solution gratuite durable — ngrok (URL stable, sans domaine)

ngrok offre **un domaine statique gratuit** par compte (ex.
`benzaoui-ecole.ngrok-free.app`) qui **ne change jamais**. Idéal : on ne
configure Vercel qu'une fois.

### 1. Compte + domaine + authtoken (gratuit)
1. Créer un compte sur <https://dashboard.ngrok.com> (gratuit).
2. **Domains → Create Domain** → réserver le domaine statique gratuit proposé.
   Noter sa valeur, ex. `benzaoui-ecole.ngrok-free.app`.
3. **Your Authtoken** → copier le jeton.

### 2. Renseigner openwa/.env (sur le PC de l'école)
Ajouter ces deux lignes à `openwa/.env` (fichier jamais commité) :

```bash
NGROK_AUTHTOKEN=<votre authtoken>
NGROK_DOMAIN=benzaoui-ecole.ngrok-free.app
```

### 3. Démarrer la passerelle + le tunnel
```bash
docker compose -f openwa/docker-compose.yml -f openwa/docker-compose.tunnel.yml \
  --env-file openwa/.env up -d
docker compose -f openwa/docker-compose.yml -f openwa/docker-compose.tunnel.yml ps
```

L'URL publique stable est `https://benzaoui-ecole.ngrok-free.app`. Vérifier :

```bash
curl https://benzaoui-ecole.ngrok-free.app/api/health/ready   # -> {"status":"ok",...}
```

> Si un jour un appel API reçoit une **page d'avertissement ngrok** au lieu du
> JSON : c'est l'interstitiel du plan gratuit, déclenché pour les navigateurs.
> Les appels serveur→serveur de Vercel n'envoient pas `Accept: text/html` et
> passent normalement. Au besoin, ngrok l'ignore si la requête porte l'en-tête
> `ngrok-skip-browser-warning`.

---

## Vercel — brancher le site en ligne (les deux variantes)

Dans **Vercel → projet → Settings → Environment Variables** (Production) :

| Variable            | Valeur                                                              |
| ------------------- | ------------------------------------------------------------------ |
| `OPENWA_BASE_URL`   | l'URL du tunnel (A : `https://…trycloudflare.com` · B : `https://…ngrok-free.app`) |
| `OPENWA_API_KEY`    | la clé **opérateur** — à copier depuis votre `.env.local` local    |
| `OPENWA_SESSION_ID` | l'UUID de session — à copier depuis votre `.env.local` local       |

> Ne **jamais** préfixer par `NEXT_PUBLIC_`. Ces valeurs restent côté serveur.

Puis **Vercel → Deployments → Redeploy** (les variables ne sont lues qu'au
déploiement suivant). Sur le site en ligne, connecté en `admin`/`reception` :
**Paramètres → WhatsApp** doit afficher **« Connectée »** et le numéro lié.
Faire un premier envoi de test **vers votre propre numéro**.

## Sécurité

La passerelle devient joignable publiquement : sa seule protection est la **clé
opérateur** (`OPENWA_API_KEY`). Ne la divulguez pas, ne la mettez jamais dans le
navigateur/`NEXT_PUBLIC_`. Le numéro WhatsApp doit rester dédié à l'école.
