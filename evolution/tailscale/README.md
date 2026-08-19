# Configuration du Funnel Tailscale

`funnel.json` est lu par le conteneur `tailscale` de
[`../docker-compose.funnel.yml`](../docker-compose.funnel.yml) (variable
`TS_SERVE_CONFIG`). C'est lui qui rend la passerelle WhatsApp joignable depuis
Internet — donc depuis Vercel — **sans nom de domaine et sans VPS**.

Le fichier ne contient **aucun commentaire** : il est désérialisé par Tailscale,
et une clé étrangère ajoutée « pour expliquer » risquerait d'être refusée. Les
explications vivent donc ici.

C'est **ce dossier entier** qui est monté dans le conteneur (`./tailscale:/config`),
et non `funnel.json` seul : la documentation Tailscale le recommande, un
bind-mount de fichier unique empêchant le conteneur de voir les modifications
faites ensuite côté Windows.

## Ce que fait chaque bloc

| Bloc | Rôle |
| --- | --- |
| `TCP.443.HTTPS` | Le trafic public arrive en HTTPS sur 443. Tailscale fournit et renouvelle le certificat tout seul — rien à installer, rien à surveiller. |
| `Web.<domaine>:443.Handlers` | Tout ce qui arrive est relayé vers `evolution:8080`, sur le réseau interne de Docker. La passerelle n'est donc jamais exposée en direct. |
| `AllowFunnel` | Ce qui distingue le **Funnel** (public, tout Internet) du **Serve** (privé, votre tailnet seulement). Le passer à `false` couperait Vercel. |

## `${TS_CERT_DOMAIN}`

Cette variable est remplacée au démarrage du conteneur par le nom public réel du
nœud, de la forme `benzaoui-wa.tailXXXX.ts.net`.

**Ne pas l'écrire en dur.** Elle changerait au moindre renommage du nœud, et le
certificat ne correspondrait plus au nom servi : Vercel ne pourrait plus joindre
la passerelle, avec une erreur TLS peu parlante.

## Si l'adresse publique change

Le nom vient de `TS_HOSTNAME` (dans le compose) et du nom de votre tailnet. S'il
change, trois choses doivent suivre, sans quoi les statuts de remise cessent
d'arriver :

1. `TUNNEL_PUBLIC_URL` dans `evolution/.env` (c'est le `SERVER_URL` de la passerelle) ;
2. `EVOLUTION_BASE_URL` dans les variables Vercel, puis **redéployer** ;
3. **Paramètres → WhatsApp → Initialiser l'instance**, pour réenregistrer le webhook.

[`../check-gateway.ps1`](../check-gateway.ps1) détecte précisément ce genre de
décalage.
