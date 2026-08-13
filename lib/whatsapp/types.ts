/** Types partagés entre les route handlers WhatsApp et l'interface.
 *
 *  Ce fichier n'importe rien : `client.ts` et `auth.ts` importent `server-only`,
 *  un composant client ne peut donc pas passer par eux pour récupérer un type. */

/** Statuts de session, en minuscules côté API OpenWA. */
export type SessionStatus =
  | "created"
  | "initializing"
  | "qr_ready"
  | "authenticating"
  | "ready"
  | "disconnected"
  | "action_required"
  | "failed";

/** Réponse de `GET /api/whatsapp/session`. */
export interface SessionStatePayload {
  configured: boolean;
  status: SessionStatus | null;
  phoneNumber: string | null;
  /** PNG en data URL, présent uniquement quand la session attend un scan */
  qrCode: string | null;
  lastError: string | null;
}

/** Un destinataire dans la réponse de `POST /api/whatsapp/send`. */
export interface SendResult {
  name: string;
  phone: string;
  ok: boolean;
  messageId?: string;
  error?: string;
}

/** Réponse de `POST /api/whatsapp/send`. */
export interface SendResponse {
  sent: number;
  failed: number;
  results: SendResult[];
}
