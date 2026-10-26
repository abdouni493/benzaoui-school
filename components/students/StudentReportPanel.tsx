"use client";

import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { BookOpen, CalendarRange, FileBarChart, Printer, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { printHtmlDocument } from "@/lib/print";
import { schoolDateKey, schoolDateTimeLabel } from "@/lib/helpers";
import {
  buildStudentActivityReport,
  computeStudentReport,
  MONTHS_FR,
  periodLabel,
  studentTimetablesOf,
  type ReportPeriod,
  type ReportTimetable,
  type StudentReport,
  type StudentReportData,
  type StudentTimetable,
} from "@/lib/reports/studentActivity";
import type { Student } from "@/lib/types";

/** « Maths · 3AS Sciences · G1 » — ce qui distingue deux créneaux d'une matière. */
export function timetableTitle(t: StudentTimetable): string {
  return [t.name, t.className, t.group].filter(Boolean).join(" · ");
}

const STATUS_LABELS: Record<StudentTimetable["status"], string> = {
  current: "Inscrit",
  left: "Désinscrit",
  deleted: "Emploi du temps supprimé",
};

export function TimetableStatusBadge({ timetable }: { timetable: StudentTimetable }) {
  const tone = timetable.status === "current" ? "success" : timetable.status === "left" ? "warning" : "danger";
  return (
    <>
      <Badge tone={tone} className="px-1.5 py-0 text-[9px]">
        {STATUS_LABELS[timetable.status]}
      </Badge>
      {timetable.isOpen && (
        <Badge tone="primary" className="px-1.5 py-0 text-[9px]">
          Séance libre
        </Badge>
      )}
    </>
  );
}

/** Ce que l'écran lit dans le store pour bâtir le rapport d'un élève. */
export function useStudentReportData(student: Student): StudentReportData {
  const slices = useData(
    useShallow((s) => ({
      balanceTx: s.balanceTx,
      attendance: s.attendance,
      absencePenalties: s.absencePenalties,
      sessions: s.sessions,
      subscriptions: s.subscriptions,
      modules: s.modules,
      groups: s.groups,
      classes: s.classes,
      teachers: s.teachers,
      salles: s.salles,
    })),
  );
  return useMemo(() => ({ student, ...slices }), [student, slices]);
}

/**
 * Onglet « Rapport » de la fiche étudiant : on choisit une période et des
 * emplois du temps — ceux d'aujourd'hui comme ceux qu'il a quittés —, on
 * génère, on lit, puis on imprime le même contenu sur papier à en-tête.
 */
export function StudentReportPanel({ student, debtTotal }: { student: Student; debtTotal: number }) {
  const { parents, school } = useData(useShallow((s) => ({ parents: s.parents, school: s.school })));
  const language = useSettings((s) => s.language);
  const data = useStudentReportData(student);

  // Ses emplois du temps d'aujourd'hui ET ceux qu'il a quittés : désinscrire
  // ne retire rien de son historique, le rapport doit pouvoir le montrer.
  const timetables = useMemo(() => studentTimetablesOf(data), [data]);
  const currentTimetables = timetables.filter((t) => t.status === "current");
  const pastTimetables = timetables.filter((t) => t.status !== "current");

  const now = new Date();
  const [mode, setMode] = useState<ReportPeriod["mode"]>("month");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  // Les clés DÉCOCHÉES : un emploi du temps apparu depuis (inscription du
  // jour, synchronisation) est coché d'office.
  const [unselected, setUnselected] = useState<string[]>([]);
  const selected = timetables.filter((t) => !unselected.includes(t.key)).map((t) => t.key);
  const [result, setResult] = useState<{ period: ReportPeriod; report: StudentReport } | null>(null);

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 4 + i);
  const allSelected = timetables.length > 0 && selected.length === timetables.length;
  const rangeInvalid = mode === "range" && !!start && !!end && start > end;

  const toggle = (key: string) =>
    setUnselected((cur) => (cur.includes(key) ? cur.filter((x) => x !== key) : [...cur, key]));

  const generate = () => {
    const period: ReportPeriod =
      mode === "month" ? { mode, year, month } : mode === "range" ? { mode, start, end } : { mode: "all" };
    // L'ordre des emplois du temps suit celui de la fiche, pas celui des clics.
    setResult({ period, report: computeStudentReport({ ...data, period, timetableKeys: selected }) });
  };

  const print = () => {
    if (!result) return;
    printHtmlDocument(
      buildStudentActivityReport({
        student,
        school,
        lang: language,
        period: result.period,
        report: result.report,
        debtTotal,
        parents,
      }),
    );
  };

  // À l'heure de l'école : la chaîne stockée est en UTC (15 h 30 s'y lit 14:30).
  const fmtDT = (iso: string) => schoolDateTimeLabel(iso);
  const fmtDay = (d?: string) => (d ? d.split("-").reverse().join("/") : "-");
  /** Le jour d'une ligne : un horodatage (avec fuseau) se lit au jour de l'école. */
  const fmtLineDay = (iso?: string) =>
    iso ? fmtDay(/(Z|[+-]\d\d:?\d\d)$/.test(iso) ? schoolDateKey(iso) : iso.slice(0, 10)) : "-";

  const picker = (list: StudentTimetable[]) => (
    <div className="flex flex-wrap gap-2">
      {list.map((t) => {
        const on = selected.includes(t.key);
        return (
          <label
            key={t.key}
            className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
              on ? "border-primary bg-primary/10 text-primary" : "border-line bg-surface text-muted"
            }`}
          >
            <input type="checkbox" checked={on} onChange={() => toggle(t.key)} className="h-3.5 w-3.5" />
            <span>
              {timetableTitle(t)}
              {t.time && <span className="ms-1 font-normal text-muted">· {t.time}</span>}
            </span>
            <TimetableStatusBadge timetable={t} />
          </label>
        );
      })}
    </div>
  );

  const timetableSection = (t: ReportTimetable) => (
    <section
      key={t.key}
      className={`rounded-2xl border p-3 ${
        t.status === "current" ? "border-line bg-canvas/40" : "border-dashed border-line bg-canvas/20"
      }`}
    >
      <h4 className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-ink">
        <span className="flex flex-wrap items-center gap-1.5">
          📘 {timetableTitle(t)} <TimetableStatusBadge timetable={t} />
        </span>
        <span className="flex items-center gap-1.5">
          <Badge tone="success">{t.presences} prés.</Badge>
          <Badge tone="danger">{t.absences} abs.</Badge>
          <span className="font-mono text-danger">-{t.totalCost} DA</span>
        </span>
      </h4>

      <TimetableDetails timetable={t} fmtLineDay={fmtLineDay} />

      {t.lines.length === 0 ? (
        <p className="text-xs italic text-muted">Aucune présence ni absence sur cette période.</p>
      ) : (
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {t.lines.map((l) => (
            <div
              key={l.id}
              className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                l.kind === "presence" ? "border-line bg-surface" : "border-danger/30 bg-danger/5"
              }`}
            >
              <div className="min-w-0">
                <strong className="block text-ink">
                  {l.kind === "penalty" ? `Semaine du ${fmtDay(l.weekStart)} au ${fmtDay(l.weekEnd)}` : fmtDT(l.date)}
                </strong>
                <span className="text-[10px] text-muted">
                  {l.group ?? "-"}
                  {l.time ? ` · ${l.time}` : ""}
                  {l.substitute ? " · Autre groupe" : ""}
                </span>
                {l.deletedSlot && (
                  <span
                    title="Séance débitée dont l'emploi du temps a été supprimé depuis : sa présence a disparu avec lui, le paiement est resté."
                    className="ms-1.5 rounded bg-warning/15 px-1.5 py-0.5 text-[9px] font-bold text-warning"
                  >
                    Emploi du temps supprimé
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {!!l.unpaid && (
                  <Badge tone="danger" className="text-[9px]">
                    Impayé {l.unpaid} DA
                  </Badge>
                )}
                <Badge
                  tone={
                    l.kind === "penalty" || l.status === "absent" ? "danger" : l.status === "late" ? "warning" : "success"
                  }
                >
                  {l.kind === "penalty"
                    ? "Absence facturée"
                    : l.status === "absent"
                      ? "Absent"
                      : l.status === "late"
                        ? "En retard"
                        : "Présent"}
                </Badge>
                <span
                  className={`w-20 text-end font-mono text-[11px] font-bold ${l.cost > 0 ? "text-danger" : "text-success"}`}
                >
                  {l.cost > 0 ? `-${l.cost} DA` : l.free ? "Offerte" : "0 DA"}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const resultCurrent = result?.report.timetables.filter((t) => t.status === "current") ?? [];
  const resultPast = result?.report.timetables.filter((t) => t.status !== "current") ?? [];

  return (
    <div className="space-y-4">
      {/* ---- 1. Période ---------------------------------------------------- */}
      <section className="space-y-3 rounded-2xl border border-line bg-canvas/40 p-4">
        <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
          <CalendarRange className="h-4 w-4 text-primary" /> 1. Période
        </h4>
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ["month", "Par mois"],
              ["range", "Période personnalisée"],
              ["all", "Tout le temps"],
            ] as const
          ).map(([m, label]) => (
            <Button key={m} size="sm" variant={mode === m ? "primary" : "outline"} onClick={() => setMode(m)}>
              {label}
            </Button>
          ))}
        </div>

        {mode === "month" && (
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6 lg:grid-cols-12">
              {MONTHS_FR.map((name, i) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setMonth(i + 1)}
                  className={`rounded-lg border px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                    month === i + 1
                      ? "border-primary bg-primary text-white"
                      : "border-line bg-surface text-ink hover:border-primary/50"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] font-bold uppercase text-muted">Année :</label>
              <Select value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28">
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        )}

        {mode === "range" && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-[10px] font-bold uppercase text-muted">Du</label>
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="w-40" />
            <label className="text-[10px] font-bold uppercase text-muted">au</label>
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="w-40" />
            {rangeInvalid && <span className="text-[10px] font-bold text-danger">La date de début dépasse la fin.</span>}
          </div>
        )}
      </section>

      {/* ---- 2. Emplois du temps ------------------------------------------- */}
      <section className="space-y-3 rounded-2xl border border-line bg-canvas/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
            <BookOpen className="h-4 w-4 text-primary" /> 2. Emplois du temps ({selected.length}/{timetables.length})
          </h4>
          {timetables.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setUnselected(allSelected ? timetables.map((t) => t.key) : [])}
            >
              {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
            </Button>
          )}
        </div>
        {timetables.length === 0 ? (
          <p className="text-xs italic text-muted">
            L&apos;élève n&apos;est inscrit à aucun emploi du temps et n&apos;en a suivi aucun.
          </p>
        ) : (
          <div className="space-y-3">
            {currentTimetables.length > 0 && (
              <div className="space-y-1.5">
                <span className="block text-[10px] font-bold uppercase text-muted">Inscrit actuellement</span>
                {picker(currentTimetables)}
              </div>
            )}
            {pastTimetables.length > 0 && (
              <div className="space-y-1.5">
                <span className="block text-[10px] font-bold uppercase text-muted">
                  Quittés — leur historique est conservé
                </span>
                {picker(pastTimetables)}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={generate} disabled={selected.length === 0 || rangeInvalid}>
          <FileBarChart className="me-1 h-4 w-4" /> Générer le rapport
        </Button>
        {result && (
          <Button variant="outline" onClick={print}>
            <Printer className="me-1 h-4 w-4" /> Imprimer
          </Button>
        )}
      </div>

      {/* ---- 3. Résultat --------------------------------------------------- */}
      {result && (
        <div className="space-y-4 border-t border-line pt-4">
          <p className="text-center text-xs text-muted">
            Rapport — <strong className="text-ink">{periodLabel(result.period, "fr")}</strong>
          </p>

          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <KpiCard
              icon={<TrendingUp className="h-4 w-4" />}
              label="Total versé"
              value={`${result.report.totalPayments} DA`}
              tone="success"
            />
            <KpiCard
              icon={<TrendingDown className="h-4 w-4" />}
              label="Total consommé"
              value={`${result.report.totalCost} DA`}
              tone="danger"
            />
            <KpiCard
              icon={<Wallet className="h-4 w-4" />}
              label="Solde de la période"
              value={`${result.report.totalPayments - result.report.totalCost} DA`}
              tone="primary"
            />
            <KpiCard
              icon={<Wallet className="h-4 w-4" />}
              label="Dette actuelle"
              value={`${debtTotal} DA`}
              tone={debtTotal > 0 ? "danger" : "neutral"}
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {result.report.timetables.map((t) => (
              <div
                key={t.key}
                className={`rounded-xl border border-line border-s-4 bg-surface p-3 ${
                  t.status === "current" ? "border-s-primary" : "border-s-muted"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-xs text-ink">{timetableTitle(t)}</strong>
                  <span className="font-mono text-xs font-black text-danger">{t.totalCost} DA</span>
                </div>
                <span className="flex flex-wrap items-center gap-1 text-[10px] text-muted">
                  <TimetableStatusBadge timetable={t} />
                  {t.presences} présence(s) · {t.late} retard(s) · {t.absences} absence(s)
                </span>
                {t.unpaid > 0 && (
                  <span className="mt-0.5 block text-[10px] font-bold text-danger">Reste dû : {t.unpaid} DA</span>
                )}
              </div>
            ))}
          </div>

          {/* Paiements */}
          <section className="rounded-2xl border border-success/30 bg-success/5 p-3">
            <h4 className="mb-2 flex items-center justify-between text-xs font-bold text-ink">
              <span>💰 Paiements &amp; recharges du solde ({result.report.payments.length})</span>
              <span className="font-mono text-success">+{result.report.totalPayments} DA</span>
            </h4>
            {result.report.payments.length === 0 ? (
              <p className="text-xs italic text-muted">Aucun paiement sur cette période.</p>
            ) : (
              <div className="max-h-64 space-y-1.5 overflow-y-auto">
                {result.report.payments.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <strong className="block truncate text-ink">{p.description}</strong>
                      <span className="text-[10px] text-muted">{fmtDT(p.date)}</span>
                    </div>
                    <strong className="shrink-0 font-mono text-success">+{p.amount} DA</strong>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Une section par emploi du temps : ceux d'aujourd'hui, puis l'historique */}
          {resultCurrent.length > 0 && (
            <h4 className="text-xs font-bold uppercase tracking-wide text-primary">📗 Emplois du temps actuels</h4>
          )}
          {resultCurrent.map(timetableSection)}
          {resultPast.length > 0 && (
            <h4 className="text-xs font-bold uppercase tracking-wide text-muted">
              🗂️ Emplois du temps quittés — historique conservé
            </h4>
          )}
          {resultPast.map(timetableSection)}

          {result.report.otherUnpaid > 0 && (
            <p className="rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
              Autres débits non réglés, rattachés à aucun emploi du temps (frais d&apos;inscription pris sur le
              solde, débit manuel) : <strong>{result.report.otherUnpaid} DA</strong>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Classe, groupe, enseignant, salle, horaire, tarif et dates d'un créneau. */
function TimetableDetails({
  timetable: t,
  fmtLineDay,
}: {
  timetable: ReportTimetable;
  fmtLineDay: (iso?: string) => string;
}) {
  const items: Array<[string, string]> = [];
  if (t.className) items.push(["Classe", t.className]);
  if (t.group) items.push(["Groupe", t.group]);
  if (t.teacher) items.push(["Enseignant", t.teacher]);
  if (t.salle) items.push(["Salle", t.salle]);
  if (t.days || t.time) items.push(["Horaire", [t.days, t.time].filter(Boolean).join(" · ")]);
  if (t.levelPrice || t.periodMonths) {
    items.push(["Tarif", `Formation : ${t.levelPrice ?? 0} DA / ${t.periodMonths ?? 0} mois`]);
  } else if (t.price !== undefined) {
    const discounted = t.netPrice !== undefined && t.netPrice !== t.price;
    items.push([
      "Tarif",
      `${t.netPrice ?? t.price} DA / séance${discounted ? ` (au lieu de ${t.price} DA, ${t.discount ?? ""})` : ""}`,
    ]);
  }
  if (t.subscribedAt) items.push(["Inscrit le", fmtLineDay(t.subscribedAt)]);
  if (t.startDate) items.push(["Début de facturation", fmtLineDay(t.startDate)]);
  if (t.expiryDate) items.push(["Fin", fmtLineDay(t.expiryDate)]);
  items.push([
    "Activité",
    t.firstDate ? `du ${fmtLineDay(t.firstDate)} au ${fmtLineDay(t.lastDate)}` : "Aucune séance enregistrée",
  ]);
  if (t.unpaid > 0) items.push(["Reste dû aujourd'hui", `${t.unpaid} DA`]);

  return (
    <dl className="mb-2 grid grid-cols-1 gap-x-4 gap-y-1 rounded-xl border border-line bg-surface p-2.5 text-[11px] sm:grid-cols-2 lg:grid-cols-3">
      {items.map(([k, v]) => (
        <div key={k} className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 font-semibold text-muted">{k} :</dt>
          <dd className={`truncate ${k.startsWith("Reste dû") ? "font-bold text-danger" : "text-ink"}`}>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function KpiCard({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "success" | "danger" | "primary" | "neutral";
}) {
  const color = {
    success: "text-success border-success/30 bg-success/5",
    danger: "text-danger border-danger/30 bg-danger/5",
    primary: "text-primary border-primary/30 bg-primary/5",
    neutral: "text-ink border-line bg-surface",
  }[tone];
  return (
    <div className={`rounded-xl border p-3 ${color}`}>
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-muted">
        {icon} {label}
      </span>
      <strong className="mt-1 block font-mono text-base font-black">{value}</strong>
    </div>
  );
}
