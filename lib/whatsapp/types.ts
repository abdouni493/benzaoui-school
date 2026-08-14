/** Types partagés entre les route handlers WhatsApp et l'interface.
 *
 *  Ce fichier n'importe rien de serveur (`client.ts`, `auth.ts` et `log.ts`
 *  importent `server-only`) : un composant client peut donc s'en servir pour
 *  les types sans tirer la clé d'accès Meta dans le bundle navigateur. */

import type { AlertTemplateId, MessageLanguage, WhatsAppTemplateId } from "./templates";

/** Statuts d'un message côté Meta. À l'envoi, l'API rend « accepted » (le
 *  message est pris en charge, pas encore remis) ; la remise réelle arrive plus
 *  tard, de façon asynchrone, par le webhook (`sent`/`delivered`/`read`/`failed`). */
export type MessageStatus = "accepted" | "sent" | "delivered" | "read" | "failed";

/** Message sortant décrit par l'appelant de POST /api/whatsapp/send.
 *
 *  - `template` : message d'entreprise proactif, via un modèle approuvé par Meta.
 *    Toujours délivrable, y compris hors fenêtre de service client.
 *  - `text` : message libre. Meta ne l'accepte que si une fenêtre de service
 *    client de 24 h est ouverte (le destinataire a écrit à l'école récemment). */
export type OutgoingMessage =
  | {
      kind: "template";
      /** toujours un modèle d'alerte : « custom » n'est jamais un modèle Meta */
      templateId: AlertTemplateId;
      /** paramètres ordonnés du corps du modèle ({{1}}, {{2}}, …) */
      variables: string[];
      language: MessageLanguage;
    }
  | { kind: "text"; text: string };

/** Un destinataire dans la réponse de `POST /api/whatsapp/send`. */
export interface SendResult {
  name: string;
  phone: string;
  ok: boolean;
  /** identifiant Meta du message (wamid.…), présent quand l'envoi est accepté */
  messageId?: string;
  /** état connu à l'instant de l'envoi : « accepted » tant que le webhook n'a
   *  pas remonté mieux. Jamais « read » sur un simple accusé d'acceptation. */
  status?: MessageStatus;
  error?: string;
}

/** Réponse de `POST /api/whatsapp/send`. */
export interface SendResponse {
  sent: number;
  failed: number;
  results: SendResult[];
}

/** Réponse de `GET /api/whatsapp/status` — état de la configuration Meta pour
 *  l'écran Paramètres → WhatsApp. Ne contient JAMAIS de secret : ni jeton
 *  d'accès, ni App Secret, ni jeton de vérification du webhook. */
export interface WhatsAppConfigState {
  /** les variables d'environnement minimales pour envoyer sont présentes */
  configured: boolean;
  /** un appel réel à Graph a confirmé que le jeton et le numéro sont valides */
  connected: boolean;
  /** numéro d'affichage renvoyé par Meta (ex. "+213 799 04 72 48"), si joignable */
  phoneNumber: string | null;
  /** nom vérifié du compte affiché dans WhatsApp, si renvoyé par Meta */
  verifiedName: string | null;
  /** Phone Number ID masqué pour l'affichage (ex. "•••••1234") */
  phoneNumberIdMasked: string | null;
  /** WhatsApp Business Account ID masqué pour l'affichage */
  businessAccountIdMasked: string | null;
  /** version de l'API Graph configurée (ex. "v21.0") */
  apiVersion: string;
  /** le jeton de vérification du webhook est configuré (présence uniquement) */
  webhookConfigured: boolean;
  /** modèles d'alerte dont le nom Meta est renseigné dans la configuration */
  configuredTemplates: WhatsAppTemplateId[];
  /** message d'erreur lisible si la vérification en direct a échoué */
  error: string | null;
}
