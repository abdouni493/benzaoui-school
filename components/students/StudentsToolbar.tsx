"use client";

import {
  AlertTriangle,
  ArrowDownUp,
  BadgeCheck,
  Bell,
  Gift,
  ListChecks,
  Scale,
  Search,
  Users,
  X,
} from "lucide-react";
import { Select } from "@/components/ui/SearchInput";

export type StudentFilter = "all" | "debt" | "soon" | "paid" | "free" | "drift";
export type StudentSort = "recent" | "name" | "balance";

/**
 * L'en-tête de travail de l'écran Étudiants : des compteurs qui SONT les
 * filtres (on clique sur « En dette » pour ne voir que les débiteurs), puis
 * une seule barre — recherche, filtre, tri.
 *
 * Les deux listes d'action (débiteurs, soldes presque épuisés) s'ouvrent depuis
 * leur compteur : on lit le chiffre et on agit au même endroit.
 */
export function StudentsToolbar({
  counts,
  totalOwed,
  filter,
  onFilter,
  search,
  onSearch,
  sort,
  onSort,
  shown,
  onOpenDebtors,
  onOpenLowBalance,
}: {
  counts: Record<StudentFilter, number>;
  totalOwed: number;
  filter: StudentFilter;
  onFilter: (f: StudentFilter) => void;
  search: string;
  onSearch: (v: string) => void;
  sort: StudentSort;
  onSort: (s: StudentSort) => void;
  shown: number;
  onOpenDebtors: () => void;
  onOpenLowBalance: () => void;
}) {
  return (
    <div className="mb-6 space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <StatTile
          active={filter === "all"}
          onClick={() => onFilter("all")}
          icon={<Users className="h-4 w-4" />}
          label="Tous les élèves"
          value={counts.all}
          tone="primary"
        />
        <StatTile
          active={filter === "debt"}
          onClick={() => onFilter("debt")}
          icon={<AlertTriangle className="h-4 w-4" />}
          label="En dette"
          value={counts.debt}
          hint={counts.debt > 0 ? `${totalOwed.toLocaleString("fr-FR")} DA à recouvrer` : "Personne"}
          tone="danger"
          action={counts.debt > 0 ? { label: "Liste", onClick: onOpenDebtors } : undefined}
        />
        <StatTile
          active={filter === "soon"}
          onClick={() => onFilter("soon")}
          icon={<Bell className="h-4 w-4" />}
          label="Presque épuisé"
          value={counts.soon}
          hint="Moins de 2 séances"
          tone="warning"
          action={counts.soon > 0 ? { label: "Alerter", onClick: onOpenLowBalance } : undefined}
        />
        <StatTile
          active={filter === "drift"}
          onClick={() => onFilter("drift")}
          icon={<Scale className="h-4 w-4" />}
          label="Solde à vérifier"
          value={counts.drift}
          hint={counts.drift > 0 ? "Écart avec l'historique" : "Aucun écart"}
          tone="warning"
        />
        <StatTile
          active={filter === "paid"}
          onClick={() => onFilter("paid")}
          icon={<BadgeCheck className="h-4 w-4" />}
          label="À jour"
          value={counts.paid}
          tone="success"
        />
        <StatTile
          active={filter === "free"}
          onClick={() => onFilter("free")}
          icon={<Gift className="h-4 w-4" />}
          label="Cas spéciaux"
          value={counts.free}
          hint="Études gratuites"
          tone="free"
        />
      </div>

      <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-2.5 card-shadow md:flex-row md:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted ltr:left-3 rtl:right-3" />
          <input
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Rechercher par nom, carte RFID, téléphone ou email…"
            className="h-10 w-full rounded-xl border border-line bg-canvas/40 text-sm text-ink outline-none placeholder:text-muted focus:border-primary ltr:pl-9 ltr:pr-9 rtl:pr-9 rtl:pl-9"
          />
          {search && (
            <button
              type="button"
              onClick={() => onSearch("")}
              aria-label="Effacer la recherche"
              className="absolute top-1/2 -translate-y-1/2 rounded-md p-1 text-muted hover:bg-primary-50 hover:text-ink ltr:right-2 rtl:left-2"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-xl bg-primary-50/60 px-3 py-2 text-xs font-semibold text-muted">
            <ListChecks className="h-3.5 w-3.5 text-primary" />
            <strong className="font-mono text-ink">{shown}</strong> affiché(s)
          </span>
          <label className="inline-flex items-center gap-1.5 text-xs text-muted">
            <ArrowDownUp className="h-3.5 w-3.5" />
            <Select value={sort} onChange={(e) => onSort(e.target.value as StudentSort)} className="h-10 text-xs">
              <option value="recent">Plus récents d&apos;abord</option>
              <option value="name">Nom (A → Z)</option>
              <option value="balance">Solde le plus bas d&apos;abord</option>
            </Select>
          </label>
          {filter !== "all" && (
            <button
              type="button"
              onClick={() => onFilter("all")}
              className="inline-flex h-10 items-center gap-1 rounded-xl border border-line px-3 text-xs font-semibold text-muted transition-colors hover:border-primary/50 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" /> Retirer le filtre
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Teintes fixes : en thème sombre, `--warning` et `--success` deviennent
// illisibles sur le fond bordeaux — chaque ton garde sa variante claire.
const TILE_TONES = {
  primary: { icon: "bg-primary/15 text-primary dark:text-rose-200", ring: "ring-primary dark:ring-rose-400", value: "text-ink" },
  danger: { icon: "bg-rose-500/15 text-rose-600 dark:text-rose-300", ring: "ring-rose-500 dark:ring-rose-400", value: "text-rose-600 dark:text-rose-300" },
  warning: { icon: "bg-amber-500/15 text-amber-600 dark:text-amber-300", ring: "ring-amber-500 dark:ring-amber-400", value: "text-amber-600 dark:text-amber-300" },
  success: { icon: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300", ring: "ring-emerald-500 dark:ring-emerald-400", value: "text-emerald-600 dark:text-emerald-300" },
  free: { icon: "bg-violet-500/15 text-violet-600 dark:text-violet-300", ring: "ring-violet-500 dark:ring-violet-400", value: "text-violet-600 dark:text-violet-300" },
} as const;

function StatTile({
  active,
  onClick,
  icon,
  label,
  value,
  hint,
  tone,
  action,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  value: number;
  hint?: string;
  tone: keyof typeof TILE_TONES;
  action?: { label: string; onClick: () => void };
}) {
  const t = TILE_TONES[tone];
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      aria-pressed={active}
      className={`group relative flex cursor-pointer flex-col gap-2 rounded-2xl border bg-gradient-card p-3.5 text-start transition-all card-shadow hover:-translate-y-0.5 hover:border-primary/40 ${
        active ? `border-transparent shadow-lg ring-2 ${t.ring}` : "border-line"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${t.icon}`}>{icon}</span>
        {active && !action && (
          <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary dark:text-rose-200">
            Filtre
          </span>
        )}
        {action && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              action.onClick();
            }}
            className="rounded-lg border border-line bg-surface px-2 py-1 text-[10px] font-bold text-muted transition-colors hover:border-primary/50 hover:text-ink"
          >
            {action.label}
          </button>
        )}
      </div>
      <div className="min-w-0">
        <strong className={`block font-mono text-2xl font-black leading-none ${t.value}`}>{value}</strong>
        <span className="mt-1 block truncate text-[11px] font-semibold text-ink">{label}</span>
        {hint && <span className="block truncate text-[10px] text-muted">{hint}</span>}
      </div>
    </div>
  );
}
