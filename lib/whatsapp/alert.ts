/** Résolution du destinataire et du message d'une alerte de solde.
 *
 *  Fichier volontairement pur : aucune dépendance serveur (`server-only`), React
 *  ou navigateur. Il est partagé par le scan RFID (useScanProcessor) et l'envoi
 *  groupé de la fiche élève, pour qu'une SEULE logique décide à qui l'on écrit et
 *  avec quel modèle — l'envoi lui-même reste, lui, derrière /api/whatsapp/send,
 *  seul endroit où le jeton d'accès Meta est lu.
 *
 *  Les alertes automatiques sont des messages d'entreprise PROACTIFS : elles
 *  partent donc en MODÈLE approuvé par Meta, jamais en texte libre. Ce module
 *  construit le descripteur de modèle (identifiant + variables ordonnées) ; la
 *  correspondance vers le nom approuvé côté Meta est faite au moment de l'envoi. */

import { isSendablePhone } from "./phone";
import {
  META_TEMPLATE_CONFIG,
  getTemplate,
  isAlertTemplate,
  type MessageLanguage,
  type TemplateContext,
  type WhatsAppTemplateId,
} from "./templates";
import type { OutgoingMessage } from "./types";

/** Élève dont la situation financière alimente le modèle. */
export interface AlertStudent {
  id?: string;
  firstName: string;
  lastName: string;
  /** solde courant en DA (négatif = dette) */
  balance: number;
  /** frais d'inscription restant dus, le cas échéant */
  registrationDue?: number;
  phone?: string | null;
}

export interface AlertParent {
  id?: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
}

export interface AlertSchool {
  name?: string | null;
  phone?: string | null;
}

/** Charge utile prête pour un destinataire de POST /api/whatsapp/send. */
export interface AlertRecipientPayload {
  phone: string;
  name: string;
  studentId?: string;
  parentId?: string;
  /** message à envoyer (modèle Meta pour une alerte, texte pour un libre forcé) */
  message: OutgoingMessage;
  /** aperçu lisible du message, pour le journal et l'affichage */
  previewText: string;
}

/** Modèle d'alerte le plus adapté à la situation, ou `null` s'il n'y a rien à
 *  signaler (solde confortable et aucun frais dû). `low` force le modèle de
 *  solde bientôt épuisé quand l'appelant sait déjà que le solde est faible —
 *  `suggestTemplate` ne le propose pas, car il ne connaît pas le prix de la
 *  séance qui définit ce qu'est un solde « faible ». */
export function balanceAlertTemplate(
  student: { balance: number; registrationDue?: number },
  opts: { low?: boolean } = {},
): WhatsAppTemplateId | null {
  if (student.balance < 0) return "debt";
  if (student.balance === 0) return "balance_empty";
  if (opts.low) return "balance_low";
  if ((student.registrationDue ?? 0) > 0) return "registration";
  return null;
}

/** Construit la charge utile WhatsApp (numéro + nom + message) d'une alerte de
 *  solde. Le parent rattaché est l'interlocuteur privilégié ; l'élève prend le
 *  relais s'il n'a pas de parent joignable. Renvoie `null` si aucun numéro n'est
 *  exploitable, ou si la situation ne justifie aucune alerte. */
export function buildBalanceAlert(params: {
  student: AlertStudent;
  parent?: AlertParent | null;
  school?: AlertSchool | null;
  lang: MessageLanguage;
  /** solde faible connu de l'appelant (voir `balanceAlertTemplate`) */
  low?: boolean;
  /** force un modèle précis ; sinon déduit de la situation */
  templateId?: WhatsAppTemplateId | null;
}): AlertRecipientPayload | null {
  const { student, parent, school, lang, low } = params;

  const target = isSendablePhone(parent?.phone)
    ? {
        phone: parent!.phone!,
        name: `${parent!.firstName} ${parent!.lastName}`,
        audience: "parent" as const,
        parentId: parent!.id,
      }
    : isSendablePhone(student.phone)
      ? {
          phone: student.phone!,
          name: `${student.firstName} ${student.lastName}`,
          audience: "student" as const,
          parentId: undefined,
        }
      : null;
  if (!target) return null;

  const templateId = params.templateId ?? balanceAlertTemplate(student, { low });
  if (!templateId) return null;

  const ctx: TemplateContext = {
    studentName: `${student.firstName} ${student.lastName}`,
    balance: student.balance,
    registrationDue: student.registrationDue,
    schoolName: school?.name || "L'établissement",
    schoolPhone: school?.phone || undefined,
    audience: target.audience,
  };

  const previewText = getTemplate(templateId).build(ctx, lang);

  const message: OutgoingMessage = isAlertTemplate(templateId)
    ? {
        kind: "template",
        templateId,
        variables: META_TEMPLATE_CONFIG[templateId].buildVariables(ctx),
        language: lang,
      }
    : { kind: "text", text: previewText };

  return {
    phone: target.phone,
    name: target.name,
    studentId: student.id,
    parentId: target.parentId,
    message,
    previewText,
  };
}
