"use client";

import { useMemo, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Select } from "@/components/ui/SearchInput";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useToast } from "@/lib/store/toast";
import { normalizePhone } from "@/lib/whatsapp/phone";
import {
  MAX_MESSAGE_LENGTH,
  META_TEMPLATE_CONFIG,
  WHATSAPP_TEMPLATES,
  getTemplate,
  isAlertTemplate,
  suggestTemplate,
  type MessageLanguage,
  type TemplateContext,
  type WhatsAppAudience,
  type WhatsAppTemplateId,
} from "@/lib/whatsapp/templates";
import type { OutgoingMessage, SendResponse, SendResult } from "@/lib/whatsapp/types";
import { AlertTriangle, Check, MessageCircle, Send, X } from "lucide-react";

export interface WhatsAppRecipient {
  id: string;
  name: string;
  phone: string;
  role: "student" | "parent";
}

/** Élève dont la situation alimente les modèles (solde, frais d'inscription). */
export interface WhatsAppStudentContext {
  id: string;
  name: string;
  balance: number;
  registrationDue?: number;
}

/** Formule d'adresse à retenir pour un ensemble de destinataires. Sans élève de
 *  référence, ou quand élève et parent sont visés ensemble, aucune des deux
 *  formules dédiées ne convient : on reste neutre. */
function audienceFor(
  recipients: WhatsAppRecipient[],
  selectedIds: string[],
  hasStudent: boolean,
): WhatsAppAudience {
  if (!hasStudent) return "mixed";
  const roles = new Set(recipients.filter((r) => selectedIds.includes(r.id)).map((r) => r.role));
  if (roles.size !== 1) return "mixed";
  return roles.has("parent") ? "parent" : "student";
}

/**
 * Fenêtre d'envoi WhatsApp, partagée par les fiches élèves et parents.
 *
 * Le composant est prévu pour être monté au moment de l'ouverture
 * (`{target && <WhatsAppMessageModal … />}`) : son état interne repart ainsi de
 * zéro à chaque fiche, sans réinitialisation manuelle.
 */
export function WhatsAppMessageModal({
  onClose,
  recipients,
  students,
  defaultRecipientIds,
  defaultStudentId,
}: {
  onClose: () => void;
  recipients: WhatsAppRecipient[];
  /** Élèves décrits par les modèles. Vide = seul le message libre est proposé. */
  students: WhatsAppStudentContext[];
  /** Destinataires cochés d'emblée (défaut : tous ceux qui ont un numéro valide). */
  defaultRecipientIds?: string[];
  defaultStudentId?: string;
}) {
  const school = useData((s) => s.school);
  const language = useSettings((s) => s.language);
  const addToast = useToast((s) => s.addToast);

  /** Un numéro inexploitable rend le destinataire non sélectionnable. */
  const sendable = useMemo(
    () => recipients.map((r) => ({ ...r, normalized: normalizePhone(r.phone) })),
    [recipients],
  );

  const initialStudent = students.find((s) => s.id === defaultStudentId) ?? students[0] ?? null;
  const initialSelection = (() => {
    const valid = sendable.filter((r) => r.normalized).map((r) => r.id);
    const preset = defaultRecipientIds?.filter((id) => valid.includes(id));
    return preset?.length ? preset : valid;
  })();
  const initialTemplate: WhatsAppTemplateId = initialStudent
    ? suggestTemplate(initialStudent)
    : "custom";
  const initialLang: MessageLanguage = language === "ar" ? "ar" : "fr";

  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelection);
  const [studentId, setStudentId] = useState(initialStudent?.id ?? "");
  const [templateId, setTemplateId] = useState<WhatsAppTemplateId>(initialTemplate);
  const [lang, setLang] = useState<MessageLanguage>(initialLang);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  /** Compose le corps du message. Appelé à l'initialisation puis à chaque
   *  changement de modèle, de langue ou d'élève — jamais dans un effet, pour
   *  qu'une saisie manuelle ne soit écrasée qu'en réponse à une action explicite. */
  const compose = (
    nextTemplateId: WhatsAppTemplateId,
    nextLang: MessageLanguage,
    nextStudentId: string,
  ) => {
    const student = students.find((s) => s.id === nextStudentId) ?? null;
    return getTemplate(nextTemplateId).build(
      {
        studentName: student?.name ?? "",
        balance: student?.balance ?? 0,
        registrationDue: student?.registrationDue,
        schoolName: school?.name || "L'établissement",
        schoolPhone: school?.phone,
        audience: audienceFor(recipients, selectedIds, students.length > 0),
      },
      nextLang,
    );
  };

  const [text, setText] = useState(() =>
    compose(initialTemplate, initialLang, initialStudent?.id ?? ""),
  );

  /** Sans élève de référence, les modèles d'alerte n'ont rien à décrire. */
  const availableTemplates = useMemo(
    () =>
      students.length > 0
        ? WHATSAPP_TEMPLATES
        : WHATSAPP_TEMPLATES.filter((t) => t.id === "custom"),
    [students.length],
  );

  const selectTemplate = (id: WhatsAppTemplateId) => {
    setTemplateId(id);
    setText(compose(id, lang, studentId));
  };

  const selectLang = (next: MessageLanguage) => {
    setLang(next);
    setText(compose(templateId, next, studentId));
  };

  const selectStudent = (id: string) => {
    setStudentId(id);
    setText(compose(templateId, lang, id));
  };

  // Cocher/décocher un destinataire ne réécrit pas le message : la saisie en
  // cours prime, et le corps des modèles nomme l'élève de toute façon.
  const toggleRecipient = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  /** Contexte de l'élève sélectionné, pour construire les variables du modèle
   *  Meta (nom, montant, école). L'audience ne change que l'aperçu, pas les
   *  variables — un modèle approuvé porte sa propre formule d'adresse. */
  const templateContext = (): TemplateContext => {
    const student = students.find((s) => s.id === studentId) ?? null;
    return {
      studentName: student?.name ?? "",
      balance: student?.balance ?? 0,
      registrationDue: student?.registrationDue,
      schoolName: school?.name || "L'établissement",
      schoolPhone: school?.phone,
      audience: audienceFor(recipients, selectedIds, students.length > 0),
    };
  };

  /** Message à envoyer : modèle Meta approuvé pour une alerte, texte libre pour
   *  « Message libre » (soumis à la fenêtre de service client de 24 h). */
  const buildOutgoing = (): OutgoingMessage => {
    if (isAlertTemplate(templateId)) {
      return {
        kind: "template",
        templateId,
        variables: META_TEMPLATE_CONFIG[templateId].buildVariables(templateContext()),
        language: lang,
      };
    }
    return { kind: "text", text: text.trim() };
  };

  const stripId = (id: string) => id.replace(/^(student|parent)-/, "");

  const handleSend = async () => {
    const chosen = sendable.filter((r) => selectedIds.includes(r.id) && r.normalized);
    if (chosen.length === 0) return;
    // Le message libre exige un texte ; un modèle porte son propre contenu.
    if (!isAlertTemplate(templateId) && !text.trim()) return;

    setSending(true);
    setError(null);
    setResults(null);

    try {
      const message = buildOutgoing();
      const response = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          recipients: chosen.map((r) => ({
            phone: r.phone,
            name: r.name,
            studentId: r.role === "student" ? stripId(r.id) : studentId || undefined,
            parentId: r.role === "parent" ? stripId(r.id) : undefined,
          })),
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        setError(payload?.error ?? "L'envoi a échoué.");
        return;
      }

      const { sent, failed, results: sendResults } = payload as SendResponse;
      setResults(sendResults);

      if (sent > 0) {
        addToast({
          type: failed > 0 ? "warning" : "success",
          title: "Message WhatsApp",
          message:
            failed > 0
              ? `${sent} message(s) envoyé(s), ${failed} en échec.`
              : `${sent} message(s) envoyé(s).`,
        });
        // Les échecs restent affichés pour être corrigés ; un envoi entièrement
        // réussi n'a plus rien à montrer.
        if (failed === 0) onClose();
      }
    } catch {
      setError("Impossible de joindre le serveur.");
    } finally {
      setSending(false);
    }
  };

  const selectedCount = selectedIds.length;
  const isTemplate = isAlertTemplate(templateId);
  // La limite de longueur ne concerne que le message libre ; un modèle porte
  // son propre contenu approuvé par Meta.
  const tooLong = !isTemplate && text.length > MAX_MESSAGE_LENGTH;

  return (
    <Modal open onClose={onClose} title="Envoyer un message WhatsApp" wide>
      <div className="space-y-5">
        {/* Destinataires */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted">Destinataires</label>
          <div className="space-y-1.5">
            {sendable.map((r) => {
              const checked = selectedIds.includes(r.id);
              const invalid = !r.normalized;
              return (
                <label
                  key={r.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border p-2.5 transition-colors ${
                    invalid
                      ? "cursor-not-allowed border-line bg-canvas/30 opacity-60"
                      : checked
                        ? "cursor-pointer border-primary/30 bg-primary/10"
                        : "cursor-pointer border-line hover:bg-primary-50/40"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={invalid}
                      onChange={() => toggleRecipient(r.id)}
                      className="h-4 w-4 rounded border-line bg-surface text-primary focus:ring-primary"
                    />
                    <div className="min-w-0">
                      <strong className="block truncate text-xs text-ink">{r.name}</strong>
                      <span className="block truncate text-[10px] text-muted">
                        {r.normalized ? r.normalized.display : r.phone || "Aucun numéro"}
                      </span>
                    </div>
                  </div>
                  {invalid ? (
                    <Badge tone="danger" className="shrink-0 text-[9px]">
                      Numéro invalide
                    </Badge>
                  ) : (
                    <Badge tone="neutral" className="shrink-0 text-[9px]">
                      {r.role === "parent" ? "Parent" : "Élève"}
                    </Badge>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {/* Élève concerné — utile depuis une fiche parent à plusieurs enfants */}
        {students.length > 1 && (
          <div>
            <label className="mb-1.5 block text-xs font-semibold text-muted">Élève concerné</label>
            <Select
              value={studentId}
              onChange={(e) => selectStudent(e.target.value)}
              className="w-full"
            >
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} — solde {s.balance} DA
                </option>
              ))}
            </Select>
          </div>
        )}

        {/* Contenu du message */}
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted">Contenu du message</label>
          <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {availableTemplates.map((t) => {
              const active = templateId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => selectTemplate(t.id)}
                  className={`rounded-xl border p-2.5 text-start transition-colors ${
                    active ? "border-primary/40 bg-primary/10" : "border-line hover:bg-primary-50/40"
                  }`}
                >
                  <span className="flex items-center gap-1.5 text-xs font-bold text-ink">
                    {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                    {t.labelFr}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-muted">{t.hintFr}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Langue + saisie */}
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <label className="text-xs font-semibold text-muted">Message</label>
            <div className="flex items-center gap-1 rounded-lg border border-line p-0.5">
              {(["fr", "ar"] as MessageLanguage[]).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => selectLang(l)}
                  className={`rounded-md px-2 py-0.5 text-[10px] font-bold transition-colors ${
                    lang === l ? "bg-primary text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  {l === "fr" ? "Français" : "العربية"}
                </button>
              ))}
            </div>
          </div>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            readOnly={isTemplate}
            dir={lang === "ar" ? "rtl" : "ltr"}
            placeholder="Saisissez votre message..."
            className={`w-full rounded-xl border border-line p-3 text-sm text-ink outline-none focus:border-primary ${
              isTemplate ? "bg-canvas/40 cursor-default" : "bg-surface"
            }`}
          />
          <div className="mt-1 flex justify-between gap-3 text-[10px]">
            <span className="text-muted">
              {isTemplate
                ? "Alerte envoyée via un modèle WhatsApp approuvé par Meta. Ce texte est un aperçu ; le contenu exact est défini par le modèle approuvé."
                : "Message libre : possible uniquement si la famille a écrit à l'école dans les dernières 24 h (fenêtre de service client)."}
            </span>
            {!isTemplate && (
              <span className={tooLong ? "shrink-0 font-bold text-danger" : "shrink-0 text-muted"}>
                {text.length} / {MAX_MESSAGE_LENGTH}
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Compte rendu par destinataire */}
        {results && (
          <div className="space-y-1.5">
            {results.map((r, i) => (
              <div
                key={`${r.phone}-${i}`}
                className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                  r.ok ? "border-success/30 bg-success/10" : "border-danger/30 bg-danger/10"
                }`}
              >
                <span className="truncate text-ink">
                  {r.name} — {r.phone}
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1 ${r.ok ? "text-success" : "text-danger"}`}
                >
                  {r.ok ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
                  {r.ok ? "Envoyé" : (r.error ?? "Échec")}
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-line pt-4">
          <span className="flex items-center gap-1.5 text-[10px] text-muted">
            <MessageCircle className="h-3.5 w-3.5" />
            {selectedCount} destinataire{selectedCount > 1 ? "s" : ""}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={sending}>
              Fermer
            </Button>
            <Button
              onClick={handleSend}
              disabled={sending || selectedCount === 0 || (!isTemplate && !text.trim()) || tooLong}
              className="flex items-center gap-2"
            >
              <Send className="h-4 w-4" />
              {sending ? "Envoi en cours..." : "Envoyer"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
