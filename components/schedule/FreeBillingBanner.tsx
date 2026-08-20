"use client";

import { useData } from "@/lib/store/data";
import { Gift } from "lucide-react";
import { formatDateFr } from "@/lib/helpers";

/**
 * « Pourquoi le scan ne débite-t-il rien ? »
 *
 * Trois réglages mettent une séance à 0 DA : une PÉRIODE GRATUITE en cours, un
 * CRÉNEAU de séance libre coché « offert », et une inscription dont la date de
 * début de facturation n'est pas encore atteinte. Chacun est voulu — mais tant
 * qu'ils restaient invisibles hors du toast de scan, un guichet pouvait badger
 * toute une journée en croyant à une panne de facturation.
 *
 * Cette bannière rend le premier cas permanent à l'écran, et rappelle les deux
 * autres. Elle ne s'affiche que quand une gratuité est réellement active.
 */
export function FreeBillingBanner({ date }: { date?: string }) {
  const { freePeriods, sessions } = useData();

  const day = date ?? new Date().toLocaleDateString("fr-CA");

  const active = freePeriods.filter((fp) => fp.active && fp.startDate <= day && fp.endDate >= day);

  // Créneaux « séance libre » offerts, encore dans leur période de validité.
  const freeSeances = sessions.filter(
    (s) =>
      s.isOpen &&
      s.isFree &&
      (!s.periodStart || s.periodStart <= day) &&
      (!s.periodEnd || s.periodEnd >= day),
  );

  if (active.length === 0 && freeSeances.length === 0) return null;

  return (
    <div className="flex items-start gap-2.5 rounded-2xl border border-success/30 bg-success/10 p-3 text-xs">
      <Gift className="mt-0.5 h-4.5 w-4.5 shrink-0 text-success" />
      <div className="space-y-1">
        <strong className="block text-success">Gratuité en cours — les scans ne débitent rien</strong>

        {active.map((fp) => (
          <p key={fp.id} className="text-[11px] text-ink">
            Période gratuite <strong>« {fp.name || "sans nom"} »</strong> du{" "}
            <strong>{formatDateFr(fp.startDate)}</strong> au <strong>{formatDateFr(fp.endDate)}</strong> —{" "}
            {fp.allClasses ? "toutes les classes" : `${fp.classIds.length} classe(s)`}. Chaque présence est
            enregistrée normalement, mais <strong>aucun solde n&apos;est débité</strong> tant qu&apos;elle
            dure.
          </p>
        ))}

        {freeSeances.length > 0 && (
          <p className="text-[11px] text-ink">
            <strong>{freeSeances.length} créneau(x) « séance libre offerte »</strong> : ni débit élève, ni
            encaissement, ni rémunération enseignant.
          </p>
        )}

        <p className="text-[10px] text-muted">
          Pour rétablir la facturation : désactivez la période depuis{" "}
          <strong className="text-ink">Abonnements → Périodes gratuites</strong>. Une inscription dont la
          « date de début de facturation » est encore à venir est offerte elle aussi — elle apparaît alors
          « AVANT LE DÉBUT » sur le scan.
        </p>
      </div>
    </div>
  );
}
