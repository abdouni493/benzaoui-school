# =============================================================================
# Passerelle WhatsApp — image déployée sur Railway (hébergement sans VPS)
#
# Railway ne lit pas docker-compose. Il construit CE Dockerfile, qui ne fait que
# reprendre l'image officielle d'Evolution API : aucune couche ajoutée, aucun
# code de l'école embarqué. Toute la configuration passe par les variables
# d'environnement du service Railway (voir env.example dans ce dossier).
#
# Deux façons de s'en servir, décrites dans evolution/README.md :
#   - « Deploy from Docker Image » : Railway tire l'image directement, ce
#     fichier n'est alors pas utilisé ;
#   - « Deploy from GitHub repo » avec Root Directory = evolution/railway :
#     Railway construit ce Dockerfile et redéploie à chaque modification du
#     dossier (voir watchPatterns dans railway.json).
#
# VERSION ÉPINGLÉE, volontairement — et pas `latest`. Une passerelle qui se met
# à jour toute seule peut interrompre les envois de l'école un matin de rentrée,
# sans que personne n'ait rien changé. La version ci-dessous est celle validée
# sur le montage local de l'école.
#
# Pour monter de version : changer le tag, redéployer, puis vérifier avec
#   powershell -File evolution\check-gateway.ps1 -BaseUrl ... -ApiKey ...
# Les tags disponibles : https://hub.docker.com/r/evoapicloud/evolution-api/tags
# =============================================================================

FROM evoapicloud/evolution-api:v2.3.7
