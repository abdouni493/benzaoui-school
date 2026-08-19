"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import {
  AlertTriangle,
  CheckCircle2,
  LogOut,
  MessageCircle,
  QrCode,
  RefreshCw,
  RotateCw,
  ShieldCheck,
} from "lucide-react";
import type { WhatsAppSessionResponse } from "@/lib/whatsapp/types";

/** Actions pilotant la session, côté /api/whatsapp/session. */
type Action = "setup" | "connect" | "logout" | "restart";

/** Cadence de rafraîchissement pendant qu'un QR est affiché. On interroge
 *  l'ÉTAT (pas un nouveau QR) : chaque QR demandé consomme le quota
 *  QRCODE_LIMIT de la passerelle. */
const POLL_MS = 5000;

type Outcome =
  | { ok: true; state: WhatsAppSessionResponse }
  | { ok: false; error: string };

async function callSession(action?: Action): Promise<Outcome> {
  try {
    const response = await fetch("/api/whatsapp/session", {
      method: action ? "POST" : "GET",
      cache: "no-store",
      ...(action
        ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) }
        : {}),
    });
    const payload = await response.json();
    if (!response.ok) {
      return { ok: false, error: payload?.error ?? "Impossible de lire l'état de la session." };
    }
    return { ok: true, state: payload as WhatsAppSessionResponse };
  } catch {
    return { ok: false, error: "Impossible de joindre le serveur." };
  }
}

export function WhatsAppSettingsPanel() {
  const [state, setState] = useState<WhatsAppSessionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Action | null>(null);
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);

  // Évite un setState après démontage (le composant vit dans un onglet).
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    const outcome = await callSession();
    if (!mounted.current) return outcome;
    if (outcome.ok) {
      setState(outcome.state);
      setError(null);
      // Session ouverte : le QR n'a plus lieu d'être affiché.
      if (outcome.state.connected) {
        setQrBase64(null);
        setPairingCode(null);
      }
    } else {
      setError(outcome.error);
    }
    setLoading(false);
    return outcome;
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Le QR expire vite : tant qu'il est à l'écran et que la session n'est pas
  // ouverte, on surveille l'état pour basculer dès que le scan est pris en
  // compte. L'intervalle est nettoyé au démontage.
  useEffect(() => {
    if (!qrBase64 || state?.connected) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [qrBase64, state?.connected, refresh]);

  const run = async (action: Action) => {
    setBusy(action);
    setError(null);
    const outcome = await callSession(action);
    if (!mounted.current) return;

    if (outcome.ok) {
      setState(outcome.state);
      setQrBase64(outcome.state.qrBase64);
      setPairingCode(outcome.state.pairingCode);
      if (action === "logout") setConfirmLogout(false);
    } else {
      setError(outcome.error);
    }
    setBusy(null);
  };

  const label = (action: Action, idle: string, running: string) =>
    busy === action ? `${running}…` : idle;

  return (
    <Card className="border border-line rounded-2xl card-shadow">
      <CardBody className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
              <MessageCircle className="h-5 w-5 text-primary" /> WhatsApp — passerelle de
              l&apos;école
            </h3>
            <p className="mt-1 text-xs text-muted">
              Les messages partent du numéro WhatsApp de l&apos;école, via une passerelle
              auto-hébergée. Aucun modèle à faire approuver.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => void refresh()}
            disabled={busy !== null}
            className="flex shrink-0 items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" /> Actualiser
          </Button>
        </div>

        {loading ? (
          <p className="text-xs text-muted">Lecture de l&apos;état de la session…</p>
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
                  <AlertTriangle className="h-4 w-4" /> WhatsApp non configuré
                </strong>
                <p className="text-muted">
                  Renseigner côté serveur (fichier <code className="text-ink">.env.local</code> en
                  local, variables d&apos;environnement Vercel en production) au minimum{" "}
                  <code className="text-ink">EVOLUTION_BASE_URL</code> et{" "}
                  <code className="text-ink">EVOLUTION_API_KEY</code>, puis redémarrer
                  l&apos;application. La procédure complète (VPS, Docker, première connexion) est
                  décrite dans le <code className="text-ink">README</code>.
                </p>
              </div>
            )}

            {state?.configured && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-canvas/30 p-4">
                  <div className="space-y-1">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">
                      Session WhatsApp
                    </span>
                    <Badge tone={state.connected ? "success" : "danger"}>
                      {state.connected ? "Connectée" : "Non connectée"}
                    </Badge>
                    {state.connected && state.linkedNumber && (
                      <span className="block pt-1 text-xs text-ink">
                        Numéro lié : <strong>{state.linkedNumber}</strong>
                        {state.profileName ? ` — ${state.profileName}` : ""}
                      </span>
                    )}
                  </div>
                  <ShieldCheck
                    className={`h-8 w-8 ${state.connected ? "text-success" : "text-muted/40"}`}
                  />
                </div>

                {state.error && !state.connected && (
                  <div className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs text-danger">
                    {state.error}
                  </div>
                )}

                <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
                  <InfoRow label="Instance" value={state.instanceMasked ?? "—"} />
                  <InfoRow label="Serveur" value={state.baseUrlHost ?? "—"} />
                  <InfoRow
                    label="Webhook"
                    value={state.webhookConfigured ? "Jeton configuré" : "Non configuré"}
                    tone={state.webhookConfigured ? "success" : "warning"}
                  />
                  <InfoRow
                    label="État brut"
                    value={state.state}
                    tone={state.connected ? "success" : undefined}
                  />
                </dl>

                {/* ---- Session ouverte ---- */}
                {state.connected && (
                  <div className="space-y-3">
                    <p className="flex items-center gap-2 text-xs text-success">
                      <CheckCircle2 className="h-4 w-4" /> La passerelle est prête : les alertes et
                      les envois groupés fonctionnent.
                    </p>

                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        onClick={() => void run("restart")}
                        disabled={busy !== null}
                        className="flex items-center gap-2"
                      >
                        <RotateCw className="h-4 w-4" />
                        {label("restart", "Redémarrer la session", "Redémarrage")}
                      </Button>

                      {confirmLogout ? (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 p-2">
                          <span className="text-xs text-danger">
                            Confirmer la déconnexion ? Plus aucun message ne partira.
                          </span>
                          <Button
                            onClick={() => void run("logout")}
                            disabled={busy !== null}
                            className="flex items-center gap-2"
                          >
                            <LogOut className="h-4 w-4" />
                            {label("logout", "Oui, déconnecter", "Déconnexion")}
                          </Button>
                          <Button
                            variant="outline"
                            onClick={() => setConfirmLogout(false)}
                            disabled={busy !== null}
                          >
                            Annuler
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          onClick={() => setConfirmLogout(true)}
                          disabled={busy !== null}
                          className="flex items-center gap-2"
                        >
                          <LogOut className="h-4 w-4" /> Déconnecter
                        </Button>
                      )}
                    </div>

                    <p className="text-[11px] text-muted">
                      Déconnecter délie le téléphone : tous les envois automatiques s&apos;arrêtent
                      jusqu&apos;à un nouveau scan du QR code.
                    </p>
                  </div>
                )}

                {/* ---- Session fermée : connexion ---- */}
                {!state.connected && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => void run("connect")}
                        disabled={busy !== null}
                        className="flex items-center gap-2"
                      >
                        <QrCode className="h-4 w-4" />
                        {qrBase64
                          ? label("connect", "Nouveau QR code", "Génération")
                          : label("connect", "Connecter WhatsApp", "Connexion")}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void run("setup")}
                        disabled={busy !== null}
                        className="flex items-center gap-2"
                      >
                        {label("setup", "Initialiser l'instance", "Initialisation")}
                      </Button>
                    </div>

                    <p className="text-[11px] text-muted">
                      « Initialiser » crée l&apos;instance sur la passerelle et y enregistre
                      l&apos;adresse du webhook. À faire une fois, et de nouveau après un changement
                      de domaine.
                    </p>

                    {qrBase64 && (
                      <div className="space-y-3 rounded-xl border border-line bg-canvas/30 p-4">
                        <div className="flex justify-center">
                          <img
                            src={qrBase64}
                            alt="QR code de connexion WhatsApp"
                            width={256}
                            height={256}
                            className="h-64 w-64 rounded-lg border-8 border-white bg-white"
                          />
                        </div>

                        <ol className="mx-auto max-w-xs list-decimal space-y-1 ps-5 text-[11px] leading-relaxed text-muted">
                          <li>Ouvrir WhatsApp sur le téléphone de l&apos;école</li>
                          <li>Menu ⋮ (ou Réglages) → Appareils connectés</li>
                          <li>Connecter un appareil</li>
                          <li>Scanner ce code</li>
                        </ol>

                        {pairingCode && (
                          <p className="text-center text-xs text-ink">
                            Code d&apos;appairage : <strong className="font-mono">{pairingCode}</strong>
                          </p>
                        )}

                        <p className="text-center text-[10px] text-muted">
                          Le code expire en moins d&apos;une minute. L&apos;état est vérifié
                          automatiquement toutes les 5 secondes.
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="rounded-xl border border-line bg-canvas/30 p-4 text-[11px] leading-relaxed text-muted">
              <strong className="mb-1 block text-ink">À savoir</strong>
              <ul className="list-disc space-y-1 ps-4">
                <li>
                  Les messages partent du numéro WhatsApp de l&apos;école via une passerelle
                  auto-hébergée : il n&apos;y a plus aucun modèle à faire approuver, et les textes
                  se modifient librement.
                </li>
                <li>
                  La passerelle doit rester allumée. Si le serveur est éteint,{" "}
                  <strong className="text-ink">aucun message ne part</strong>.
                </li>
                <li>
                  Le téléphone qui a scanné le QR code doit se reconnecter à Internet de temps en
                  temps, sinon WhatsApp finit par délier l&apos;appareil.
                </li>
                <li>
                  Envoyer trop de messages d&apos;un coup, ou écrire à des personnes qui
                  n&apos;attendent rien de l&apos;école, peut faire{" "}
                  <strong className="text-ink">bannir le numéro</strong> par WhatsApp.
                  L&apos;application temporise volontairement les envois groupés.
                </li>
                <li>
                  Les identifiants de la passerelle sont configurés uniquement côté serveur et ne
                  sont jamais exposés ici.
                </li>
              </ul>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function InfoRow({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning";
}) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2">
      <dt className="text-[10px] font-bold uppercase tracking-wider text-muted">{label}</dt>
      <dd
        className={`font-mono text-xs ${tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-ink"}`}
      >
        {value}
      </dd>
    </div>
  );
}
