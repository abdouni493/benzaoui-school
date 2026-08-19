/** Types partagés entre les route handlers WhatsApp et l'interface.
 *
 *  Ce fichier n'importe rien de serveur (`client.ts`, `auth.ts` et `log.ts`
 *  importent `server-only`) : un composant client peut donc s'en servir pour
 *  les types sans tirer la clé de la passerelle dans le bundle navigateur. */

/** Statuts d'un message sortant.
 *
 *  À l'envoi, la passerelle rend « queued » : elle a pris le message en charge,
 *  il n'est pas encore remis. La suite arrive plus tard, de façon asynchrone,
 *  par le webhook (`sent` → `delivered` → `read`, ou `failed`). */
export type MessageStatus = "queued" | "sent" | "delivered" | "read" | "failed";

/** État de la session WhatsApp côté passerelle. `unknown` couvre tout libellé
 *  qu'une version d'Evolution renverrait sans qu'on le connaisse. */
export type ConnectionState = "open" | "close" | "connecting" | "unknown";

/** Message sortant décrit par l'appelant de POST /api/whatsapp/send.
 *
 *  Une seule forme depuis le passage à Evolution API : du TEXTE. La passerelle
 *  envoie depuis une session WhatsApp Web ordinaire — il n'y a plus de modèle à
 *  faire approuver, ni de fenêtre de service client de 24 h à respecter. */
export type OutgoingMessage = { kind: "text"; text: string };

/** Un destinataire dans la réponse de `POST /api/whatsapp/send`. */
export interface SendResult {
  name: string;
  phone: string;
  ok: boolean;
  /** identifiant du message rendu par la passerelle, quand l'envoi est accepté */
  messageId?: string;
  /** état connu à l'instant de l'envoi : « queued » tant que le webhook n'a pas
   *  remonté mieux. Jamais « read » sur un simple accusé de prise en charge. */
  status?: MessageStatus;
  error?: string;
}

/** Réponse de `POST /api/whatsapp/send`. */
export interface SendResponse {
  sent: number;
  failed: number;
  results: SendResult[];
  /** Destinataires NON traités faute de temps : la route s'arrête avant la
   *  limite d'exécution de Vercel plutôt que d'être coupée en plein envoi.
   *  L'interface renvoie ce reliquat dans un appel suivant. */
  remaining?: string[];
}

/** Réponse de `GET /api/whatsapp/status` et de `/api/whatsapp/session` — état de
 *  la session pour l'écran Paramètres → WhatsApp. Ne contient JAMAIS de secret :
 *  ni clé API, ni jeton de webhook. */
export interface WhatsAppSessionState {
  /** les variables d'environnement minimales pour envoyer sont présentes */
  configured: boolean;
  /** état brut de la session côté passerelle */
  state: ConnectionState;
  /** raccourci : la session est utilisable pour envoyer */
  connected: boolean;
  /** numéro WhatsApp lié à la session (ex. "213555123456"), si connu */
  linkedNumber: string | null;
  /** nom de profil WhatsApp du compte lié, si renvoyé par la passerelle */
  profileName: string | null;
  /** nom de l'instance, masqué pour l'affichage (ex. "•••••aoui") */
  instanceMasked: string | null;
  /** hôte seul de EVOLUTION_BASE_URL — jamais l'URL complète, jamais la clé */
  baseUrlHost: string | null;
  /** le jeton d'authentification des webhooks est configuré (présence seule) */
  webhookConfigured: boolean;
  /** message d'erreur lisible si l'interrogation de la passerelle a échoué */
  error: string | null;
}

/** Réponse de `GET/POST /api/whatsapp/session` : l'état, plus de quoi lier le
 *  téléphone quand la session n'est pas ouverte. */
export interface WhatsAppSessionResponse extends WhatsAppSessionState {
  /** QR code en data-URI, prêt pour un `<img src>` ; `null` si déjà connecté */
  qrBase64: string | null;
  /** code d'appairage à saisir sur le téléphone, quand la passerelle en fournit un */
  pairingCode: string | null;
}
