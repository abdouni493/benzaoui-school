"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import type { Tone } from "@/components/ui/Badge";
import { AlertTriangle, MessageCircle, Power, RefreshCw } from "lucide-react";
import type { SessionStatePayload } from "@/lib/whatsapp/types";

const STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  created: { label: "Créée — jamais démarrée", tone: "neutral" },
  initializing: { label: "Initialisation…", tone: "warning" },
  qr_ready: { label: "En attente du scan du QR code", tone: "warning" },
  authenticating: { label: "Authentification…", tone: "warning" },
  ready: { label: "Connectée", tone: "success" },
  disconnected: { label: "Déconnectée", tone: "danger" },
  action_required: { label: "Action requise", tone: "danger" },
  failed: { label: "En échec", tone: "danger" },
};

/** Statuts encore en mouvement : le QR expire au bout de quelques dizaines de
 *  secondes et bascule à `ready` dès le scan, donc on continue de relire. */
const TRANSIENT_STATUSES = ["qr_ready", "initializing", "authenticating"];
const POLL_INTERVAL_MS = 5_000;

type FetchOutcome =
  | { ok: true; state: SessionStatePayload }
  | { ok: false; error: string };

async function fetchSessionState(): Promise<FetchOutcome> {
  try {
    const response = await fetch("/api/whatsapp/session", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      return { ok: false, error: payload?.error ?? "Impossible de lire l'état de la passerelle." };
    }
    return { ok: true, state: payload as SessionStatePayload };
  } catch {
    return { ok: false, error: "Impossible de joindre le serveur." };
  }
}

export function WhatsAppSettingsPanel() {
  const [state, setState] = useState<SessionStatePayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  /** Incrémenté pour forcer une relecture (bouton « Actualiser », démarrage). */
  const [reloadToken, setReloadToken] = useState(0);

  // Lecture initiale puis relances tant que la session n'est pas stabilisée.
  // Le drapeau `cancelled` évite d'écrire dans un composant démonté si
  // l'utilisateur quitte l'onglet pendant une requête.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      const outcome = await fetchSessionState();
      if (cancelled) return;

      if (outcome.ok) {
        setState(outcome.state);
        setError(null);
        if (TRANSIENT_STATUSES.includes(outcome.state.status ?? "")) {
          timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
        }
      } else {
        setError(outcome.error);
        setState(null);
      }
      setLoading(false);
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [reloadToken]);

  const handleStart = async () => {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/whatsapp/session", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) setError(payload?.error ?? "Le démarrage a échoué.");
    } catch {
      setError("Impossible de joindre le serveur.");
    } finally {
      setStarting(false);
      setReloadToken((n) => n + 1);
    }
  };

  const status = state?.status ? STATUS_LABELS[state.status] : null;

  return (
    <Card className="border border-line rounded-2xl card-shadow">
      <CardBody className="space-y-6 p-6">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
            <MessageCircle className="h-5 w-5 text-primary" /> Passerelle WhatsApp
          </h3>
          <p className="mt-1 text-xs text-muted">
            Numéro WhatsApp utilisé pour envoyer les alertes de solde aux élèves et aux parents.
          </p>
        </div>

        {loading ? (
          <p className="text-xs text-muted">Lecture de l&apos;état de la passerelle…</p>
        ) : (
          <>
            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {state && !state.configured && (
              <div className="space-y-2 rounded-xl border border-warning/30 bg-warning/10 p-4 text-xs text-ink">
                <strong className="flex items-center gap-2 text-warning">
                  <AlertTriangle className="h-4 w-4" /> Passerelle non configurée
                </strong>
                <p className="text-muted">
                  Renseigner <code className="text-ink">OPENWA_BASE_URL</code>,{" "}
                  <code className="text-ink">OPENWA_API_KEY</code> et{" "}
                  <code className="text-ink">OPENWA_SESSION_ID</code> dans{" "}
                  <code className="text-ink">.env.local</code>, puis redémarrer l&apos;application.
                  La procédure complète (démarrage du service, création de la clé et de la session)
                  est décrite dans <code className="text-ink">openwa/README.md</code>.
                </p>
              </div>
            )}

            {state?.configured && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-canvas/30 p-4">
                  <div className="space-y-1">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">
                      État de la session
                    </span>
                    <Badge tone={status?.tone ?? "neutral"}>
                      {status?.label ?? state.status ?? "Inconnu"}
                    </Badge>
                    {state.phoneNumber && (
                      <span className="block pt-1 text-xs text-ink">
                        Numéro lié : <strong>{state.phoneNumber}</strong>
                      </span>
                    )}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      onClick={() => setReloadToken((n) => n + 1)}
                      className="flex items-center gap-2"
                    >
                      <RefreshCw className="h-4 w-4" /> Actualiser
                    </Button>
                    {state.status !== "ready" && (
                      <Button onClick={handleStart} disabled={starting} className="flex items-center gap-2">
                        <Power className="h-4 w-4" />
                        {starting ? "Démarrage…" : "Démarrer la session"}
                      </Button>
                    )}
                  </div>
                </div>

                {state.lastError && (
                  <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                    Dernière erreur signalée par la passerelle : {state.lastError}
                  </div>
                )}

                {state.qrCode && (
                  <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface p-5">
                    <p className="text-center text-xs text-muted">
                      Ouvrir WhatsApp sur le téléphone de l&apos;école →{" "}
                      <strong className="text-ink">Appareils liés</strong> →{" "}
                      <strong className="text-ink">Lier un appareil</strong>, puis scanner ce code.
                    </p>
                    <Image
                      src={state.qrCode}
                      alt="QR code de connexion WhatsApp"
                      width={256}
                      height={256}
                      unoptimized
                      className="rounded-xl border border-line bg-white p-2"
                    />
                    <span className="text-[10px] text-muted">
                      Le code se régénère automatiquement toutes les quelques secondes.
                    </span>
                  </div>
                )}

                {state.status === "ready" && (
                  <p className="rounded-xl border border-success/30 bg-success/10 p-3 text-xs text-success">
                    La passerelle est opérationnelle : les boutons WhatsApp des fiches élèves et
                    parents envoient depuis ce numéro.
                  </p>
                )}
              </>
            )}

            <div className="rounded-xl border border-line bg-canvas/30 p-4 text-[11px] leading-relaxed text-muted">
              <strong className="mb-1 block text-ink">À savoir</strong>
              WhatsApp n&apos;autorise pas officiellement les clients automatisés : utiliser un
              numéro dédié à l&apos;école, éviter les envois en rafale, et privilégier les alertes
              aux familles déjà inscrites. Un envoi confirmé signifie « accepté par la passerelle »,
              pas « lu par le destinataire ».
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
