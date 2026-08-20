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
  WHATSAPP_TEMPLATES,
  getTemplate,
  suggestTemplate,
  type MessageLanguage,
  type WhatsAppAudience,
  type WhatsAppTemplateId,
} from "@/lib/whatsapp/templates";
import type { OutgoingMessage, SendResponse, SendResult } from "@/lib/whatsapp/types";
import { AlertTriangle, Check, Clock, MessageCircle, Send, X } from "lucide-react";

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

/** Destinataires par appel à /api/whatsapp/send. La route refuse au-delà : elle
 *  temporise 3 à 7 s entre deux messages pour protéger le numéro de l'école, et
 *  doit rendre la main avant la limite d'exécution de Vercel. */
const BATCH_SIZE = 8;

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
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
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

  const stripId = (id: string) => id.replace(/^(student|parent)-/, "");

  /** Envoi par LOTS SÉQUENTIELS. Jamais en parallèle : ce serait exactement le
   *  comportement en rafale que la temporisation côté serveur cherche à éviter,
   *  et c'est le premier motif de bannissement d'un numéro par WhatsApp. */
  const handleSend = async () => {
    const chosen = sendable.filter((r) => selectedIds.includes(r.id) && r.normalized);
    if (chosen.length === 0 || !text.trim()) return;

    setSending(true);
    setError(null);
    setResults(null);
    setProgress({ done: 0, total: chosen.length });

    const message: OutgoingMessage = { kind: "text", text: text.trim() };
    const collected: SendResult[] = [];
    const queue = [...chosen];

    try {
      while (queue.length > 0) {
        const batch = queue.splice(0, BATCH_SIZE);

        const response = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message,
            recipients: batch.map((r) => ({
              phone: r.phone,
              name: r.name,
              studentId: r.role === "student" ? stripId(r.id) : studentId || undefined,
              parentId: r.role === "parent" ? stripId(r.id) : undefined,
            })),
          }),
        });

        const payload = await response.json();

        if (!response.ok) {
          // Erreur globale (passerelle injoignable, session tombée) : les lots
          // suivants échoueraient pareil. On garde les résultats déjà obtenus.
          setError(payload?.error ?? "L'envoi a échoué.");
          if (collected.length > 0) setResults([...collected]);
          return;
        }

        const { results: batchResults, remaining } = payload as SendResponse;

        if (batchResults.length === 0) {
          setError("La passerelle n'a traité aucun destinataire. Réessayer dans un instant.");
          if (collected.length > 0) setResults([...collected]);
          return;
        }

        collected.push(...batchResults);
        // Affichage rafraîchi APRÈS CHAQUE LOT : l'utilisateur voit l'avancement
        // plutôt qu'un écran figé pendant plusieurs minutes.
        setResults([...collected]);
        setProgress({ done: collected.length, total: chosen.length });

        // Destinataires que le serveur n'a pas eu le temps de traiter avant sa
        // limite d'exécution : ils repassent en tête de file.
        if (remaining?.length) {
          queue.unshift(...batch.filter((r) => remaining.includes(r.phone)));
        }
      }

      const sent = collected.filter((r) => r.ok).length;
      // Un message « pending » attend dans la file locale : ni parti, ni perdu.
      // Le compter comme un échec ferait croire à une erreur alors qu'il
      // repartira tout seul.
      const pending = collected.filter((r) => r.status === "pending").length;
      const failed = collected.length - sent - pending;

      if (sent > 0 || pending > 0) {
        const parts: string[] = [];
        if (sent > 0) parts.push(`${sent} message(s) envoyé(s)`);
        if (pending > 0) parts.push(`${pending} en attente`);
        if (failed > 0) parts.push(`${failed} en échec`);

        addToast({
          type: failed > 0 ? "warning" : pending > 0 ? "info" : "success",
          title: "Message WhatsApp",
          message:
            pending > 0
              ? `${parts.join(", ")}. La passerelle est injoignable : les messages en attente partiront automatiquement dès son retour.`
              : `${parts.join(", ")}.`,
        });
        // Les échecs restent affichés pour être corrigés ; les messages en
        // attente aussi, pour que l'utilisateur sache qu'ils ne sont pas partis.
        if (failed === 0 && pending === 0) onClose();
      }
    } catch {
      setError("Impossible de joindre le serveur.");
      if (collected.length > 0) setResults([...collected]);
    } finally {
      setSending(false);
      setProgress(null);
    }
  };

  const selectedCount = selectedIds.length;
  const tooLong = text.length > MAX_MESSAGE_LENGTH;

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

          {selectedCount > BATCH_SIZE && (
            <p className="mt-1.5 text-[10px] leading-relaxed text-muted">
              L&apos;envoi sera découpé en plusieurs lots, avec une pause entre chaque message pour
              protéger le numéro de l&apos;école. Comptez environ 5 secondes par destinataire.
            </p>
          )}
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
          {/* Éditable pour TOUS les modèles : un modèle ne fait que pré-remplir
              le texte, la réception l'ajuste ensuite si besoin. */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            dir={lang === "ar" ? "rtl" : "ltr"}
            placeholder="Saisissez votre message..."
            className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none focus:border-primary"
          />
          <div className="mt-1 flex justify-between gap-3 text-[10px]">
            <span className="text-muted">
              Le message est envoyé tel quel depuis le numéro WhatsApp de l&apos;école. Vous pouvez
              le modifier avant l&apos;envoi.
            </span>
            <span className={tooLong ? "shrink-0 font-bold text-danger" : "shrink-0 text-muted"}>
              {text.length} / {MAX_MESSAGE_LENGTH}
            </span>
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
                  r.ok
                    ? "border-success/30 bg-success/10"
                    : r.status === "pending"
                      ? "border-warning/30 bg-warning/10"
                      : "border-danger/30 bg-danger/10"
                }`}
              >
                <span className="truncate text-ink">
                  {r.name} — {r.phone}
                </span>
                <span
                  className={`flex shrink-0 items-center gap-1 ${
                    r.ok ? "text-success" : r.status === "pending" ? "text-warning" : "text-danger"
                  }`}
                >
                  {r.ok ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : r.status === "pending" ? (
                    <Clock className="h-3.5 w-3.5" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                  {r.ok ? "Envoyé" : r.status === "pending" ? "En attente" : (r.error ?? "Échec")}
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
              disabled={sending || selectedCount === 0 || !text.trim() || tooLong}
              className="flex items-center gap-2"
            >
              <Send className="h-4 w-4" />
              {sending
                ? progress
                  ? `Envoi en cours… ${progress.done}/${progress.total}`
                  : "Envoi en cours…"
                : "Envoyer"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
