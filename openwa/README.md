# Passerelle WhatsApp (OpenWA)

L'application envoie ses messages WhatsApp via [OpenWA](https://github.com/rmyndharis/OpenWA),
une passerelle open source auto-hébergée. **OpenWA n'est pas une librairie npm** : c'est un
service à part (NestJS + Chromium) qui tourne dans son propre conteneur et expose une API REST.
L'application Next.js ne fait que l'appeler en HTTP depuis ses route handlers.

```
Next.js (Vercel ou local)  ──HTTPS + X-API-Key──▶  OpenWA (:2785)  ──▶  WhatsApp Web
```

## ⚠️ À lire avant de connecter un numéro

OpenWA passe par un client WhatsApp **non officiel** (WhatsApp Web piloté par Chromium), pas par
l'API Cloud de Meta. Conséquences concrètes :

- **Le risque de restriction du compte n'est jamais nul.** Utiliser un **numéro dédié** à l'école,
  jamais le numéro personnel du directeur.
- **Chauffer un numéro neuf** : quelques jours d'usage normal (discussions réelles, photo de
  profil, un groupe) avant d'automatiser quoi que ce soit.
- **Ne pas envoyer en rafale.** La limite est fixée à 20 messages / minute dans le compose ; c'est
  déjà généreux pour des alertes de solde. L'envoi groupé de l'application espace les messages.
- Les parents/élèves destinataires **s'attendent** à ces messages (alertes de solde de leur propre
  enfant) : c'est précisément le cas d'usage le moins risqué.

## 1. Démarrer la passerelle

```bash
cp openwa/.env.example openwa/.env
# éditer openwa/.env et remplacer API_MASTER_KEY par une valeur aléatoire :
#   openssl rand -hex 32

docker compose -f openwa/docker-compose.yml up -d
```

Le tableau de bord est sur <http://localhost:2785>. Se connecter avec la valeur de
`API_MASTER_KEY`.

## 2. Créer une clé API pour l'application

Dans le tableau de bord → **API Keys** → *Create key* :

- Rôle : **OPERATOR** (suffit pour envoyer ; ne peut pas créer d'autres clés)
- Copier la clé affichée : **elle n'est montrée qu'une seule fois**

## 3. Créer la session et scanner le QR code

Tableau de bord → **Sessions** → *Create session* (nom libre, par ex. `ecole`), puis **Start**.
Un QR code apparaît : le scanner depuis WhatsApp sur le téléphone de l'école
(*Appareils liés → Lier un appareil*). Le statut passe à `ready`.

Noter l'**ID de la session** (un UUID) affiché sur sa fiche.

> Le QR code est aussi accessible directement depuis l'application :
> **Paramètres → WhatsApp**, sans passer par le tableau de bord.

## 4. Brancher l'application

Dans `.env.local` à la racine du projet (et dans les variables d'environnement Vercel pour la
production) :

```bash
OPENWA_BASE_URL=http://localhost:2785
OPENWA_API_KEY=owa_k1_la-cle-operator-copiee-a-l-etape-2
OPENWA_SESSION_ID=l-uuid-de-la-session-de-l-etape-3
```

Redémarrer `npm run dev`. Les boutons WhatsApp des fiches élèves et parents sont alors actifs.

## Déploiement en production

> 📘 **Procédure pas-à-pas complète (VPS + Caddy TLS + variables Vercel) : [DEPLOY.md](DEPLOY.md).**
> Les fichiers prêts à l'emploi sont `docker-compose.prod.yml` et `Caddyfile`.

L'application est déployée sur Vercel, qui est **serverless** : OpenWA ne peut pas y tourner.
Il faut l'héberger ailleurs et le rendre joignable par Vercel :

1. Installer le compose ci-dessus sur un VPS (2 Go de RAM minimum pour une session Chromium).
2. Mettre un reverse-proxy TLS devant (Caddy ou nginx) — WhatsApp n'a rien à voir là-dedans,
   c'est pour que Vercel n'appelle pas la passerelle en clair sur Internet.
   Dans le compose, remplacer `127.0.0.1:2785:2785` par une exposition au proxy uniquement.
3. Sur Vercel, régler `OPENWA_BASE_URL=https://wa.mon-domaine.dz` et les deux autres variables.

`OPENWA_API_KEY` n'est **jamais** préfixée `NEXT_PUBLIC_` : elle ne doit pas atteindre le
navigateur. Tous les appels partent des route handlers `app/api/whatsapp/*`, qui vérifient
d'abord que l'appelant est `admin` ou `reception`.

## Sauvegarde

Tout l'état (authentification des sessions, clés API, base SQLite) vit dans le volume
`openwa-data`. Le perdre oblige à recréer la clé et à rescanner le QR code.

```bash
docker run --rm -v openwa_openwa-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/openwa-data.tar.gz -C /data .
```

## Dépannage

| Symptôme                                    | Cause probable                                                              |
| ------------------------------------------- | --------------------------------------------------------------------------- |
| `Passerelle WhatsApp non configurée`        | Les 3 variables `OPENWA_*` ne sont pas dans `.env.local`, ou pas rechargées |
| `Session non connectée (statut : qr_ready)` | Le QR code n'a pas encore été scanné → Paramètres → WhatsApp                |
| Statut `disconnected` après plusieurs jours | Le téléphone lié est resté trop longtemps hors ligne → rescanner            |
| Message accepté mais jamais reçu            | Premier contact avec un numéro inconnu : WhatsApp peut le filtrer côté serveur |

Un envoi renvoie « accepté », pas « délivré » : OpenWA confirme que le message a été remis au
client WhatsApp, pas qu'il est arrivé sur le téléphone du destinataire.
