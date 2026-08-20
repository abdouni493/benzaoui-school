# Appliquer la passerelle WhatsApp à un autre projet

Guide pas à pas pour rejouer ce montage sur un **second projet** (autre école, autre application),
en réutilisant tout ce qui peut l'être.

Le prompt à donner à Claude Code est dans [`whatsapp_promp.md`](whatsapp_promp.md).
Ce fichier-ci explique **ce qu'il faut décider avant**, ce qu'il **ne faut pas refaire**, et les
**trois pièges** propres à un deuxième projet.

---

## 0. D'abord, la contrepartie — la même qu'ici

**Le poste doit rester allumé.** Éteint, en veille, ou sans Internet ⇒ **aucun message ne part**, et
personne n'est prévenu : l'envoi échoue en silence.

C'est le prix de la gratuité : on ne loue pas de machine, donc une machine que l'on possède fait le
travail. `keep-alive.ps1` supprime les causes évitables (veille, Docker non relancé après une
coupure) ; il ne peut rien contre un poste débranché.

Si cela devient inacceptable — des alertes qui doivent partir le soir ou le week-end — **Railway à
7–10 $/mois** est la seule réponse, et la bascule prend 20 minutes : changer `EVOLUTION_BASE_URL`,
redéployer, rescanner le QR.

---

## 0 bis. Sur QUEL poste faire tourner la passerelle ?

**Sur le poste de l'organisation cliente — jamais sur celui du développeur.**

```
École A  ──►  SON poste (passerelle A)  ──►  benzaoui-wa.tail6ac334.ts.net
École B  ──►  SON poste (passerelle B)  ──►  annaba-wa.tail6ac334.ts.net
Poste du développeur  ──►  hors du circuit
```

C'est le point qui décide de tout le reste. Chaque école héberge sa propre passerelle, avec son
propre nœud Tailscale et son propre numéro WhatsApp. Le poste du développeur peut rester éteint en
permanence : chaque école continue d'envoyer.

Ce choix tombe juste pour une raison simple : **le poste de l'école est déjà allumé pendant les
heures de cours** — c'est celui qui scanne les cartes RFID, saisit les présences et encaisse. La
passerelle est donc disponible exactement quand l'établissement fonctionne, et les alertes
automatiques de solde partent de la machine qui lit les cartes. Elles ne peuvent pas échouer faute
de passerelle joignable : c'est la même machine.

### Ce que la séparation des postes supprime

| | Même poste | Postes séparés |
| --- | --- | --- |
| `name:` Compose distinct (piège 2.1) | obligatoire | **inutile** |
| Port local distinct (piège 2.2) | obligatoire | **inutile** |
| Mémoire partagée (piège 2.4) | à surveiller | **inutile** |
| Nom de nœud distinct | obligatoire | obligatoire |
| Numéro WhatsApp distinct | obligatoire | obligatoire |

Autrement dit : **le second établissement est plus simple à installer que le premier**, dès lors
qu'il a son propre poste. Il suffit de choisir un `TAILSCALE_HOSTNAME` différent.

### Un seul compte Tailscale, et un bénéfice inattendu

Tous ces postes rejoignent **votre** tailnet. Vous gardez un compte unique, voyez chaque
établissement dans **Machines**, et l'attribut `funnel` des ACL couvre déjà les nouveaux nœuds.

Bénéfice : chaque passerelle étant dans votre tailnet, **vous pouvez la diagnostiquer depuis votre
propre poste**, sans vous déplacer — `check-gateway.ps1` fonctionne à distance dès que votre machine
est elle aussi connectée au tailnet.

### Les limites, dites franchement

- **Chaque poste doit être allumé pour les messages de SON établissement.** L'école A éteinte
  n'empêche pas l'école B d'envoyer, mais l'école A n'envoie rien.
- **Docker Desktop doit être installé sur chaque poste** : Windows 10/11 avec WSL2, et
  réalistement 8 Go de RAM (la passerelle ne pèse que ~260 Mo, mais la machine virtuelle WSL2 en réserve 2 à 3). Un poste d'accueil très ancien peinera.
- **`keep-alive.ps1 -Apply` doit être passé une fois sur chaque poste** (droits administrateur), et
  l'ouverture de session automatique activée si l'on veut une reprise sans intervention après une
  coupure de courant.

---

## 1. Faut-il un nouveau compte Tailscale ? **Non.**

C'est la bonne nouvelle : **un seul compte Tailscale suffit pour tous vos projets.** Un tailnet
héberge autant de machines que nécessaire, et chacune obtient sa propre adresse publique :

```
benzaoui-wa.tail6ac334.ts.net     ← projet 1
annaba-wa.tail6ac334.ts.net       ← projet 2   (même compte, même tailnet)
```

Seule change la **première moitié** du nom — c'est-à-dire `TAILSCALE_HOSTNAME`. La seconde moitié,
le nom du tailnet, reste la même pour toujours.

### Ce qui est donc DÉJÀ FAIT et ne se refait pas

| Étape de la première installation | À refaire ? |
| --- | --- |
| Créer le compte Tailscale | **Non** |
| Activer MagicDNS | **Non** |
| Activer les certificats HTTPS | **Non** |
| Autoriser le Funnel dans les ACL | **Non** — l'attribut vise `autogroup:member`, donc **tout nouveau nœud du même tailnet en hérite automatiquement** |
| Générer une clé d'authentification | **Non**, si la clé est **Reusable** et non expirée |

Autrement dit : les étapes 1 à 4 de l'installation d'origine — celles qui ont coûté le plus de temps,
notamment les ACL — **sont derrière vous définitivement**.

### Ce qui reste obligatoire pour chaque projet

| | Pourquoi |
| --- | --- |
| Un **nom de nœud** différent (`TAILSCALE_HOSTNAME`) | Il donne l'adresse publique ; deux projets ne peuvent pas la partager |
| Un **numéro WhatsApp** différent | Une instance = un téléphone lié. Deux projets sur un même numéro mélangeraient les conversations |
| Un **nom de projet Docker** différent | **Voir piège 2.1 — c'est le plus grave** |
| **Désactiver l'expiration de la clé** du nouveau nœud | Sinon déconnexion silencieuse après quelques mois |

---

## 2. Les trois pièges propres à un second projet

### 2.1 Collision de volumes Docker — **le plus grave**

Docker Compose nomme le projet d'après le **dossier contenant le fichier compose**. Si vos deux
dépôts ont chacun un dossier `evolution/`, les deux montages s'appellent `evolution` et **partagent
donc exactement les mêmes volumes** :

```
evolution_evolution_instances   ← la session WhatsApp… des DEUX projets
evolution_postgres_data         ← la base… des DEUX projets
```

Conséquence : deux écoles sur une seule session WhatsApp, ou une base écrasée par l'autre.

**Correctif — sur le NOUVEAU projet uniquement**, ajouter en tête du fichier compose :

```yaml
name: annaba-wa      # nom de projet Compose distinct

services:
  evolution:
    ...
```

Vérifier avant de démarrer :

```powershell
docker compose -f evolution/docker-compose.funnel.yml config | Select-String "^name:"
```

> ⚠️ **Ne jamais ajouter ou modifier `name:` sur un projet déjà en service.** Le nom des volumes en
> dépend : les volumes existants deviendraient orphelins, la session WhatsApp serait perdue, et il
> faudrait rescanner le QR.

### 2.2 Conflit de port local

Le premier montage publie `127.0.0.1:8081`. Le second doit prendre un autre port :

```yaml
ports:
  - "127.0.0.1:8082:8080"
```

Sans cela, le second conteneur refuse de démarrer — avec une erreur de port qui ne dit rien de la
vraie cause.

### 2.3 Un numéro WhatsApp par projet

Une instance Evolution lie **un** téléphone. Prévoir une carte SIM / un numéro dédié par
organisation, et ne jamais réutiliser un numéro déjà lié à un autre projet.

### 2.4 Si les deux tournent sur la même machine — les ressources

**Mesure réelle en service** (`docker stats`), et non une estimation :

| Conteneur | Mémoire | CPU |
| --- | --- | --- |
| `evolution` | 191 Mo | ~0 % |
| `postgres` | 46 Mo | ~1 % |
| `tailscale` | 21 Mo | ~0 % |
| **Total** | **≈ 260 Mo** | **négligeable** |

La passerelle elle-même est donc légère. **Le vrai coût, c'est Docker Desktop et sa machine
virtuelle WSL2**, qui réserve 2 à 3 Go quel que soit le nombre de conteneurs. Doubler les piles
n'ajoute que ~260 Mo, mais un `next dev` par-dessus, lui, pèse lourd : c'est la combinaison qui
étouffe un poste, pas la passerelle. Vérifier `.wslconfig` avant de doubler.

**Deux machines séparées évitent tous ces pièges** (2.1, 2.2, 2.4) : chacune a ses propres volumes,
ses propres ports, sa propre mémoire. Seul le nom de nœud reste à différencier.

---

## 3. Marche à suivre, étape par étape

### Étape 1 — Faire écrire le code par Claude Code

Ouvrir [`whatsapp_promp.md`](whatsapp_promp.md), remplir le bloc **« Contexte du projet »**, puis
donner tout ce qui suit la ligne de séparation à Claude Code.

Il produira : les fichiers d'infrastructure, l'intégration applicative (routes, module client), le
**panneau de réglages avec QR code**, et les scripts de diagnostic.

### Étape 2 — Différencier le montage (à faire faire, ou à la main)

Dans le compose du nouveau projet :

```yaml
name: <projet>-wa                      # piège 2.1
services:
  evolution:
    ports:
      - "127.0.0.1:8082:8080"          # piège 2.2
```

Et dans `.env` : `TAILSCALE_HOSTNAME=<projet>-wa`.

### Étape 3 — Tailscale : presque rien à faire

1. **Settings → Keys** : réutiliser la clé **Reusable** existante si elle n'a pas expiré, sinon en
   générer une nouvelle (**Reusable**, **jamais Ephemeral**).
2. C'est tout. Ni compte, ni MagicDNS, ni HTTPS, ni ACL — déjà en place.

### Étape 4 — Renseigner `evolution/.env`

```
TAILSCALE_AUTHKEY=<la clé réutilisable>
TAILSCALE_HOSTNAME=<projet>-wa
TUNNEL_PUBLIC_URL=https://<projet>-wa.tail6ac334.ts.net
EVOLUTION_API_KEY=<nouvelle chaîne aléatoire, propre à ce projet>
POSTGRES_PASSWORD=<nouvelle chaîne aléatoire, propre à ce projet>
```

Générer les valeurs aléatoires :

```powershell
-join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Max 256) })
```

**Ne pas réutiliser la clé API de l'autre projet** : deux organisations ne doivent pas partager un
secret.

### Étape 5 — Démarrer, et vérifier le nom obtenu

```powershell
docker compose -f evolution/docker-compose.funnel.yml up -d
docker compose -f evolution/docker-compose.funnel.yml logs -f tailscale
```

Le nom doit être **exactement** `<projet>-wa.tail6ac334.ts.net`. **Un suffixe `-1` signifie qu'un
nœud porte déjà ce nom** : le supprimer dans **Machines**, puis `down` et `up -d`.

### Étape 6 — Vérifier que le Funnel est réellement accordé

`funnel status` ne fait pas foi (piège 6.7 du prompt) :

```powershell
docker exec <projet>-wa-tailscale tailscale status --json | Select-String "funnel"
```

Doit contenir `funnel` **et** `funnel-ports`. Normalement acquis d'office ici, puisque les ACL du
tailnet couvrent déjà `autogroup:member`.

### Étape 7 — Rendre le poste apte au service continu

Dans un PowerShell **administrateur** :

```powershell
powershell -ExecutionPolicy Bypass -File evolution\keep-alive.ps1 -Apply
```

Inutile si c'est la **même machine** que le premier projet et que le script y a déjà été appliqué :
les réglages d'alimentation et le démarrage de Docker sont communs au poste.

### Étape 8 — Variables d'environnement de l'hébergeur, puis redéployer

`EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `EVOLUTION_WEBHOOK_TOKEN`.
**Ne pas définir `EVOLUTION_WEBHOOK_URL`.** Puis **redéployer** — les variables ne sont lues qu'au
déploiement.

### Étape 9 — Connecter le téléphone

Sur le site **déployé** (jamais depuis `localhost`, sinon le webhook pointera vers votre machine) :

**Réglages → WhatsApp → Initialiser l'instance → Connecter WhatsApp →** scanner avec le téléphone
de l'organisation.

### Étape 10 — Vérifier toute la chaîne

```powershell
powershell -ExecutionPolicy Bypass -File evolution\check-gateway.ps1 `
  -BaseUrl https://<projet>-wa.tail6ac334.ts.net `
  -ApiKey  <la clé du projet> `
  -AppUrl  https://<domaine-du-projet>
```

Les cinq contrôles doivent passer. Puis envoyer un vrai message et vérifier qu'il atteint
**`delivered`** : franchir `queued` est la seule preuve que la boucle est complète.

### Étape 11 — Désactiver l'expiration de la clé

**Machines → `<projet>-wa` → ⋯ → Disable key expiry.**
Sans ce clic, le nœud se déconnecte au bout de quelques mois et **les envois s'arrêtent sans aucun
avertissement**. C'est l'oubli qui se paie le plus cher, parce qu'il survient des mois plus tard.

---

## 4. Récapitulatif : à refaire ou pas

| | Même machine | Autre machine |
| --- | --- | --- |
| Compte Tailscale | non | non |
| MagicDNS / HTTPS / ACL | non | non |
| Clé d'authentification | réutilisable | réutilisable |
| Nom de nœud distinct | **oui** | **oui** |
| `name:` Compose distinct | **oui** (piège 2.1) | non |
| Port local distinct | **oui** (piège 2.2) | non |
| Numéro WhatsApp distinct | **oui** | **oui** |
| Clé API / mot de passe distincts | **oui** | **oui** |
| `keep-alive.ps1` | déjà fait | **oui** |
| Désactiver l'expiration de clé | **oui** | **oui** |

---

## 5. Si le projet n'est pas Next.js / Vercel

Rien de ce montage n'est propre à Next.js. La partie infrastructure est identique ; côté
application, il faut seulement :

- quatre routes serveur (`send`, `webhook`, `status`, `session`) dans le framework du projet ;
- les variables d'environnement **hors du bundle client** (attention aux préfixes publics :
  `NEXT_PUBLIC_`, `VITE_`, `PUBLIC_`…) ;
- le panneau de réglages, dont le prompt donne la spécification complète.

Le prompt le précise déjà : il suffit de remplir le bloc de contexte avec le bon framework.

---

## 6. Le coût, pour mémoire

| | Par projet |
| --- | --- |
| Tailscale | **0 DA** |
| Passerelle Evolution | **0 DA** (logiciel libre) |
| Nom de domaine | **aucun** |
| Serveur | **aucun** |
| **Total** | **0 DA/mois** |

Le seul coût réel est celui d'un poste qui reste allumé — et il est partagé si les deux projets
tournent sur la même machine.
