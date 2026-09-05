"use client";

/** LE seul endroit où l'on parle des messages WhatsApp en attente.
 *
 *  CE QU'IL REMPLACE
 *  -----------------
 *  Un bandeau fixe au bas de CHAQUE écran, qui annonçait « N messages en
 *  attente — la passerelle ne répond pas ». Il apparaissait pendant qu'on
 *  saisissait une inscription, qu'on réglait une dette, qu'on pointait un
 *  appel : partout, sans rapport avec l'écran affiché, et sans rien montrer du
 *  message dont il parlait.
 *
 *  Ici, la même information a une place, un contexte et un geste :
 *
 *   1. le nombre d'alertes préparées, sur le tableau de bord ;
 *   2. un clic ouvre la liste, chaque message avec SON TEXTE EXACT et le nom de
 *      la famille qui le recevra ;
 *   3. on coche, on envoie — ou on écarte.
 *
 *  Et si la passerelle est éteinte au moment de l'envoi : les messages
 *  approuvés RESTENT en file et partent tout seuls à son retour. Il n'y a rien
 *  à refaire, rien à surveiller — c'est écrit noir sur blanc plutôt que
 *  répété en bandeau sur toutes les pages. */

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Clock, MessageCircle, Send, Trash2, X } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useSession } from "@/lib/store/session";
import { useToast } from "@/lib/store/toast";
import { useWhatsAppQueue } from "@/lib/store/whatsappQueue";
import { explainOffline } from "@/lib/whatsapp/offline";
import type { DraftActionResult, OutboxResponse } from "@/lib/whatsapp/types";

const SENDER_ROLES = ["admin", "reception"];

/** Un horodatage de file, lisible. */
const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("fr-FR", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
};

export function WhatsAppAlertsCard() {
  const role = useSession((s) => s.user?.role);
  const { addToast } = useToast();
  const drafts = useWhatsAppQueue((s) => s.drafts);
  const pending = useWhatsAppQueue((s) => s.pending);
  const draftEntries = useWhatsAppQueue((s) => s.draftEntries);
  const reason = useWhatsAppQueue((s) => s.reason);
  const setQueue = useWhatsAppQueue((s) => s.set);

  const [open, setOpen] = useState(false);
  // On mémorise ce qui est DÉCOCHÉ, pas ce qui est coché. Le cas courant est
  // « envoyer les alertes du jour », pas « en choisir trois sur douze » : tout
  // est donc coché d'office, y compris les lignes qui arrivent pendant que la
  // fenêtre est ouverte — sans qu'un effet ait à recopier la liste dans un
  // état à chaque rafraîchissement.
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<"send" | "discard" | null>(null);

  /** Relit la file. Le vidage de fond la rafraîchit déjà chaque minute ; ceci
   *  sert à ne pas attendre l'intervalle après une action. */
  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/outbox", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as OutboxResponse;
      setQueue({
        pending: data.pending,
        drafts: data.drafts ?? 0,
        entries: data.entries ?? [],
        draftEntries: data.draftEntries ?? [],
      });
    } catch {
      // Sans conséquence : le sondage de fond repassera.
    }
  }, [setQueue]);

  // La fenêtre repart d'une liste fraîche : le sondage de fond ne passe qu'une
  // fois par minute, et on vient peut-être d'en envoyer.
  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  if (!role || !SENDER_ROLES.includes(role)) return null;
  if (drafts === 0 && pending === 0) return null;

  const selected = draftEntries.filter((e) => !excluded.has(e.id)).map((e) => e.id);
  const allSelected = selected.length === draftEntries.length && draftEntries.length > 0;

  const openList = () => {
    setExcluded(new Set());
    setOpen(true);
  };

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function act(action: "send" | "discard") {
    const ids = [...selected];
    if (ids.length === 0) return;
    setBusy(action);
    try {
      const res = await fetch("/api/whatsapp/outbox/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action }),
      });
      const data = (await res.json().catch(() => null)) as
        | (DraftActionResult & { error?: string })
        | null;

      if (!res.ok || !data) {
        addToast({
          type: "danger",
          title: "Action impossible",
          message: data?.error ?? "La file n'a pas répondu. Réessayez dans un instant.",
        });
        return;
      }

      if (action === "discard") {
        addToast({
          type: "info",
          title: "Alertes écartées",
          message: `${data.discarded} message(s) ne partiront pas.`,
        });
      } else if (data.offline) {
        // LE cas qui remplace l'ancien bandeau d'échec : ce n'est pas une
        // panne à gérer, c'est une attente qui se résoudra seule. On le dit,
        // une fois, ici — et on n'en reparle plus.
        const e = explainOffline(data.reason);
        addToast({
          type: "info",
          title: "Alertes en file d'attente",
          message: e.selfHealing
            ? `${data.approved} message(s) approuvés. ${e.what} : ils partiront automatiquement dès son retour, sans rien faire de plus.`
            : `${data.approved} message(s) approuvés — ils attendent en file. ${e.todo}`,
        });
      } else {
        addToast({
          type: "success",
          title: "Alertes envoyées",
          message:
            data.waiting > 0
              ? `${data.sent} message(s) envoyés. ${data.waiting} encore en file : ils partiront automatiquement.`
              : `${data.sent} message(s) envoyés.`,
        });
      }

      setExcluded(new Set());
      await refresh();
      if (data.discarded + data.approved > 0 && drafts - ids.length <= 0) setOpen(false);
    } catch {
      addToast({
        type: "danger",
        title: "Action impossible",
        message: "Réseau injoignable. Les messages restent en attente, rien n'est perdu.",
      });
    } finally {
      setBusy(null);
    }
  }

  const explanation = explainOffline(reason);

  return (
    <>
      <Card className="border border-line card-shadow">
        <CardBody className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/10">
              <MessageCircle className="h-5 w-5 text-warning" />
            </div>
            <div>
              <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink">
                Alertes WhatsApp
              </h3>
              <p className="mt-0.5 text-[11px] text-muted">
                {drafts > 0 ? (
                  <>
                    <strong className="text-warning">
                      {drafts} alerte{drafts > 1 ? "s" : ""} de solde préparée
                      {drafts > 1 ? "s" : ""}
                    </strong>{" "}
                    par les badges. Rien n&apos;est parti : ouvrez pour lire les messages et
                    choisir ce qui s&apos;envoie.
                  </>
                ) : (
                  <>
                    <strong className="text-ink">
                      {pending} message{pending > 1 ? "s" : ""} en file
                    </strong>{" "}
                    — {explanation.selfHealing
                      ? "ils partiront automatiquement dès que la passerelle répondra. Rien à faire."
                      : explanation.todo}
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {pending > 0 && drafts > 0 && (
              <span className="flex items-center gap-1 rounded-lg border border-line bg-canvas/40 px-2 py-1 text-[10px] font-semibold text-muted">
                <Clock className="h-3 w-3" /> {pending} déjà en file
              </span>
            )}
            {drafts > 0 && (
              <Button size="sm" variant="primary" onClick={openList}>
                Voir et envoyer
              </Button>
            )}
          </div>
        </CardBody>
      </Card>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={`Alertes de solde à envoyer (${draftEntries.length})`}
        size="lg"
      >
        <div className="space-y-3">
          <div className="rounded-xl border border-primary/20 bg-primary-50 p-3 text-[11px] leading-relaxed text-primary">
            Ces messages ont été préparés automatiquement quand l&apos;élève a badgé avec un solde
            faible ou en dette. <strong>Aucun n&apos;a été envoyé.</strong> Relisez le texte exact
            que la famille recevra, puis envoyez ce que vous voulez envoyer. Si la passerelle
            WhatsApp est éteinte, les messages approuvés partiront tout seuls dès son retour.
          </div>

          {draftEntries.length === 0 ? (
            <p className="py-10 text-center text-xs italic text-muted">
              Aucune alerte en attente.
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <button
                  type="button"
                  onClick={() =>
                    setExcluded(allSelected ? new Set(draftEntries.map((e) => e.id)) : new Set())
                  }
                  className="font-semibold text-primary hover:underline"
                >
                  {allSelected ? "Tout décocher" : "Tout cocher"}
                </button>
                <span className="text-muted">
                  {selected.length} / {draftEntries.length} sélectionné(s)
                </span>
              </div>

              <div className="max-h-[45vh] space-y-2 overflow-y-auto pe-1">
                {draftEntries.map((entry) => {
                  const checked = !excluded.has(entry.id);
                  return (
                    <button
                      type="button"
                      key={entry.id}
                      onClick={() => toggle(entry.id)}
                      className={`flex w-full items-start gap-3 rounded-xl border p-3 text-start transition-colors ${
                        checked
                          ? "border-primary/40 bg-primary-50"
                          : "border-line bg-canvas/30 hover:border-primary/20"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                          checked ? "border-primary bg-primary text-white" : "border-line bg-surface"
                        }`}
                      >
                        {checked && <Check className="h-3 w-3" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-baseline justify-between gap-2">
                          <strong className="text-xs text-ink">
                            {entry.recipientName || entry.recipient}
                          </strong>
                          <span className="font-mono text-[10px] text-muted">
                            {entry.recipient} · {when(entry.createdAt)}
                          </span>
                        </span>
                        <span className="mt-1.5 block whitespace-pre-wrap rounded-lg border border-line/60 bg-surface p-2 text-[11px] leading-relaxed text-ink">
                          {entry.body}
                        </span>
                        {entry.lastError && (
                          <span className="mt-1 flex items-center gap-1 text-[10px] text-danger">
                            <AlertTriangle className="h-3 w-3" /> Dernier échec : {entry.lastError}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line pt-3">
                <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={!!busy}>
                  <X className="me-1 h-3.5 w-3.5" /> Fermer
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={selected.length === 0 || !!busy}
                  onClick={() => void act("discard")}
                >
                  <Trash2 className="me-1 h-3.5 w-3.5" />
                  {busy === "discard" ? "…" : `Écarter (${selected.length})`}
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  disabled={selected.length === 0 || !!busy}
                  onClick={() => void act("send")}
                >
                  <Send className="me-1 h-3.5 w-3.5" />
                  {busy === "send" ? "Envoi en cours…" : `Envoyer (${selected.length})`}
                </Button>
              </div>
              {busy === "send" && (
                <p className="text-center text-[10px] italic text-muted">
                  L&apos;envoi est volontairement lent : une cadence régulière ferait bannir le
                  numéro WhatsApp de l&apos;école.
                </p>
              )}
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
