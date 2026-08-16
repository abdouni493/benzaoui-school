"use client";

import { Clock, MapPin, Users } from "lucide-react";
import { Input, Select } from "@/components/ui/SearchInput";
import type { DiscountType, SubscriptionDiscount } from "@/lib/types";
import {
  addMonths,
  daysUntil,
  discountLabel,
  formatDateFr,
  netPriceFor,
  todayIso,
} from "@/lib/helpers";

// -----------------------------------------------------------------------------
// What can be assigned: one entry per COURS, one option per GROUPE.
// A student is enrolled in a cours (class + module + teacher) through exactly
// ONE of its groups. Every group of a cours shares the same tariff, so the price
// never depends on which group is picked — only the timing does.
// -----------------------------------------------------------------------------

/** One group of a cours = one timing the student may be enrolled on. */
export interface AssignGroupOption {
  /** subscription id — this is what gets stored on the student */
  id: string;
  sessionId: string;
  groupName: string;
  salleName: string;
  daysLabel: string;
  time: string;
  enrolled: number;
}

export interface AssignItem {
  /** subscription id of the selected (or first) group — the item's own key */
  id: string;
  key: string;
  label: string;
  moduleName: string;
  className: string;
  levelLabel: string;
  filiereLabel: string;
  teacherName: string;
  details: string;
  price: number;
  isCoursework: boolean;
  isFormation?: boolean;
  isOpen?: boolean;
  periodMonths?: number;
  periodLabel?: string;
  groupOptions: AssignGroupOption[];
}

/** Which subscription (i.e. which group) of this cours is currently picked. */
export function selectedGroupIn(item: AssignItem, selectedIds: string[]): string | undefined {
  return item.isCoursework
    ? selectedIds.includes(item.id)
      ? item.id
      : undefined
    : item.groupOptions.find((g) => selectedIds.includes(g.id))?.id;
}

export interface EnrollmentCardsProps {
  items: AssignItem[];
  /** subscription (or coursework) ids currently enrolled on */
  selectedIds: string[];
  /** subscription id -> date d'inscription (YYYY-MM-DD) */
  subDates: Record<string, string>;
  /** subscription id -> date de début de facturation (YYYY-MM-DD) */
  startDates: Record<string, string>;
  discounts: Record<string, SubscriptionDiscount>;
  onPickGroup: (item: AssignItem, groupSubId: string) => void;
  onToggleCoursework: (item: AssignItem) => void;
  onSubDateChange: (subId: string, value: string) => void;
  onStartDateChange: (subId: string, value: string) => void;
  onDiscountChange: (subId: string, patch: Partial<SubscriptionDiscount>) => void;
  emptyLabel: string;
  /** height of the scrolling area — the two screens don't have the same room */
  className?: string;
}

/**
 * The scrollable list of assignable cours / séances libres / stages, shared by
 * the "Nouvel étudiant" screen (inscriptions taken at creation time) and the
 * "Affecter des abonnements" screen (inscriptions edited afterwards), so both
 * always offer exactly the same choices, dates and reductions.
 */
export function EnrollmentCards({
  items,
  selectedIds,
  subDates,
  startDates,
  discounts,
  onPickGroup,
  onToggleCoursework,
  onSubDateChange,
  onStartDateChange,
  onDiscountChange,
  emptyLabel,
  className = "max-h-[26rem]",
}: EnrollmentCardsProps) {
  return (
    <div
      className={`border border-line rounded-xl overflow-y-auto p-2 bg-canvas/30 space-y-2 ${className}`}
    >
      {items.length === 0 ? (
        <p className="px-2 py-3 text-xs italic text-muted">{emptyLabel}</p>
      ) : (
        items.map((item) => {
          const selectedId = selectedGroupIn(item, selectedIds);
          const isChecked = !!selectedId;
          // Reductions and enrollment dates hang off the CHOSEN group.
          const keyId = selectedId ?? item.id;
          const startDate = startDates[keyId] || todayIso();
          const subDate = subDates[keyId] || todayIso();
          const expiryDate = item.isFormation ? addMonths(startDate, item.periodMonths ?? 0) : "";
          // Billing has not opened yet: séances attended until then are
          // recorded but never taken off the balance.
          const startsLater = daysUntil(startDate) > 0;
          const discount = discounts[keyId];
          const net = netPriceFor(item.price, discount);
          const hasDiscount = !!discount && discount.value > 0;
          const chosen = item.groupOptions.find((g) => g.id === selectedId);

          return (
            <div
              key={item.key}
              className={`rounded-xl border p-2.5 ${
                isChecked ? "border-primary/30 bg-primary-50/60" : "border-line/70 bg-surface"
              }`}
            >
              {/* ---- Course header: everything about the timing ---- */}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <strong className="block text-xs font-bold text-ink">
                    {item.moduleName}
                    {item.isFormation && (
                      <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                        Formation
                      </span>
                    )}
                    {item.isOpen && (
                      <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-success/15 text-success">
                        Séance libre
                      </span>
                    )}
                    {item.isCoursework && (
                      <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-warning/15 text-warning">
                        Stage
                      </span>
                    )}
                    {hasDiscount && (
                      <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded bg-success/15 text-success">
                        {discountLabel(discount)}
                      </span>
                    )}
                  </strong>
                  <span className="mt-0.5 block text-[10px] text-muted">
                    {item.isCoursework ? (
                      item.details
                    ) : (
                      <>
                        Classe : <strong className="text-ink">{item.className}</strong>
                        {item.levelLabel ? ` (${item.levelLabel})` : ""}
                        {item.filiereLabel ? ` · ${item.filiereLabel}` : ""} · Enseignant :{" "}
                        <strong className="text-ink">{item.teacherName}</strong>
                        {item.periodLabel ? ` · ${item.periodLabel}` : ""}
                      </>
                    )}
                  </span>
                </div>
                <div className="shrink-0 text-end">
                  <span className="text-xs font-bold text-primary">
                    {hasDiscount && (
                      <span className="me-1 font-normal text-muted line-through">{item.price}</span>
                    )}
                    {net} DA
                    {item.isFormation && (
                      <span className="font-semibold text-muted"> / {item.periodMonths} mois</span>
                    )}
                  </span>
                  {!item.isCoursework && (
                    <span className="block text-[9px] text-muted">
                      {item.groupOptions.length} groupe{item.groupOptions.length > 1 ? "s" : ""} · même tarif
                    </span>
                  )}
                </div>
              </div>

              {/* ---- Group picker: the student joins ONE group ---- */}
              {item.isCoursework ? (
                <button
                  onClick={() => onToggleCoursework(item)}
                  className={`mt-2 flex w-full items-center justify-between rounded-lg border p-2 text-[11px] transition-colors ${
                    isChecked
                      ? "border-primary bg-primary text-white"
                      : "border-line bg-canvas/40 text-ink hover:bg-primary-50"
                  }`}
                >
                  <span className="font-bold">{item.label}</span>
                  <input type="checkbox" checked={isChecked} readOnly className="h-4 w-4" />
                </button>
              ) : (
                <div className="mt-2 space-y-1">
                  <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-muted">
                    <Users className="h-3 w-3" /> Choisir le créneau (groupe) de l&apos;étudiant
                  </span>
                  {item.groupOptions.map((g) => {
                    const active = selectedId === g.id;
                    return (
                      <button
                        key={g.id}
                        onClick={() => onPickGroup(item, g.id)}
                        className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-start text-[11px] transition-colors ${
                          active
                            ? "border-primary bg-primary text-white"
                            : "border-line bg-canvas/40 text-ink hover:bg-primary-50"
                        }`}
                      >
                        <span className="font-bold">{g.groupName}</span>
                        <span
                          className={`flex flex-wrap items-center gap-x-3 gap-y-0.5 ${
                            active ? "text-white/85" : "text-muted"
                          }`}
                        >
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" /> {g.daysLabel} · {g.time}
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {g.salleName}
                          </span>
                          <span>{g.enrolled} inscrit(s)</span>
                        </span>
                        <input type="radio" checked={active} readOnly className="h-4 w-4 shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}

              {isChecked && (
                <div className="mt-2 flex flex-wrap items-end gap-4 rounded-xl border border-line bg-surface p-2.5">
                  {chosen && (
                    <div className="pb-1.5 text-xs">
                      <span className="mb-1 block text-[10px] font-semibold text-muted">Créneau affecté</span>
                      <strong className="text-primary">{chosen.groupName}</strong>
                      <span className="text-muted">
                        {" "}
                        · {chosen.daysLabel} · {chosen.time}
                      </span>
                    </div>
                  )}

                  {/* Enrollment dates — every module, cours or formation.
                      Both stay editable: reopening this list reloads them. */}
                  {!item.isCoursework && (
                    <>
                      <div>
                        <label className="block text-[10px] font-semibold text-muted mb-1">
                          Date d&apos;inscription
                        </label>
                        <Input
                          type="date"
                          value={subDate}
                          onChange={(e) => onSubDateChange(keyId, e.target.value)}
                          className="w-40"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold text-muted mb-1">
                          Date de début *
                        </label>
                        <Input
                          type="date"
                          value={startDate}
                          onChange={(e) => onStartDateChange(keyId, e.target.value)}
                          className="w-40"
                        />
                        {startsLater && (
                          <span className="mt-1 block text-[9px] font-semibold text-success">
                            Séances offertes jusqu&apos;au {formatDateFr(startDate)}
                          </span>
                        )}
                      </div>
                      {item.isFormation && (
                        <div className="pb-1.5 text-xs">
                          <span className="block text-[10px] font-semibold text-muted mb-1">
                            Date d&apos;expiration (calculée)
                          </span>
                          <strong className="text-primary">{formatDateFr(expiryDate)}</strong>
                          <span className="text-muted"> · {item.periodMonths} mois</span>
                        </div>
                      )}
                    </>
                  )}

                  {/* Per-module reduction */}
                  <div>
                    <label className="block text-[10px] font-semibold text-muted mb-1">Réduction</label>
                    <Select
                      value={discount?.type ?? "percent"}
                      onChange={(e) => onDiscountChange(keyId, { type: e.target.value as DiscountType })}
                      className="w-36"
                    >
                      <option value="percent">Pourcentage (%)</option>
                      <option value="amount">Montant fixe (DA)</option>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-muted mb-1">
                      Valeur {(discount?.type ?? "percent") === "percent" ? "(%)" : "(DA)"}
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={(discount?.type ?? "percent") === "percent" ? 100 : undefined}
                      value={discount?.value || ""}
                      onChange={(e) => onDiscountChange(keyId, { value: Number(e.target.value) })}
                      placeholder="0"
                      className="w-28"
                    />
                  </div>
                  <div className="pb-1.5 text-xs">
                    <span className="block text-[10px] font-semibold text-muted mb-1">
                      Tarif après réduction
                    </span>
                    <strong className={hasDiscount ? "text-success" : "text-ink"}>{net} DA</strong>
                    {hasDiscount && <span className="text-muted"> (au lieu de {item.price} DA)</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
