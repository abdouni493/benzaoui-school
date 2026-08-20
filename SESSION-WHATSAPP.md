# Mise en service de la passerelle WhatsApp — compte rendu

Session du **20 août 2026**. Objectif : faire fonctionner l'envoi WhatsApp depuis l'application
hébergée sur Vercel, **sans VPS et sans le moindre frais**, alors qu'il ne marchait que sur
`localhost`.

Résultat : passerelle publique à `https://benzaoui-wa.tail6ac334.ts.net`, **0 DA/mois**, messages
envoyés et accusés de remise reçus en production.

> Ce document ne contient **aucun secret**. Les valeurs réelles vivent dans `evolution/.env`
> (jamais commité) et dans les variables d'environnement Vercel.

---

## 1. Le problème de départ

L'envoi WhatsApp fonctionnait en local mais pas en production, et **aucun réglage Vercel ne pouvait
y changer quoi que ce soit**.

La cause est structurelle : une session WhatsApp Web (moteur Baileys) doit maintenir une connexion
**ouverte en permanence** vers les serveurs WhatsApp. Vercel est serverless — chaque requête réveille
une fonction qui s'éteint aussitôt. Les deux modèles sont incompatibles.

La passerelle doit donc vivre sur une machine qui ne s'éteint pas, et l'application la pilote en
HTTPS :

```
Vercel (application)  ──HTTPS──►  passerelle Evolution  ──►  WhatsApp des familles
Vercel (webhook)      ◄──HTTPS──  passerelle Evolution  ◄──  statuts, réponses
```

## 2. La question du coût, et la décision

La contrainte posée était : **24 h/24, sans VPS, sans rien payer.**

Le point dur : *quelque chose* doit rester allumé. Soit on loue une machine (payant), soit on
utilise une machine que l'on possède déjà (gratuit, mais elle doit rester allumée). Il n'existe pas
de troisième voie.

| | Tailscale Funnel | Cloudflare | Railway | VPS |
| --- | --- | --- | --- | --- |
| Coût | **0 DA** | 0 DA | 7–10 $/mois | ≈ 4 €/mois |
| Domaine | **aucun** | obligatoire | aucun | obligatoire |
| PC éteint | ne marche pas | ne marche pas | marche | marche |

**Cloudflare a été écarté** : il exige un nom de domaine, que l'école ne possède pas.
**Tailscale Funnel a été retenu** : il fournit une adresse HTTPS publique et stable
(`https://<nœud>.<tailnet>.ts.net`) avec le compte gratuit, **sans domaine**.

Une correction a été apportée au passage : le coût Railway annoncé plus tôt (« ≈ 5 $ ») était le
plancher de l'abonnement, pas la facture. Une passerelle et un Postgres qui tournent en continu
placent le total à **7–10 $/mois**.

**Contrepartie assumée** : le poste éteint, en veille ou sans Internet = aucun message ne part, et
personne n'est prévenu automatiquement.

Bonne propriété découverte en route : la passerelle vit sur **le poste qui scanne déjà les cartes
RFID**. Les alertes automatiques de solde partent donc de cette machine — elles ne peuvent pas
échouer faute de passerelle joignable, puisque c'est la même machine.

## 3. Ce qui a été construit

| Fichier | Rôle |
| --- | --- |
| `evolution/docker-compose.funnel.yml` | La pile complète : Evolution + Postgres + sidecar Tailscale |
| `evolution/tailscale/funnel.json` | Configuration Serve/Funnel (sans commentaire : Tailscale la désérialise) |
| `evolution/tailscale/README.md` | Explications que le JSON ne peut pas porter |
| `evolution/keep-alive.ps1` | Verrouille Windows en service continu (veille, démarrage Docker) |
| `evolution/README.md` | Procédure complète, options A→E, diagnostic, déménagement |

## 4. Déroulé, étape par étape

### Étape 1 — Compte Tailscale

Compte gratuit (plan Personal). Nom du tailnet relevé dans **DNS** : `tail6ac334.ts.net`.
L'adresse publique se déduit alors : `https://` + `benzaoui-wa` + `.` + `tail6ac334.ts.net`.

> `TAILSCALE_HOSTNAME` ne se récupère nulle part : **c'est un nom que l'on choisit**. Il forme la
> première moitié de l'adresse.

### Étape 2 — MagicDNS + certificats HTTPS

Console → **DNS** → MagicDNS actif, puis **Enable HTTPS**. Sans HTTPS, le Funnel ne peut pas servir
et Vercel refuse de parler à la passerelle.

### Étape 3 — Autoriser le Funnel dans les ACL

Console → **Access controls**, ajout de `nodeAttrs` avec l'attribut `funnel`.

**Première erreur rencontrée** — le bloc avait été collé *au-dessus* de la politique existante,
créant deux objets JSON de haut niveau :

```
Error: line 15, column 1: invalid character '{' after top-level value
```

Corrigé en fusionnant le tout en **un seul** objet, au format `grants` des tailnets récents (et non
`acls`, syntaxe plus ancienne — ne pas mettre les deux).

### Étape 4 — Clé d'authentification

**Settings → Keys → Generate auth key**, cochée **Reusable**, surtout **pas Ephemeral** — un nœud
éphémère est supprimé dès qu'il se déconnecte et reviendrait sous un nom différent, changeant
l'adresse publique.

### Étape 5 — Renseigner `evolution/.env`

Trois lignes **ajoutées** : `TAILSCALE_AUTHKEY`, `TAILSCALE_HOSTNAME`, `TUNNEL_PUBLIC_URL`.

> **`POSTGRES_PASSWORD` a été laissé inchangé, volontairement.** Le volume Postgres existait déjà,
> initialisé avec l'ancienne valeur : une nouvelle aurait été rejetée par la base et Evolution
> n'aurait pas démarré.

### Étape 6 — Bascule des conteneurs

```powershell
docker compose -f evolution/docker-compose.local.yml down
docker compose -f evolution/docker-compose.funnel.yml up -d
```

L'arrêt préalable est obligatoire : les deux fichiers résolvent le **même nom de projet Compose**
(`evolution`) et **partagent donc les mêmes volumes**.

Conséquence heureuse : la session WhatsApp a survécu à la bascule (`state = open`), **sans rescanner
le QR code**. Conséquence dangereuse : les faire tourner ensemble mettrait deux passerelles et deux
Postgres sur les mêmes données — d'où la détection ajoutée dans `keep-alive.ps1`.

### Étape 7 — Le poste en service continu

`keep-alive.ps1 -Apply`, en administrateur. Deux vrais défauts corrigés sur la machine :

- **mise en veille après 45 min** — elle suspend les conteneurs et fait tomber la session ;
- **absence de démarrage automatique de Docker Desktop** — après une coupure de courant, rien ne
  repart malgré la politique `unless-stopped`, qui ne s'applique qu'une fois le moteur lancé.

### Étape 8 — Vercel

`EVOLUTION_BASE_URL`, `EVOLUTION_API_KEY`, `EVOLUTION_INSTANCE`, `EVOLUTION_WEBHOOK_TOKEN`, puis
**redéploiement** (les variables ne sont lues qu'au déploiement).

`EVOLUTION_WEBHOOK_URL` **volontairement absente** : l'application dérive l'adresse de son propre
domaine de production.

---

## 5. Les cinq pièges rencontrés

C'est la partie qui a coûté du temps, et celle qui resservira.

### 5.1 `tailscale funnel status` ment

Symptôme : `# Funnel on: https://…` affiché fièrement, certificat TLS obtenu, aucune erreur nulle
part — et l'adresse ne résolvait nulle part (`ENOTFOUND`, vérifié depuis l'extérieur du réseau).

Cause : l'attribut `funnel` n'était pas accordé par les ACL. Le fichier de configuration **local**
s'applique quoi qu'il arrive, donc `funnel status` le reflète ; le plan de contrôle, lui, refuse
silencieusement de publier l'enregistrement DNS public.

Diagnostic décisif — comparer les **capacités réellement accordées** au nœud :

```powershell
docker exec evolution-tailscale tailscale status --json | Select-String "funnel"
```

`funnel` en était absent, alors que `https` y figurait — ce qui expliquait le certificat obtenu.
Après correction des ACL : `funnel` **et** `funnel-ports?ports=443,8443,10000` sont apparus, et le
DNS a résolu en moins de 15 secondes.

### 5.2 Le webhook pointait encore vers la machine de développement

`check-gateway.ps1` a révélé que la passerelle appelait toujours
`http://host.docker.internal:3000/api/whatsapp/webhook`, avec l'ancien jeton de développement —
écrit deux jours plus tôt depuis `npm run dev`, et conservé puisque les volumes sont partagés.

Conséquence si on ne l'avait pas vu : **les messages seraient partis, et aucun accusé de remise ne
serait revenu.** Les statuts seraient restés bloqués sur `queued`, sans explication.

### 5.3 Le bouton pour corriger cela n'existait pas

Le bouton « Initialiser l'instance » n'était rendu que dans la branche `!state.connected`. Session
ouverte + webhook périmé — exactement le cas où il faut agir — et le bouton disparaissait. Le seul
contournement était de **délier le téléphone** pour le faire apparaître, donc casser une session
saine pour corriger une URL.

Corrigé (`f2952f1`) : bouton **« Réenregistrer le webhook »** disponible en session ouverte, et
bandeau « La passerelle est prête » rendu conditionnel — il s'affichait alors que rien ne revenait.

### 5.4 Le fichier de configuration doit être monté comme dossier

La documentation Tailscale l'impose : un bind-mount de **fichier unique** empêche le conteneur de
voir les modifications ultérieures. Le compose monte donc `./tailscale:/config`.

### 5.5 `funnel.json` ne doit porter aucun commentaire

Une clé `_comment` avait été ajoutée pour expliquer le fichier. Retirée : Tailscale désérialise ce
fichier, et un analyseur strict aurait cassé la passerelle. Les explications sont dans
`evolution/tailscale/README.md`.

---

## 6. État final vérifié

```
1. Joignabilite de la passerelle  [OK]  Evolution API 2.3.7
2. Cle API                        [OK]  acceptee
3. Session WhatsApp               [OK]  connectee
4. Webhook declare                [OK]  vers https://benzaoui-school.vercel.app/api/whatsapp/webhook
5. Endpoint webhook               [OK]  joignable et protege (401 sans jeton)
```

- Adresse publique : `https://benzaoui-wa.tail6ac334.ts.net` (3 IP d'entrée Tailscale)
- Confirmée **depuis l'extérieur du réseau de l'école** : HTTP 200, Evolution 2.3.7
- Envoi de messages et réception des accusés : **fonctionnels en production**
- Coût : **0 DA/mois**

## 7. Ce qui reste à faire

| Action | Pourquoi |
| --- | --- |
| **Machines → `benzaoui-wa` → Disable key expiry** | Sans ce clic, le nœud se déconnecte au bout de ~6 mois et les envois s'arrêtent **sans aucun avertissement**. Seul point encore armé. |
| Test de redémarrage du poste | Valide vraiment l'étape 7 : après un `Restart-Computer`, la passerelle doit revenir seule. |
| Ouverture de session automatique | Optionnel. Sans elle, après une coupure de courant Windows s'arrête sur l'écran de connexion et Docker ne démarre jamais. Stocke un mot de passe : à ne faire que si le poste est protégé physiquement. |
| Heures d'activité Windows Update | Pour que les redémarrages automatiques tombent hors des heures de cours. |

## 8. Commits de la session

| Commit | Objet |
| --- | --- |
| `149efe9` | Héberger la passerelle WhatsApp sans VPS |
| `b9e9687` | Passerelle gratuite : Tailscale Funnel sur le poste de l'école |
| `aa72a32` | Empêcher le montage local et le funnel de tourner ensemble |
| `be42011` | Monter le dossier de configuration, et exiger MagicDNS |
| `1236155` | Documenter que `tailscale funnel status` ment |
| `f2952f1` | Pouvoir réenregistrer le webhook sans délier le téléphone |
| `21aea49` | Runbook de déménagement (poste, téléphone) |

## 9. Pour aller plus loin

- Procédure complète et diagnostic : [`evolution/README.md`](evolution/README.md)
- Déménagement (nouveau poste, nouveau numéro) : même fichier, section « Déménager »
- Réappliquer ce montage sur un autre projet : [`whatsapp_promp.md`](whatsapp_promp.md)
