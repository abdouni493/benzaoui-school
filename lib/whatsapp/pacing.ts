/** Cadence d'envoi WhatsApp — partagée par la route d'envoi et le vidage de la
 *  file d'attente.
 *
 *  POURQUOI CES CONSTANTES VIVENT ICI, ET PAS EN DOUBLE
 *  ----------------------------------------------------
 *  Les messages partent d'une session WhatsApp Web ordinaire, depuis le numéro
 *  de l'école. Envoyer en rafale depuis une telle session est le premier motif
 *  de bannissement — et un bannissement est sans recours.
 *
 *  Deux chemins envoient désormais : `POST /api/whatsapp/send` (envoi direct) et
 *  le vidage de l'outbox (rattrapage après une coupure). Le second est
 *  précisément celui qui traite des lots accumulés, donc celui qui risque le
 *  plus de ressembler à un robot. Dupliquer la temporisation aurait laissé les
 *  deux dériver ; les partager garantit qu'un rattrapage est aussi prudent
 *  qu'un envoi normal.
 *
 *  Ce fichier n'importe rien de serveur : il ne contient que des nombres et des
 *  fonctions pures. */

/** Bornes du tirage aléatoire de la pause entre deux destinataires.
 *  Le délai est ALÉATOIRE à dessein : une cadence parfaitement régulière est
 *  elle-même un signal d'automatisation. */
export const GAP_MIN_MS = 3_000;
export const GAP_MAX_MS = 7_000;

/** Frappe simulée par la passerelle avant chaque envoi (comportement humain). */
export const TYPING_DELAY_MS = 1_200;

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const randomGap = () => GAP_MIN_MS + Math.floor(Math.random() * (GAP_MAX_MS - GAP_MIN_MS + 1));
