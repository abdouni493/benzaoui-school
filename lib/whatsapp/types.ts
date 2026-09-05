/** Types partagés entre les route handlers WhatsApp et l'interface.
 *
 *  Ce fichier n'importe rien de serveur (`client.ts`, `auth.ts` et `log.ts`
 *  importent `server-only`) : un composant client peut donc s'en servir pour
 *  les types sans tirer la clé de la passerelle dans le bundle navigateur. */

/** Statuts d'un message sortant.
 *
 *  À l'envoi, la passerelle rend « queued » : elle a pris le message en charge,
 *  il n'est pas encore remis. La suite arrive plus tard, de façon asynchrone,
 *  par le webhook (`sent` → `delivered` → `read`, ou `failed`).
 *
 *  « pending » est EN AMONT de tout cela : le message attend dans la file
 *  locale parce que la passerelle était injoignable, et n'a donc jamais été
 *  confié à WhatsApp. À ne pas confondre avec « queued », qui signifie
 *  l'inverse — la passerelle l'a bien accepté. */
export type MessageStatus = "pending" | "queued" | "sent" | "delivered" | "read" | "failed";

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

/** POURQUOI rien n'a pu partir.
 *
 *  `offline: true` disait qu'il fallait attendre — sans jamais dire QUOI. Les
 *  trois causes n'appellent pourtant pas du tout le même geste, et deux d'entre
 *  elles n'ont rien à voir avec un poste éteint :
 *
 *   · "unconfigured" — les variables serveur de la passerelle manquent. Rien ne
 *     partira JAMAIS tout seul : il faut les renseigner et redéployer.
 *   · "unreachable"  — la passerelle n'a pas répondu. C'est le seul cas où
 *     « ça repartira à son retour » est vrai : le poste qui l'héberge est
 *     éteint, en veille, ou sans Internet.
 *   · "disconnected" — la passerelle répond très bien, mais la session WhatsApp
 *     est fermée : le téléphone s'est délié. Attendre ne sert à rien, il faut
 *     rouvrir la session au QR depuis Paramètres → WhatsApp.
 *
 *  Le dernier cas est celui qui coûtait le plus cher : la file grossissait
 *  pendant que l'écran conseillait d'attendre le retour d'une passerelle qui
 *  n'était jamais partie. */
export type OfflineReason = "unconfigured" | "unreachable" | "disconnected";

/** Réponse de `POST /api/whatsapp/send`. */
export interface SendResponse {
  sent: number;
  failed: number;
  results: SendResult[];
  /** Destinataires NON traités faute de temps : la route s'arrête avant la
   *  limite d'exécution de Vercel plutôt que d'être coupée en plein envoi.
   *  L'interface renvoie ce reliquat dans un appel suivant. */
  remaining?: string[];
  /** Messages MIS EN FILE parce que la passerelle était injoignable (le poste
   *  qui l'héberge est éteint, en veille, ou sans Internet). Ils repartiront
   *  seuls : ce n'est pas un échec, et l'interface ne doit pas l'annoncer
   *  comme tel. */
  queued?: number;
  /** `true` quand rien n'a pu partir et que TOUT le lot est allé en file
   *  d'attente. Dit qu'il faut attendre ; `reason` dit quoi. */
  offline?: boolean;
  /** ce qui bloque, quand `offline` est vrai */
  reason?: OfflineReason;
}

/** Où en est un message dans la file locale.
 *
 *  · "draft"     — PROPOSÉ, pas encore approuvé. Une alerte de solde née d'un
 *                  badge atterrit ici : personne ne l'a relue, et rien ne part
 *                  d'un scan de carte sans qu'un humain l'ait décidé. Le
 *                  vidage automatique NE LES REGARDE PAS.
 *  · "pending"   — APPROUVÉ, en attente de la passerelle. C'est le seul état
 *                  que le vidage fait partir : dès que la session WhatsApp est
 *                  ouverte, il s'écoule tout seul.
 *  · "sent"      — confié à la passerelle (suivi dans whatsapp_messages).
 *  · "abandoned" — ne repartira plus (écarté à la main, trop de tentatives, ou
 *                  trop ancien pour être encore vrai). */
export type OutboxStatus = "draft" | "pending" | "sent" | "abandoned";

/** Un message de la file, tel qu'affiché sur le tableau de bord. */
export interface OutboxEntry {
  id: string;
  /** numéro lisible, ou à défaut le MSISDN */
  recipient: string;
  recipientName: string | null;
  body: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  /** nom de l'élève concerné, quand le message vient d'une alerte de solde */
  studentId: string | null;
}

/** Résultat d'une tentative de vidage de la file d'attente.
 *
 *  `offline: true` n'est PAS une erreur : c'est le cas nominal quand le poste
 *  hébergeant la passerelle est éteint. La file reste alors intacte. */
export interface FlushOutcome {
  sent: number;
  failed: number;
  /** encore en attente après cette tentative */
  remaining: number;
  /** écartés car trop anciens : l'information a pu changer entre-temps */
  expired: number;
  offline: boolean;
  /** ce qui bloque, quand `offline` est vrai. Absent sur un vidage réussi. */
  reason?: OfflineReason;
}

/** Réponse de `GET /api/whatsapp/outbox`.
 *
 *  Les deux files sont rendues SÉPARÉMENT, parce qu'elles n'appellent pas le
 *  même geste : les brouillons attendent une relecture (le tableau de bord les
 *  montre et propose de les envoyer), les approuvés attendent seulement que la
 *  passerelle revienne, et partiront sans que personne n'y touche. */
export interface OutboxResponse {
  /** approuvés, en attente de la passerelle — ils partiront tout seuls */
  pending: number;
  /** proposés, en attente d'une relecture — ils ne partiront JAMAIS seuls */
  drafts: number;
  entries: OutboxEntry[];
  draftEntries: OutboxEntry[];
}

/** Réponse de `POST /api/whatsapp/outbox/drafts` — ce que l'approbation ou le
 *  rejet d'un lot de brouillons a réellement fait. */
export interface DraftActionResult {
  /** brouillons passés en file d'envoi */
  approved: number;
  /** brouillons écartés définitivement */
  discarded: number;
  /** partis immédiatement, la passerelle étant joignable */
  sent: number;
  /** approuvés mais encore en file : ils partiront au retour de la passerelle */
  waiting: number;
  /** vrai quand rien n'a pu partir tout de suite */
  offline: boolean;
  /** ce qui bloque, quand `offline` est vrai */
  reason?: OfflineReason;
}

/** Diagnostic de la passerelle, rendu à l'écran Paramètres quand elle ne
 *  répond pas.
 *
 *  Il existe parce qu'une panne WhatsApp a exactement deux familles de causes —
 *  « le poste qui héberge la passerelle est éteint » et « une variable
 *  d'environnement est absente ou mal saisie » — et qu'elles se présentaient
 *  toutes les deux sous la même phrase : « passerelle injoignable ». On ne
 *  pouvait pas les distinguer sans accès aux journaux du serveur.
 *
 *  Ne contient AUCUN secret : des noms de variables, un schéma d'URL, un code
 *  d'erreur système. Jamais une clé, jamais un jeton. */
export interface WhatsAppDiagnostics {
  /** schéma réellement utilisé pour joindre la passerelle ("https" / "http") */
  scheme: string | null;
  /** correction qu'a subie EVOLUTION_BASE_URL au passage, s'il y en a eu une */
  baseUrlNote: string | null;
  /** variables d'environnement serveur absentes — NOMS seuls */
  missingEnv: string[];
  /** code système du dernier échec réseau ("ECONNREFUSED", "ENOTFOUND"…) */
  errorCode: string | null;
  /** adresse publique que la passerelle rappellera pour les accusés de remise */
  webhookUrl: string | null;
  /** pourquoi cette adresse n'a pas pu être déterminée, le cas échéant */
  webhookUrlError: string | null;
  /** variable d'origine écartée parce qu'elle porte une adresse de
   *  développement (localhost, host.docker.internal, http://) */
  webhookUrlNote: string | null;
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
  /** le webhook enregistré SUR LA PASSERELLE enverra bien le jeton que cette
   *  application attend. `null` = pas encore vérifiable (session fermée, ou
   *  passerelle muette). `false` est la panne muette : les messages partent,
   *  aucun accusé ne revient. */
  webhookTokenMatches: boolean | null;
  /** adresse que la passerelle rappellera, telle qu'elle l'a enregistrée —
   *  à ne pas confondre avec celle que l'application déduirait aujourd'hui */
  webhookUrlOnGateway: string | null;
  /** message d'erreur lisible si l'interrogation de la passerelle a échoué */
  error: string | null;
  /** de quoi agir sur cette erreur sans ouvrir les journaux du serveur */
  diagnostics: WhatsAppDiagnostics;
}

/** Réponse de `GET/POST /api/whatsapp/session` : l'état, plus de quoi lier le
 *  téléphone quand la session n'est pas ouverte. */
export interface WhatsAppSessionResponse extends WhatsAppSessionState {
  /** QR code en data-URI, prêt pour un `<img src>` ; `null` si déjà connecté */
  qrBase64: string | null;
  /** code d'appairage à saisir sur le téléphone, quand la passerelle en fournit un */
  pairingCode: string | null;
}
