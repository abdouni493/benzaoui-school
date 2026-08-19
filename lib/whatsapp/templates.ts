/** Modèles de messages WhatsApp.
 *
 *  Depuis le passage à Evolution API, ces modèles n'ont plus qu'un seul rôle :
 *  PRÉ-RÉDIGER le texte (français / arabe) que la réception voit dans la fenêtre
 *  d'envoi, peut ajuster, puis envoie tel quel. Ce que `build()` produit est
 *  exactement ce qui part sur WhatsApp — il n'y a plus d'écart possible entre
 *  l'aperçu et le message réel, contrairement aux modèles approuvés par Meta.
 *
 *  Ce fichier reste pur (aucun `server-only`, aucune lecture d'`env`) pour être
 *  importable côté navigateur : la fenêtre d'envoi y construit le texte, et
 *  l'alerte automatique du scan RFID s'en sert aussi. */

export type WhatsAppTemplateId =
  | "debt"
  | "balance_empty"
  | "balance_low"
  | "registration"
  | "custom";

/** Alertes pré-rédigées, par opposition au message entièrement libre. */
export type AlertTemplateId = Exclude<WhatsAppTemplateId, "custom">;

/** À qui l'on parle : cela change la formule d'adresse de l'aperçu. `mixed`
 *  couvre l'envoi simultané à l'élève et à son parent. */
export type WhatsAppAudience = "student" | "parent" | "mixed";

export type MessageLanguage = "fr" | "ar";

export interface TemplateContext {
  studentName: string;
  /** solde courant en DA (négatif = dette) */
  balance: number;
  /** frais d'inscription restant dus, si le modèle "registration" est utilisé */
  registrationDue?: number;
  schoolName: string;
  schoolPhone?: string;
  audience: WhatsAppAudience;
}

export interface TemplateDefinition {
  id: WhatsAppTemplateId;
  labelFr: string;
  /** courte explication affichée sous le libellé dans la fenêtre d'envoi */
  hintFr: string;
  build: (ctx: TemplateContext, lang: MessageLanguage) => string;
}

const money = (amount: number) => `${Math.round(amount).toLocaleString("fr-FR")} DA`;

/** Formule d'adresse selon le destinataire. Le corps des modèles nomme toujours
 *  l'élève, donc la variante `mixed` peut rester neutre sans perdre en clarté. */
function opening(ctx: TemplateContext, lang: MessageLanguage): string {
  if (lang === "ar") {
    if (ctx.audience === "parent") return `السلام عليكم، ولي أمر التلميذ(ة) ${ctx.studentName}،`;
    if (ctx.audience === "student") return `السلام عليكم ${ctx.studentName}،`;
    return "السلام عليكم،";
  }
  if (ctx.audience === "parent") return `Bonjour, cher parent de ${ctx.studentName},`;
  if (ctx.audience === "student") return `Bonjour ${ctx.studentName},`;
  return "Bonjour,";
}

/** Pied de message : nom de l'école + numéro de contact éventuel. */
function signature(ctx: TemplateContext, lang: MessageLanguage): string {
  const contact = ctx.schoolPhone
    ? lang === "ar"
      ? `\nللاستفسار: ${ctx.schoolPhone}`
      : `\nContact : ${ctx.schoolPhone}`
    : "";
  return `\n\n${ctx.schoolName}${contact}`;
}

export const WHATSAPP_TEMPLATES: TemplateDefinition[] = [
  {
    id: "debt",
    labelFr: "Alerte de dette",
    hintFr: "Le solde est négatif : rappel du montant à régulariser.",
    build: (ctx, lang) => {
      const debt = Math.abs(Math.min(ctx.balance, 0));
      if (lang === "ar") {
        return (
          `${opening(ctx, lang)}\n\n` +
          `نعلمكم أن حساب التلميذ(ة) ${ctx.studentName} يسجل ديناً قدره ${money(debt)}.\n` +
          `نرجو تسوية المبلغ لدى الاستقبال في أقرب وقت لضمان مواصلة حضور الحصص.` +
          signature(ctx, lang)
        );
      }
      return (
        `${opening(ctx, lang)}\n\n` +
        `Le compte de ${ctx.studentName} présente actuellement une dette de ${money(debt)}.\n` +
        `Merci de bien vouloir régulariser cette somme auprès de la réception afin que les séances puissent se poursuivre normalement.` +
        signature(ctx, lang)
      );
    },
  },
  {
    id: "balance_empty",
    labelFr: "Solde épuisé",
    hintFr: "Le solde est à zéro : recharge nécessaire avant la prochaine séance.",
    build: (ctx, lang) => {
      if (lang === "ar") {
        return (
          `${opening(ctx, lang)}\n\n` +
          `رصيد التلميذ(ة) ${ctx.studentName} نفد (${money(ctx.balance)}).\n` +
          `يرجى تعبئة الرصيد قبل الحصة القادمة، إذ لا يمكن حضور الحصص دون رصيد كافٍ.` +
          signature(ctx, lang)
        );
      }
      return (
        `${opening(ctx, lang)}\n\n` +
        `Le solde de ${ctx.studentName} est épuisé (${money(ctx.balance)}).\n` +
        `Merci de procéder à une recharge avant la prochaine séance : l'accès aux cours n'est pas possible sans solde suffisant.` +
        signature(ctx, lang)
      );
    },
  },
  {
    id: "balance_low",
    labelFr: "Solde bientôt épuisé",
    hintFr: "Il reste de quoi tenir une ou deux séances : rappel préventif.",
    build: (ctx, lang) => {
      if (lang === "ar") {
        return (
          `${opening(ctx, lang)}\n\n` +
          `رصيد التلميذ(ة) ${ctx.studentName} أوشك على النفاد: ${money(ctx.balance)}.\n` +
          `ننصح بتعبئة الرصيد لتفادي انقطاع الحصص.` +
          signature(ctx, lang)
        );
      }
      return (
        `${opening(ctx, lang)}\n\n` +
        `Le solde de ${ctx.studentName} arrive à épuisement : il reste ${money(ctx.balance)}.\n` +
        `Nous vous invitons à le recharger afin d'éviter toute interruption des séances.` +
        signature(ctx, lang)
      );
    },
  },
  {
    id: "registration",
    labelFr: "Frais d'inscription dus",
    hintFr: "Rappel des frais d'inscription non encore réglés.",
    build: (ctx, lang) => {
      const due = ctx.registrationDue ?? 0;
      if (lang === "ar") {
        return (
          `${opening(ctx, lang)}\n\n` +
          `تبقى رسوم التسجيل الخاصة بالتلميذ(ة) ${ctx.studentName} غير مسددة: ${money(due)}.\n` +
          `نرجو تسويتها لدى الاستقبال.` +
          signature(ctx, lang)
        );
      }
      return (
        `${opening(ctx, lang)}\n\n` +
        `Les frais d'inscription de ${ctx.studentName} restent dus : ${money(due)}.\n` +
        `Merci de bien vouloir les régler auprès de la réception.` +
        signature(ctx, lang)
      );
    },
  },
  {
    id: "custom",
    labelFr: "Message libre",
    hintFr: "Rédiger entièrement le message.",
    // Uniquement la formule d'adresse : le reste est saisi par l'utilisateur.
    build: (ctx, lang) => `${opening(ctx, lang)}\n\n`,
  },
];

/** `true` si l'identifiant correspond à une alerte PRÉ-RÉDIGÉE, par opposition
 *  au message entièrement libre.
 *
 *  Ne distingue plus « modèle Meta » de « texte » : tout part en texte depuis le
 *  passage à Evolution API. Sert désormais à l'interface seule (pré-remplissage
 *  du champ de saisie, choix du modèle suggéré), plus au transport. */
export function isAlertTemplate(id: WhatsAppTemplateId): id is AlertTemplateId {
  return id !== "custom";
}

export function getTemplate(id: WhatsAppTemplateId): TemplateDefinition {
  return WHATSAPP_TEMPLATES.find((t) => t.id === id) ?? WHATSAPP_TEMPLATES[0];
}

/** Modèle le plus pertinent à pré-sélectionner d'après la situation de l'élève. */
export function suggestTemplate(ctx: {
  balance: number;
  registrationDue?: number;
}): WhatsAppTemplateId {
  if (ctx.balance < 0) return "debt";
  if (ctx.balance === 0) return "balance_empty";
  if ((ctx.registrationDue ?? 0) > 0) return "registration";
  return "custom";
}

/** Longueur maximale d'un message WhatsApp (4096 caractères). C'est la limite
 *  du protocole lui-même, plus une contrainte de fournisseur : elle s'applique
 *  donc à TOUS les messages, alertes pré-rédigées comprises. */
export const MAX_MESSAGE_LENGTH = 4096;
