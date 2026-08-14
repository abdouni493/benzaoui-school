"use client";

import { useEffect, useState } from "react";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { AlertTriangle, CheckCircle2, MessageCircle, RefreshCw, ShieldCheck } from "lucide-react";
import type { WhatsAppConfigState } from "@/lib/whatsapp/types";

/** Libellés des modèles d'alerte, pour signaler ceux qui restent à configurer. */
const TEMPLATE_LABELS: Record<string, string> = {
  debt: "Alerte de dette",
  balance_empty: "Solde épuisé",
  balance_low: "Solde bientôt épuisé",
  registration: "Frais d'inscription",
};
const ALERT_TEMPLATE_IDS = ["debt", "balance_empty", "balance_low", "registration"] as const;

type FetchOutcome = { ok: true; state: WhatsAppConfigState } | { ok: false; error: string };

async function fetchConfigState(): Promise<FetchOutcome> {
  try {
    const response = await fetch("/api/whatsapp/status", { cache: "no-store" });
    const payload = await response.json();
    if (!response.ok) {
      return { ok: false, error: payload?.error ?? "Impossible de lire l'état de la configuration." };
    }
    return { ok: true, state: payload as WhatsAppConfigState };
  } catch {
    return { ok: false, error: "Impossible de joindre le serveur." };
  }
}

export function WhatsAppSettingsPanel() {
  const [state, setState] = useState<WhatsAppConfigState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // `loading` démarre à true (état initial) ; on ne le repositionne pas
    // synchronement ici — une actualisation remplace simplement les données.
    void fetchConfigState().then((outcome) => {
      if (cancelled) return;
      if (outcome.ok) {
        setState(outcome.state);
        setError(null);
      } else {
        setError(outcome.error);
        setState(null);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const missingTemplates = state
    ? ALERT_TEMPLATE_IDS.filter((id) => !state.configuredTemplates.includes(id))
    : [];

  return (
    <Card className="border border-line rounded-2xl card-shadow">
      <CardBody className="space-y-6 p-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-bold text-ink">
              <MessageCircle className="h-5 w-5 text-primary" /> WhatsApp Cloud API (Meta)
            </h3>
            <p className="mt-1 text-xs text-muted">
              Numéro WhatsApp officiel de l&apos;école, utilisé pour les alertes de solde aux élèves
              et aux parents via l&apos;API Cloud de Meta.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => setReloadToken((n) => n + 1)}
            className="flex shrink-0 items-center gap-2"
          >
            <RefreshCw className="h-4 w-4" /> Actualiser
          </Button>
        </div>

        {loading ? (
          <p className="text-xs text-muted">Lecture de l&apos;état de la configuration…</p>
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
                  Renseigner côté serveur (fichier <code className="text-ink">.env.local</code> ou
                  variables d&apos;environnement Vercel) au minimum{" "}
                  <code className="text-ink">WHATSAPP_ACCESS_TOKEN</code> et{" "}
                  <code className="text-ink">WHATSAPP_PHONE_NUMBER_ID</code>, puis redémarrer
                  l&apos;application. La procédure complète (compte Meta, jeton, webhook, modèles)
                  est décrite dans le <code className="text-ink">README</code>.
                </p>
              </div>
            )}

            {state?.configured && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-canvas/30 p-4">
                  <div className="space-y-1">
                    <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">
                      Connexion à Meta
                    </span>
                    <Badge tone={state.connected ? "success" : "danger"}>
                      {state.connected ? "Connectée" : "Non connectée"}
                    </Badge>
                    {state.phoneNumber && (
                      <span className="block pt-1 text-xs text-ink">
                        Numéro : <strong>{state.phoneNumber}</strong>
                        {state.verifiedName ? ` — ${state.verifiedName}` : ""}
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
                  <InfoRow label="Phone Number ID" value={state.phoneNumberIdMasked ?? "—"} />
                  <InfoRow label="Business Account ID" value={state.businessAccountIdMasked ?? "—"} />
                  <InfoRow label="Version API Graph" value={state.apiVersion || "—"} />
                  <InfoRow
                    label="Webhook"
                    value={state.webhookConfigured ? "Jeton configuré" : "Non configuré"}
                    tone={state.webhookConfigured ? "success" : "warning"}
                  />
                </dl>

                <div className="rounded-xl border border-line bg-canvas/30 p-4">
                  <span className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-muted">
                    Modèles d&apos;alerte approuvés
                  </span>
                  {missingTemplates.length === 0 ? (
                    <p className="flex items-center gap-2 text-xs text-success">
                      <CheckCircle2 className="h-4 w-4" /> Les quatre modèles d&apos;alerte sont
                      configurés.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      <p className="text-xs text-muted">
                        Ces modèles n&apos;ont pas de nom Meta configuré : les alertes correspondantes
                        échoueront tant que le nom du modèle approuvé n&apos;est pas renseigné.
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {missingTemplates.map((id) => (
                          <Badge key={id} tone="warning" className="text-[10px]">
                            {TEMPLATE_LABELS[id] ?? id}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="rounded-xl border border-line bg-canvas/30 p-4 text-[11px] leading-relaxed text-muted">
              <strong className="mb-1 block text-ink">À savoir</strong>
              Les identifiants (jeton d&apos;accès, App Secret, jeton du webhook) sont configurés
              uniquement côté serveur et ne sont jamais exposés ici. Les alertes proactives partent
              en <strong>modèles approuvés par Meta</strong> ; un message libre n&apos;est possible
              que si la famille a écrit à l&apos;école dans les dernières 24 h. Un envoi accepté
              signifie « pris en charge par Meta », pas « lu » : le statut réel (remis/lu) remonte
              ensuite via le webhook.
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
      <dd className={`font-mono text-xs ${tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-ink"}`}>
        {value}
      </dd>
    </div>
  );
}
