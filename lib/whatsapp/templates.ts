/** Modèles de messages WhatsApp.
 *
 *  Deux usages, portés par le même identifiant local :
 *   1. Un APERÇU lisible (français / arabe) affiché dans la fenêtre d'envoi et
 *      journalisé — c'est ce que `build()` produit.
 *   2. Un ENVOI RÉEL via l'API Cloud de Meta. Les messages d'entreprise
 *      proactifs (dette, solde épuisé/faible, inscription) partent en tant que
 *      MODÈLES APPROUVÉS par Meta : on n'envoie pas le texte libre ci-dessous,
 *      mais le nom du modèle approuvé + ses variables ordonnées ({{1}}, {{2}}…).
 *
 *  Ce fichier reste pur (aucun `server-only`, aucune lecture d'`env`) pour être
 *  importable côté navigateur : la fenêtre d'envoi y construit l'aperçu et la
 *  liste des variables. La CORRESPONDANCE identifiant local → nom de modèle
 *  approuvé par Meta est résolue côté serveur (voir lib/whatsapp/client.ts), à
 *  partir de variables d'environnement — jamais en dur, jamais dans le bundle. */

export type WhatsAppTemplateId =
  | "debt"
  | "balance_empty"
  | "balance_low"
  | "registration"
  | "custom";

/** Modèles proactifs qui exigent un modèle approuvé par Meta (tout sauf le
 *  message libre, qui ne part qu'en fenêtre de service client). */
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

/** Métadonnées d'un modèle d'alerte pour l'envoi Meta.
 *  `envKey` nomme la variable d'environnement qui porte le nom EXACT du modèle
 *  approuvé côté Meta (ex. WHATSAPP_TEMPLATE_BALANCE_DEBT=solde_dette). */
export interface MetaTemplateConfig {
  envKey: string;
  /** catégorie Meta du modèle — les alertes de compte sont « UTILITY ». */
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION";
  /** construit les paramètres ordonnés du corps ({{1}}, {{2}}, {{3}}). L'ordre
   *  DOIT correspondre au modèle soumis à Meta (voir README, section modèles). */
  buildVariables: (ctx: TemplateContext) => string[];
}

const money = (amount: number) => `${Math.round(amount).toLocaleString("fr-FR")} DA`;

/** Montant destiné à une VARIABLE de modèle Meta. Meta rejette les tabulations,
 *  les sauts de ligne et les espaces multiples dans un paramètre : on groupe
 *  donc les milliers avec des espaces simples ordinaires, sans locale exotique. */
export function formatAmountVar(amount: number): string {
  const grouped = Math.round(Math.abs(amount))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return `${grouped} DA`;
}

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
    hintFr: "Rédiger entièrement le message (fenêtre de service client requise).",
    // Uniquement la formule d'adresse : le reste est saisi par l'utilisateur.
    build: (ctx, lang) => `${opening(ctx, lang)}\n\n`,
  },
];

/** Correspondance identifiant local → configuration du modèle Meta. Le nom
 *  approuvé n'est PAS ici : il est lu côté serveur via `envKey`. Les variables,
 *  elles, ne sont pas sensibles et se construisent partout (aperçu compris). */
export const META_TEMPLATE_CONFIG: Record<AlertTemplateId, MetaTemplateConfig> = {
  debt: {
    envKey: "WHATSAPP_TEMPLATE_BALANCE_DEBT",
    category: "UTILITY",
    buildVariables: (ctx) => [
      ctx.studentName,
      formatAmountVar(Math.abs(Math.min(ctx.balance, 0))),
      ctx.schoolName,
    ],
  },
  balance_empty: {
    envKey: "WHATSAPP_TEMPLATE_BALANCE_EMPTY",
    category: "UTILITY",
    buildVariables: (ctx) => [ctx.studentName, formatAmountVar(ctx.balance), ctx.schoolName],
  },
  balance_low: {
    envKey: "WHATSAPP_TEMPLATE_BALANCE_LOW",
    category: "UTILITY",
    buildVariables: (ctx) => [ctx.studentName, formatAmountVar(ctx.balance), ctx.schoolName],
  },
  registration: {
    envKey: "WHATSAPP_TEMPLATE_REGISTRATION_DUE",
    category: "UTILITY",
    buildVariables: (ctx) => [
      ctx.studentName,
      formatAmountVar(ctx.registrationDue ?? 0),
      ctx.schoolName,
    ],
  },
};

/** `true` si l'identifiant correspond à un modèle d'alerte (envoi via modèle
 *  Meta), par opposition au message libre. */
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

/** Longueur maximale d'un corps de message texte (Meta plafonne `text.body` à
 *  4096 caractères). Ne concerne que le message libre : les modèles ont leurs
 *  propres limites, validées à l'approbation. */
export const MAX_MESSAGE_LENGTH = 4096;
