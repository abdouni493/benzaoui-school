# Passerelle WhatsApp — Evolution API

Ce dossier contient tout ce qui fait tourner la passerelle WhatsApp de l'école.
Elle est **séparée de l'application** : Vercel est serverless et ne peut pas maintenir une session
WhatsApp ouverte.

| Fichier | Rôle |
| --- | --- |
| `docker-compose.yml` | Production : passerelle + Postgres + Redis + Caddy (HTTPS) |
| `docker-compose.local.yml` | Essai local sur le poste de l'école : passerelle + Postgres, sans TLS |
| `Caddyfile` | Reverse proxy et certificat Let's Encrypt automatique |
| `qr.ps1` | Affiche un QR code de connexion depuis Windows, sans passer par l'application |
| `.env` | Secrets — **jamais commité** (couvert par `.gitignore`) |

---

## A. Essai local (gratuit, ~20 min)

À faire **avant** de louer un VPS : cela valide toute la chaîne sans rien dépenser.

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

Puis dans l'application : **Paramètres → WhatsApp → Initialiser → Connecter →** scanner le QR.

**Limite de ce mode** : les envois s'arrêtent dès que le PC est éteint ou en veille.

---

## B. Production (VPS, ~4 €/mois)

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

### 5. Variables dans Vercel

**Settings → Environment Variables** (Production *et* Preview) :

```
EVOLUTION_BASE_URL=https://wa.VOTRE-VRAI-DOMAINE
EVOLUTION_API_KEY=<la clé de l'étape 3>
EVOLUTION_INSTANCE=benzaoui
EVOLUTION_WEBHOOK_TOKEN=<une NOUVELLE valeur, différente de la clé API>
```

Puis **redéployer** : les variables ne sont lues qu'au déploiement.

### 6. Connecter le téléphone

**Paramètres → WhatsApp → Initialiser l'instance → Connecter WhatsApp →** scanner le QR code.

L'instance de production est **distincte** de celle utilisée en local : il faut rescanner, même si
le téléphone était déjà lié à la passerelle locale.

---

## Exploitation

### Commandes utiles

```bash
docker compose logs -f evolution      # journaux en direct
docker compose restart evolution      # redémarrer la passerelle
docker compose pull && docker compose up -d   # mettre à jour l'image
docker compose down                   # arrêter (les volumes sont conservés)
```

La session WhatsApp survit aux redémarrages : elle est stockée dans le volume
`evolution_instances`. Un `docker compose down -v` la détruirait — il faudrait alors rescanner.

### Sauvegarde

Le volume `evolution_instances` contient les identifiants de session. Sans lui, il faut rescanner le
QR code — ce n'est pas dramatique, mais c'est un déplacement au secrétariat.

```bash
docker run --rm -v evolution_evolution_instances:/data -v $(pwd):/backup \
  alpine tar czf /backup/whatsapp-session.tar.gz -C /data .
```

### Protéger le numéro

C'est le point qui décide de la survie du service :

- n'écrire qu'aux **familles inscrites**, jamais à une liste importée ;
- ~50 messages/jour la première semaine, ~200/jour ensuite ;
- **ne jamais désactiver la temporisation** de `app/api/whatsapp/send/route.ts` ;
- surveiller les blocages : si des parents signalent les messages, arrêter et revoir le texte.

Un numéro banni par WhatsApp l'est **sans recours**. Utilisez un numéro dédié à l'école.

### Diagnostic

| Symptôme | Cause probable |
| --- | --- |
| « Passerelle WhatsApp injoignable » | Conteneur arrêté, ou `EVOLUTION_BASE_URL` erroné |
| « Clé API refusée » | `EVOLUTION_API_KEY` différent entre Vercel et `evolution/.env` |
| « Instance introuvable » | Cliquer sur **Initialiser l'instance** dans Paramètres |
| « WhatsApp n'est pas connecté » | Session tombée : rescanner le QR code |
| Statuts bloqués sur `queued` | Le webhook n'arrive pas : jeton, URL, ou HTTPS non joignable |
| 401 en boucle dans les journaux | `EVOLUTION_WEBHOOK_TOKEN` différent entre Vercel et l'instance — recliquer sur **Initialiser** |
