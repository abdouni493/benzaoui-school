"use client";

import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { BookOpen, CalendarRange, FileBarChart, Printer, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { printHtmlDocument } from "@/lib/print";
import {
  buildStudentActivityReport,
  computeStudentReport,
  MONTHS_FR,
  periodLabel,
  type ReportPeriod,
  type StudentReport,
} from "@/lib/reports/studentActivity";
import type { Student } from "@/lib/types";

/**
 * Onglet « Rapport » de la fiche étudiant : on choisit une période et des
 * matières, on génère, on lit — puis on imprime le même contenu sur papier
 * à en-tête de l'école.
 */
export function StudentReportPanel({
  student,
  moduleOptions,
  debtTotal,
}: {
  student: Student;
  /** matières auxquelles l'élève est inscrit aujourd'hui */
  moduleOptions: { id: string; name: string }[];
  debtTotal: number;
}) {
  const { balanceTx, attendance, absencePenalties, sessions, modules, groups, parents, school } = useData(
    useShallow((s) => ({
      balanceTx: s.balanceTx,
      attendance: s.attendance,
      absencePenalties: s.absencePenalties,
      sessions: s.sessions,
      modules: s.modules,
      groups: s.groups,
      parents: s.parents,
      school: s.school,
    })),
  );
  const language = useSettings((s) => s.language);

  const now = new Date();
  const [mode, setMode] = useState<ReportPeriod["mode"]>("month");
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [selected, setSelected] = useState<string[]>(() => moduleOptions.map((m) => m.id));
  const [result, setResult] = useState<{ period: ReportPeriod; report: StudentReport } | null>(null);

  const years = Array.from({ length: 6 }, (_, i) => now.getFullYear() - 4 + i);
  const allSelected = moduleOptions.length > 0 && selected.length === moduleOptions.length;
  const rangeInvalid = mode === "range" && !!start && !!end && start > end;

  const toggle = (id: string) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const generate = () => {
    const period: ReportPeriod =
      mode === "month" ? { mode, year, month } : mode === "range" ? { mode, start, end } : { mode: "all" };
    // L'ordre des matières suit celui de la fiche, pas celui des clics.
    const moduleIds = moduleOptions.map((m) => m.id).filter((id) => selected.includes(id));
    setResult({
      period,
      report: computeStudentReport({
        studentId: student.id,
        period,
        moduleIds,
        balanceTx,
        attendance,
        absencePenalties,
        sessions,
        modules,
        groups,
      }),
    });
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

  const fmtDT = (iso: string) => iso.substring(0, 16).replace("T", " ");
  const fmtDay = (d?: string) => (d ? d.split("-").reverse().join("/") : "-");

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

      {/* ---- 2. Matières --------------------------------------------------- */}
      <section className="space-y-3 rounded-2xl border border-line bg-canvas/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-muted">
            <BookOpen className="h-4 w-4 text-primary" /> 2. Matières ({selected.length}/{moduleOptions.length})
          </h4>
          {moduleOptions.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setSelected(allSelected ? [] : moduleOptions.map((m) => m.id))}
            >
              {allSelected ? "Tout désélectionner" : "Tout sélectionner"}
            </Button>
          )}
        </div>
        {moduleOptions.length === 0 ? (
          <p className="text-xs italic text-muted">L&apos;élève n&apos;est inscrit à aucune matière.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {moduleOptions.map((m) => {
              const on = selected.includes(m.id);
              return (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    on ? "border-primary bg-primary/10 text-primary" : "border-line bg-surface text-muted"
                  }`}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(m.id)} className="h-3.5 w-3.5" />
                  {m.name}
                </label>
              );
            })}
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
            {result.report.modules.map((m) => (
              <div key={m.moduleId} className="rounded-xl border border-line border-s-4 border-s-primary bg-surface p-3">
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-xs text-ink">{m.name}</strong>
                  <span className="font-mono text-xs font-black text-danger">{m.totalCost} DA</span>
                </div>
                <span className="text-[10px] text-muted">
                  {m.presences} présence(s) · {m.late} retard(s) · {m.absences} absence(s)
                </span>
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

          {/* Une section par matière */}
          {result.report.modules.map((m) => (
            <section key={m.moduleId} className="rounded-2xl border border-line bg-canvas/40 p-3">
              <h4 className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs font-bold text-ink">
                <span>📘 {m.name}</span>
                <span className="flex items-center gap-1.5">
                  <Badge tone="success">{m.presences} prés.</Badge>
                  <Badge tone="danger">{m.absences} abs.</Badge>
                  <span className="font-mono text-danger">-{m.totalCost} DA</span>
                </span>
              </h4>
              {m.lines.length === 0 ? (
                <p className="text-xs italic text-muted">Aucune présence ni absence sur cette période.</p>
              ) : (
                <div className="max-h-64 space-y-1.5 overflow-y-auto">
                  {m.lines.map((l) => (
                    <div
                      key={l.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                        l.kind === "presence" ? "border-line bg-surface" : "border-danger/30 bg-danger/5"
                      }`}
                    >
                      <div className="min-w-0">
                        <strong className="block text-ink">
                          {l.kind === "penalty"
                            ? `Semaine du ${fmtDay(l.weekStart)} au ${fmtDay(l.weekEnd)}`
                            : fmtDT(l.date)}
                        </strong>
                        <span className="text-[10px] text-muted">
                          {l.group ?? "-"}
                          {l.time ? ` · ${l.time}` : ""}
                          {l.substitute ? " · Autre groupe" : ""}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge
                          tone={
                            l.kind === "penalty" || l.status === "absent"
                              ? "danger"
                              : l.status === "late"
                                ? "warning"
                                : "success"
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
          ))}
        </div>
      )}
    </div>
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
