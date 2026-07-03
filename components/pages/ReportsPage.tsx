"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useData } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { formatDA } from "@/lib/utils";
import {
  Calendar,
  FileText,
  ArrowUpRight,
  ArrowDownLeft,
  DollarSign,
  Wallet,
  FileSpreadsheet,
  AlertCircle,
  Users,
  Search,
  BookOpen,
  Receipt,
  X,
  Layers,
  GraduationCap,
  Ticket,
  Puzzle,
  Banknote,
  PiggyBank,
  ChevronRight,
  CircleDollarSign,
  UserCog,
  ClipboardList,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Types & small helpers                                               */
/* ------------------------------------------------------------------ */

type Tone = "success" | "danger" | "warning" | "primary" | "neutral" | "sky" | "violet";

const TONE_TEXT: Record<Tone, string> = {
  success: "text-success",
  danger: "text-danger",
  warning: "text-warning",
  primary: "text-primary",
  neutral: "text-ink",
  sky: "text-sky-500",
  violet: "text-violet-500",
};

const TONE_SOFT: Record<Tone, string> = {
  success: "bg-success/10 text-success",
  danger: "bg-danger/10 text-danger",
  warning: "bg-warning/10 text-warning",
  primary: "bg-primary/10 text-primary",
  neutral: "bg-ink/10 text-ink",
  sky: "bg-sky-500/10 text-sky-500",
  violet: "bg-violet-500/10 text-violet-500",
};

/** Badge only supports a narrower tone set — collapse the extras. */
type BadgeTone = "success" | "warning" | "danger" | "primary" | "neutral";
const badgeTone = (t: Tone): BadgeTone => (t === "sky" ? "primary" : t === "violet" ? "primary" : t);

/* eslint-disable @typescript-eslint/no-explicit-any */
interface DetailColumn {
  label: string;
  align?: "right";
  render: (row: any) => ReactNode;
}
interface DetailSpec {
  columns: DetailColumn[];
  rows: any[];
  totalLabel?: string;
  totalValue?: string;
  totalTone?: Tone;
  searchable?: (row: any) => string;
  empty?: string;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

interface MetricSpec {
  label: string;
  value: string;
  tone: Tone;
  icon: ReactNode;
  hint?: string;
  detail?: DetailSpec;
  featured?: boolean;
}

interface CalcLine {
  label: string;
  value: string;
  tone?: Tone;
  strong?: boolean;
  emphasis?: boolean;
  formula?: string;
}
interface CalcPanel {
  title: string;
  subtitle?: string;
  icon: ReactNode;
  lines: CalcLine[];
  note?: string;
}

interface Section {
  id: string;
  label: string;
  icon: ReactNode;
  cards: MetricSpec[];
  panels: CalcPanel[];
}

/* ------------------------------------------------------------------ */
/* Generic detail table                                                */
/* ------------------------------------------------------------------ */

function DetailTable({ spec, search }: { spec: DetailSpec; search: string }) {
  const rows = search.trim()
    ? spec.rows.filter((r) => (spec.searchable?.(r) ?? "").toLowerCase().includes(search.toLowerCase()))
    : spec.rows;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs">
        <span className="font-semibold text-muted">{rows.length} élément(s)</span>
        {spec.totalValue && (
          <span className={`text-sm font-extrabold ${TONE_TEXT[spec.totalTone ?? "primary"]}`}>
            {spec.totalLabel ?? "Total"} : {spec.totalValue}
          </span>
        )}
      </div>
      <div className="max-h-[26rem] overflow-auto rounded-2xl border border-line">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-line bg-canvas text-muted">
              {spec.columns.map((c, i) => (
                <th key={i} className={`p-3 font-bold ${c.align === "right" ? "text-right" : ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={spec.columns.length} className="p-6 text-center italic text-muted">
                  {spec.empty ?? "Aucune donnée pour cette période."}
                </td>
              </tr>
            ) : (
              rows.map((row, ri) => (
                <tr key={ri} className="transition-colors hover:bg-primary-50/10">
                  {spec.columns.map((c, ci) => (
                    <td key={ci} className={`p-3 align-middle ${c.align === "right" ? "text-right" : ""}`}>
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Metric card                                                         */
/* ------------------------------------------------------------------ */

function MetricCard({ spec, onOpen }: { spec: MetricSpec; onOpen: (s: MetricSpec) => void }) {
  const clickable = !!spec.detail;

  if (spec.featured) {
    return (
      <div className="flex items-center justify-between rounded-2xl border border-line bg-gradient-to-br from-primary-600 to-primary-750 p-5 text-white card-shadow">
        <div className="space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-white/80">{spec.label}</span>
          <strong className="block text-2xl font-black">{spec.value}</strong>
          {spec.hint && <span className="block text-[9px] italic text-white/70">{spec.hint}</span>}
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-white/10 text-white">{spec.icon}</div>
      </div>
    );
  }

  return (
    <button
      type="button"
      disabled={!clickable}
      onClick={() => clickable && onOpen(spec)}
      className={`group relative block rounded-2xl border border-line bg-surface p-5 text-start card-shadow transition-all ${
        clickable ? "hover:-translate-y-0.5 hover:border-primary hover:shadow-lg" : "cursor-default opacity-95"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">{spec.label}</span>
          <strong className={`block text-2xl font-black ${TONE_TEXT[spec.tone]}`}>{spec.value}</strong>
          {clickable ? (
            <span className="flex items-center gap-0.5 text-[9px] italic text-muted group-hover:text-primary group-hover:underline">
              {spec.hint ?? "Cliquer pour voir le détail"} <ChevronRight className="h-3 w-3" />
            </span>
          ) : (
            spec.hint && <span className="block text-[9px] italic text-muted">{spec.hint}</span>
          )}
        </div>
        <div
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-110 ${TONE_SOFT[spec.tone]}`}
        >
          {spec.icon}
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Small-calculations panel                                            */
/* ------------------------------------------------------------------ */

function CalcCard({ panel }: { panel: CalcPanel }) {
  return (
    <Card className="border border-line card-shadow">
      <CardBody className="space-y-4 p-5">
        <div>
          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink">
            {panel.icon} {panel.title}
          </h4>
          {panel.subtitle && <p className="text-[11px] text-muted">{panel.subtitle}</p>}
        </div>
        <div className="space-y-1.5 text-xs">
          {panel.lines.map((l, i) => (
            <div
              key={i}
              className={`flex items-center justify-between rounded-xl px-2 py-2 ${
                l.emphasis
                  ? `border border-line/60 ${l.tone ? TONE_SOFT[l.tone].split(" ")[0] + "/40" : "bg-canvas/40"}`
                  : "border-b border-line/40"
              }`}
            >
              <span className={`flex items-center gap-1.5 ${l.strong || l.emphasis ? "font-bold text-ink" : "text-muted"}`}>
                {l.tone && !l.emphasis && <span className={`h-2 w-2 rounded-full ${TONE_SOFT[l.tone].split(" ")[0]}`} />}
                <span>
                  {l.label}
                  {l.formula && <span className="ml-1 block text-[9px] font-normal not-italic text-muted">{l.formula}</span>}
                </span>
              </span>
              <strong className={l.tone ? TONE_TEXT[l.tone] : "text-ink"}>{l.value}</strong>
            </div>
          ))}
        </div>
        {panel.note && <p className="text-[10px] leading-relaxed text-muted">{panel.note}</p>}
      </CardBody>
    </Card>
  );
}

/* ================================================================== */
/* Page                                                                */
/* ================================================================== */

export function ReportsPage() {
  const {
    cash,
    students,
    unpaidTeacher,
    expenses,
    teachers,
    modules,
    sessions,
    classes,
    reception,
    acomptes,
    absences,
    balanceTx,
    attendance,
    independent,
    coursework,
    subscriptions,
    categories,
    parents,
  } = useData();

  const [startDate, setStartDate] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0],
  );
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);

  const [isGenerated, setIsGenerated] = useState(false);
  const [reportRange, setReportRange] = useState<{ start: string; end: string } | null>(null);

  const [activeSection, setActiveSection] = useState("overview");

  const [detail, setDetail] = useState<{ title: string; spec: DetailSpec } | null>(null);
  const [modalSearch, setModalSearch] = useState("");

  const handleGenerate = () => {
    if (!startDate || !endDate) {
      alert("Veuillez sélectionner les dates de début et de fin.");
      return;
    }
    if (startDate > endDate) {
      alert("La date de début doit précéder la date de fin.");
      return;
    }
    setReportRange({ start: startDate, end: endDate });
    setActiveSection("overview");
    setIsGenerated(true);
  };

  const openDetail = (s: MetricSpec) => {
    if (!s.detail) return;
    setModalSearch("");
    setDetail({ title: s.label, spec: s.detail });
  };

  /* ---------------------------------------------------------------- */
  /* All calculations — only meaningful once generated                */
  /* ---------------------------------------------------------------- */

  const report = useMemo<{ sections: Section[] } | null>(() => {
    if (!isGenerated || !reportRange) return null;

    const inRange = (dateStr: string) => {
      const d = (dateStr || "").substring(0, 10);
      return d >= reportRange.start && d <= reportRange.end;
    };
    const sum = <T,>(arr: T[], pick: (x: T) => number) => arr.reduce((s, x) => s + pick(x), 0);

    const teacherIds = new Set(teachers.map((t) => t.id));
    const receptionIds = new Set(reception.map((r) => r.id));

    // Resolvers
    const sName = (id?: string) => {
      const s = students.find((x) => x.id === id);
      return s ? `${s.firstName} ${s.lastName}` : "—";
    };
    const tName = (id?: string) => {
      const t = teachers.find((x) => x.id === id);
      if (t) return `${t.firstName} ${t.lastName}`;
      const r = reception.find((x) => x.id === id);
      return r ? `${r.firstName} ${r.lastName}` : "—";
    };
    const modName = (sessionId?: string) => {
      const se = sessions.find((s) => s.id === sessionId);
      return se ? modules.find((m) => m.id === se.moduleId)?.name ?? "Séance" : "Séance";
    };
    const clsName = (sessionId?: string) => {
      const se = sessions.find((s) => s.id === sessionId);
      return se ? classes.find((c) => c.id === se.classId)?.name ?? "" : "";
    };

    // Formatting
    const inflow = (n: number) => `+${formatDA(Math.abs(n))}`;
    const outflow = (n: number) => `-${formatDA(Math.abs(n))}`;
    const signed = (n: number) => (n >= 0 ? `+${formatDA(Math.abs(n))}` : `-${formatDA(Math.abs(n))}`);

    // Range-filtered raw sets
    const fCash = cash.filter((t) => inRange(t.date));
    const fBal = balanceTx.filter((t) => inRange(t.date));
    const fAtt = attendance.filter((a) => inRange(a.timestamp));
    const fExp = expenses.filter((e) => inRange(e.date));
    const fAco = acomptes.filter((a) => inRange(a.date));
    const fAbs = absences.filter((a) => inRange(a.date));
    const fInd = independent.filter((i) => inRange(i.date));
    const fUnpaidRange = unpaidTeacher.filter((u) => inRange(u.date));

    // Reusable cell renderers
    const dateCell = (d: string) => <span className="font-mono text-[10px] text-muted">{(d || "").substring(0, 10)}</span>;
    const dateTimeCell = (d: string) => {
      const dt = new Date(d);
      return (
        <span className="font-mono text-[10px] text-muted">
          {dt.toLocaleDateString("fr-DZ")} {dt.toLocaleTimeString("fr-DZ", { hour: "2-digit", minute: "2-digit" })}
        </span>
      );
    };

    /* ============================= STUDENTS ============================ */
    const versements = sum(
      fBal.filter((t) => t.type === "topup"),
      (t) => t.amount,
    );
    const registrationSettled = Math.abs(
      sum(
        fBal.filter((t) => t.type === "registration"),
        (t) => t.amount,
      ),
    );
    const debtPayments = sum(
      fBal.filter((t) => t.type === "debt_payment"),
      (t) => t.amount,
    );
    const balanceDeductions = Math.abs(
      sum(
        fBal.filter((t) => t.type === "deduction"),
        (t) => t.amount,
      ),
    );
    const currentCredit = sum(
      students.filter((s) => s.balance > 0),
      (s) => s.balance,
    );
    const totalDebts = sum(students, (s) => (s.balance < 0 ? Math.abs(s.balance) : 0) + (s.registrationDue || 0));
    const debtors = students.filter((s) => s.balance < 0 || (s.registrationDue && s.registrationDue > 0));
    const freeCount = students.filter((s) => s.isFree).length;

    const amountCell = (tone: Tone, prefix: "" | "+" | "-" = "") => (row: { amount: number }) => (
      <strong className={`font-extrabold ${TONE_TEXT[tone]}`}>
        {prefix === "+" ? inflow(row.amount) : prefix === "-" ? outflow(row.amount) : formatDA(row.amount)}
      </strong>
    );

    const studentsSection: Section = {
      id: "students",
      label: "Élèves",
      icon: <Users className="h-4 w-4" />,
      cards: [
        {
          label: "Versements élèves (période)",
          value: inflow(versements),
          tone: "success",
          icon: <ArrowUpRight className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Élève", render: (r) => <span className="font-bold text-ink">{sName(r.studentId)}</span> },
              { label: "Désignation", render: (r) => <span className="text-muted">{r.description}</span> },
              { label: "Montant", align: "right", render: amountCell("success", "+") },
            ],
            rows: fBal.filter((t) => t.type === "topup"),
            totalLabel: "Total versé",
            totalValue: inflow(versements),
            totalTone: "success",
            searchable: (r) => `${sName(r.studentId)} ${r.description} ${r.amount}`,
          },
        },
        {
          label: "Séances débitées du solde",
          value: outflow(balanceDeductions),
          tone: "primary",
          icon: <CircleDollarSign className="h-5 w-5" />,
          hint: "Recette réalisée sur soldes",
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Élève", render: (r) => <span className="font-bold text-ink">{sName(r.studentId)}</span> },
              { label: "Séance", render: (r) => <span className="text-primary">{r.description}</span> },
              { label: "Montant", align: "right", render: amountCell("primary", "-") },
            ],
            rows: fBal.filter((t) => t.type === "deduction"),
            totalLabel: "Total débité",
            totalValue: outflow(balanceDeductions),
            totalTone: "primary",
            searchable: (r) => `${sName(r.studentId)} ${r.description}`,
          },
        },
        {
          label: "Frais d'inscription réglés",
          value: inflow(registrationSettled),
          tone: "sky",
          icon: <ClipboardList className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Élève", render: (r) => <span className="font-bold text-ink">{sName(r.studentId)}</span> },
              { label: "Montant", align: "right", render: (r) => <strong className="text-sky-500">{formatDA(Math.abs(r.amount))}</strong> },
            ],
            rows: fBal.filter((t) => t.type === "registration"),
            totalLabel: "Total inscriptions",
            totalValue: formatDA(registrationSettled),
            totalTone: "sky",
            searchable: (r) => sName(r.studentId),
          },
        },
        {
          label: "Règlements de dette",
          value: inflow(debtPayments),
          tone: "success",
          icon: <Banknote className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Élève", render: (r) => <span className="font-bold text-ink">{sName(r.studentId)}</span> },
              { label: "Montant", align: "right", render: amountCell("success", "+") },
            ],
            rows: fBal.filter((t) => t.type === "debt_payment"),
            totalLabel: "Total réglé",
            totalValue: inflow(debtPayments),
            totalTone: "success",
            searchable: (r) => sName(r.studentId),
          },
        },
        {
          label: "Soldes créditeurs (actuel)",
          value: formatDA(currentCredit),
          tone: "neutral",
          icon: <Wallet className="h-5 w-5" />,
          hint: "Trésorerie détenue pour les élèves",
          detail: {
            columns: [
              { label: "Élève", render: (r) => <span className="font-bold text-ink">{r.firstName} {r.lastName}</span> },
              { label: "Téléphone", render: (r) => <span className="font-mono text-muted">{r.phone}</span> },
              { label: "Abon.", align: "right", render: (r) => <span className="text-muted">{r.subscriptionIds.length}</span> },
              {
                label: "Solde",
                align: "right",
                render: (r) => (
                  <strong className={r.balance < 0 ? "text-danger" : r.balance === 0 ? "text-muted" : "text-success"}>
                    {formatDA(r.balance)}
                  </strong>
                ),
              },
              {
                label: "Statut",
                align: "right",
                render: (r) =>
                  r.isFree ? <Badge tone="primary">Gratuit</Badge> : r.balance < 0 ? <Badge tone="danger">Dette</Badge> : <Badge tone="success">OK</Badge>,
              },
            ],
            rows: [...students].sort((a, b) => b.balance - a.balance),
            totalLabel: "Crédits cumulés",
            totalValue: formatDA(currentCredit),
            totalTone: "neutral",
            searchable: (r) => `${r.firstName} ${r.lastName} ${r.phone}`,
          },
        },
        {
          label: "Dettes élèves actives (global)",
          value: formatDA(totalDebts),
          tone: "warning",
          icon: <AlertCircle className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Élève", render: (r) => <span className="font-bold text-ink">{r.firstName} {r.lastName}</span> },
              { label: "Téléphone", render: (r) => <span className="font-mono text-muted">{r.phone}</span> },
              { label: "Inscr.", align: "right", render: (r) => <span className="text-danger">{formatDA(r.registrationDue || 0)}</span> },
              { label: "Solde", align: "right", render: (r) => <span className="text-danger">{formatDA(r.balance < 0 ? Math.abs(r.balance) : 0)}</span> },
              {
                label: "Dette totale",
                align: "right",
                render: (r) => <strong className="text-danger">{formatDA((r.balance < 0 ? Math.abs(r.balance) : 0) + (r.registrationDue || 0))}</strong>,
              },
            ],
            rows: debtors,
            totalLabel: "Dette globale",
            totalValue: formatDA(totalDebts),
            totalTone: "warning",
            empty: "Aucune dette active.",
            searchable: (r) => `${r.firstName} ${r.lastName} ${r.phone}`,
          },
        },
      ],
      panels: [
        {
          title: "Synthèse des flux élèves",
          subtitle: `Période du ${reportRange.start} au ${reportRange.end}`,
          icon: <Users className="h-4 w-4 text-primary" />,
          lines: [
            { label: "Versements (rechargements)", value: inflow(versements), tone: "success" },
            { label: "Frais d'inscription réglés", value: inflow(registrationSettled), tone: "sky" },
            { label: "Règlements de dettes", value: inflow(debtPayments), tone: "success" },
            {
              label: "Total encaissé auprès des élèves",
              value: inflow(versements + registrationSettled + debtPayments),
              tone: "success",
              emphasis: true,
            },
            { label: "Séances débitées des soldes", value: outflow(balanceDeductions), tone: "primary" },
          ],
        },
        {
          title: "État des comptes élèves",
          icon: <Wallet className="h-4 w-4 text-warning" />,
          lines: [
            { label: "Élèves inscrits", value: `${students.length}`, strong: true },
            { label: "Dont cas gratuits", value: `${freeCount}`, tone: "primary" },
            { label: "Élèves en dette", value: `${debtors.length}`, tone: "warning" },
            { label: "Soldes créditeurs cumulés", value: formatDA(currentCredit), strong: true },
            { label: "Dettes actives cumulées", value: formatDA(totalDebts), tone: "warning", emphasis: true },
          ],
          note: "Les soldes créditeurs représentent de l'argent déjà encaissé mais non encore consommé en séances.",
        },
      ],
    };

    /* ========================= ATTENDANCE / SÉANCES ==================== */
    const seanceRevenue = sum(fAtt, (a) => a.amountDeducted);
    const presentCount = fAtt.filter((a) => a.status === "present").length;
    const lateCount = fAtt.filter((a) => a.status === "late").length;
    const unpaidGlobal = unpaidTeacher.filter((u) => !u.paid);
    const unpaidGlobalTotal = sum(unpaidGlobal, (u) => u.amount);
    const unpaidRangeTotal = sum(
      fUnpaidRange.filter((u) => !u.paid),
      (u) => u.amount,
    );

    const attendanceRows = [...fAtt].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    const attendanceSection: Section = {
      id: "attendance",
      label: "Séances & Présences",
      icon: <ClipboardList className="h-4 w-4" />,
      cards: [
        {
          label: "Recette des séances (présences)",
          value: inflow(seanceRevenue),
          tone: "success",
          icon: <CircleDollarSign className="h-5 w-5" />,
          hint: "Montants débités via scans RFID",
          detail: {
            columns: [
              { label: "Date & heure", render: (r) => dateTimeCell(r.timestamp) },
              { label: "Élève", render: (r) => <span className="font-bold text-ink">{sName(r.studentId)}</span> },
              {
                label: "Séance",
                render: (r) => (
                  <span>
                    <span className="font-semibold text-primary">{modName(r.sessionId)}</span>
                    <span className="text-muted"> {clsName(r.sessionId) && `(${clsName(r.sessionId)})`}</span>
                  </span>
                ),
              },
              { label: "Statut", render: (r) => <Badge tone={r.status === "late" ? "warning" : "success"}>{r.status === "late" ? "Retard" : "Présent"}</Badge> },
              { label: "Débité", align: "right", render: (r) => <strong className="text-success">{formatDA(r.amountDeducted)}</strong> },
            ],
            rows: attendanceRows,
            totalLabel: "Recette séances",
            totalValue: inflow(seanceRevenue),
            totalTone: "success",
            searchable: (r) => `${sName(r.studentId)} ${modName(r.sessionId)} ${clsName(r.sessionId)}`,
          },
        },
        {
          label: "Séances profs NON payées (global)",
          value: formatDA(unpaidGlobalTotal),
          tone: "warning",
          icon: <AlertCircle className="h-5 w-5" />,
          hint: "Dû aux enseignants au %",
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Enseignant", render: (r) => <span className="font-bold text-ink">{tName(r.teacherId)}</span> },
              { label: "Élève", render: (r) => <span className="text-muted">{sName(r.studentId)}</span> },
              { label: "Module", render: (r) => <span className="font-semibold text-primary">{modName(r.sessionId)}</span> },
              { label: "Montant", align: "right", render: (r) => <strong className="text-warning">{formatDA(r.amount)}</strong> },
            ],
            rows: unpaidGlobal,
            totalLabel: "Dû aux profs",
            totalValue: formatDA(unpaidGlobalTotal),
            totalTone: "warning",
            empty: "Toutes les séances enseignants sont réglées.",
            searchable: (r) => `${tName(r.teacherId)} ${sName(r.studentId)} ${modName(r.sessionId)}`,
          },
        },
        {
          label: "Présences validées (période)",
          value: `${presentCount + lateCount}`,
          tone: "primary",
          icon: <ClipboardList className="h-5 w-5" />,
          hint: `${presentCount} à l'heure · ${lateCount} en retard`,
          detail: {
            columns: [
              { label: "Date & heure", render: (r) => dateTimeCell(r.timestamp) },
              { label: "Élève", render: (r) => <span className="font-bold text-ink">{sName(r.studentId)}</span> },
              { label: "Séance", render: (r) => <span className="font-semibold text-primary">{modName(r.sessionId)}</span> },
              { label: "Statut", render: (r) => <Badge tone={r.status === "late" ? "warning" : "success"}>{r.status === "late" ? "Retard" : "Présent"}</Badge> },
            ],
            rows: attendanceRows,
            totalLabel: "Total scans",
            totalValue: `${fAtt.length}`,
            totalTone: "primary",
            searchable: (r) => `${sName(r.studentId)} ${modName(r.sessionId)}`,
          },
        },
      ],
      panels: [
        {
          title: "Bilan des présences",
          subtitle: `Période du ${reportRange.start} au ${reportRange.end}`,
          icon: <ClipboardList className="h-4 w-4 text-primary" />,
          lines: [
            { label: "Scans à l'heure", value: `${presentCount}`, tone: "success" },
            { label: "Scans en retard", value: `${lateCount}`, tone: "warning" },
            { label: "Total présences", value: `${presentCount + lateCount}`, strong: true, emphasis: true },
            { label: "Recette générée par les séances", value: inflow(seanceRevenue), tone: "success" },
          ],
        },
        {
          title: "Charges enseignants sur séances",
          icon: <AlertCircle className="h-4 w-4 text-warning" />,
          lines: [
            { label: "Séances non payées (sur la période)", value: formatDA(unpaidRangeTotal), tone: "warning" },
            { label: "Séances non payées (cumul global)", value: formatDA(unpaidGlobalTotal), tone: "warning", emphasis: true },
            {
              label: "Marge brute séances (recette − dû profs)",
              value: signed(seanceRevenue - unpaidRangeTotal),
              tone: seanceRevenue - unpaidRangeTotal >= 0 ? "success" : "danger",
              strong: true,
            },
          ],
          note: "Chaque scan RFID d'un élève enregistre une séance à régler à l'enseignant (paiement au pourcentage).",
        },
      ],
    };

    /* ============================ SUBSCRIPTIONS ======================= */
    const subRows = subscriptions.map((sub) => {
      const enrolled = students.filter((s) => s.subscriptionIds.includes(sub.id)).length;
      return { ...sub, enrolled, moduleName: modName(sub.sessionId), className: clsName(sub.sessionId) };
    });
    const potentialPerSession = subRows.reduce((s, r) => s + r.pricePerSession * r.enrolled, 0);
    const avgPrice = subscriptions.length ? Math.round(sum(subscriptions, (s) => s.pricePerSession) / subscriptions.length) : 0;

    const subscriptionsSection: Section = {
      id: "subscriptions",
      label: "Abonnements",
      icon: <Ticket className="h-4 w-4" />,
      cards: [
        {
          label: "Abonnements actifs",
          value: `${subscriptions.length}`,
          tone: "primary",
          icon: <Ticket className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Module", render: (r) => <span className="font-bold text-ink">{r.moduleName}</span> },
              { label: "Classe", render: (r) => <span className="text-muted">{r.className || "—"}</span> },
              { label: "Élèves", align: "right", render: (r) => <span className="font-semibold text-primary">{r.enrolled}</span> },
              { label: "Prix / séance", align: "right", render: (r) => <strong className="text-ink">{formatDA(r.pricePerSession)}</strong> },
              { label: "Potentiel", align: "right", render: (r) => <span className="text-success">{formatDA(r.pricePerSession * r.enrolled)}</span> },
            ],
            rows: subRows,
            totalLabel: "Potentiel / séance complète",
            totalValue: formatDA(potentialPerSession),
            totalTone: "success",
            searchable: (r) => `${r.moduleName} ${r.className}`,
          },
        },
        {
          label: "Recette potentielle / séance",
          value: formatDA(potentialPerSession),
          tone: "success",
          icon: <CircleDollarSign className="h-5 w-5" />,
          hint: "Si tous les inscrits assistent",
          detail: {
            columns: [
              { label: "Module", render: (r) => <span className="font-bold text-ink">{r.moduleName}</span> },
              { label: "Classe", render: (r) => <span className="text-muted">{r.className || "—"}</span> },
              { label: "Élèves inscrits", align: "right", render: (r) => <span className="text-primary">{r.enrolled}</span> },
              { label: "Recette potentielle", align: "right", render: (r) => <strong className="text-success">{formatDA(r.pricePerSession * r.enrolled)}</strong> },
            ],
            rows: [...subRows].sort((a, b) => b.pricePerSession * b.enrolled - a.pricePerSession * a.enrolled),
            totalLabel: "Total potentiel",
            totalValue: formatDA(potentialPerSession),
            totalTone: "success",
            searchable: (r) => `${r.moduleName} ${r.className}`,
          },
        },
        {
          label: "Prix moyen d'une séance",
          value: formatDA(avgPrice),
          tone: "neutral",
          icon: <DollarSign className="h-5 w-5" />,
          hint: "Moyenne du catalogue",
        },
      ],
      panels: [
        {
          title: "Catalogue des abonnements",
          icon: <Ticket className="h-4 w-4 text-primary" />,
          lines: [
            { label: "Nombre d'abonnements", value: `${subscriptions.length}`, strong: true },
            { label: "Prix moyen par séance", value: formatDA(avgPrice) },
            { label: "Potentiel par séance complète", value: formatDA(potentialPerSession), tone: "success", emphasis: true },
          ],
          note: "Le potentiel suppose la présence de tous les élèves inscrits à chaque abonnement.",
        },
      ],
    };

    /* ============================== TEACHERS ========================== */
    const teacherAco = fAco.filter((a) => teacherIds.has(a.teacherId));
    const teacherAbs = fAbs.filter((a) => teacherIds.has(a.teacherId));
    const teacherAcoTotal = sum(teacherAco, (a) => a.amount);
    const teacherAbsTotal = sum(teacherAbs, (a) => a.cost);
    const teacherUnpaid = unpaidGlobal.filter((u) => teacherIds.has(u.teacherId));
    const teacherUnpaidTotal = sum(teacherUnpaid, (u) => u.amount);

    const teachersSection: Section = {
      id: "teachers",
      label: "Enseignants",
      icon: <GraduationCap className="h-4 w-4" />,
      cards: [
        {
          label: "Acomptes versés (profs)",
          value: outflow(teacherAcoTotal),
          tone: "danger",
          icon: <ArrowDownLeft className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Enseignant", render: (r) => <span className="font-bold text-ink">{tName(r.teacherId)}</span> },
              { label: "Motif", render: (r) => <span className="text-muted">{r.description}</span> },
              { label: "Montant", align: "right", render: (r) => <strong className="text-danger">{outflow(r.amount)}</strong> },
            ],
            rows: teacherAco,
            totalLabel: "Total acomptes",
            totalValue: outflow(teacherAcoTotal),
            totalTone: "danger",
            searchable: (r) => `${tName(r.teacherId)} ${r.description}`,
          },
        },
        {
          label: "Séances dues (non payées)",
          value: formatDA(teacherUnpaidTotal),
          tone: "warning",
          icon: <Wallet className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Enseignant", render: (r) => <span className="font-bold text-ink">{tName(r.teacherId)}</span> },
              { label: "Élève", render: (r) => <span className="text-muted">{sName(r.studentId)}</span> },
              { label: "Module", render: (r) => <span className="font-semibold text-primary">{modName(r.sessionId)}</span> },
              { label: "Montant", align: "right", render: (r) => <strong className="text-warning">{formatDA(r.amount)}</strong> },
            ],
            rows: teacherUnpaid,
            totalLabel: "Total dû",
            totalValue: formatDA(teacherUnpaidTotal),
            totalTone: "warning",
            empty: "Aucune séance en attente.",
            searchable: (r) => `${tName(r.teacherId)} ${sName(r.studentId)} ${modName(r.sessionId)}`,
          },
        },
        {
          label: "Retenues absences (profs)",
          value: outflow(teacherAbsTotal),
          tone: "danger",
          icon: <AlertCircle className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Enseignant", render: (r) => <span className="font-bold text-ink">{tName(r.teacherId)}</span> },
              { label: "Motif", render: (r) => <span className="text-muted">{r.description}</span> },
              { label: "Retenue", align: "right", render: (r) => <strong className="text-danger">{outflow(r.cost)}</strong> },
            ],
            rows: teacherAbs,
            totalLabel: "Total retenues",
            totalValue: outflow(teacherAbsTotal),
            totalTone: "danger",
            empty: "Aucune absence enregistrée.",
            searchable: (r) => `${tName(r.teacherId)} ${r.description}`,
          },
        },
        {
          label: "Enseignants actifs",
          value: `${teachers.length}`,
          tone: "primary",
          icon: <GraduationCap className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Enseignant", render: (r) => <span className="font-bold text-ink">{r.firstName} {r.lastName}</span> },
              { label: "Téléphone", render: (r) => <span className="font-mono text-muted">{r.phone}</span> },
              { label: "Rémunération", render: (r) => <Badge tone={r.paymentType === "monthly" ? "primary" : "warning"}>{r.paymentType === "monthly" ? "Mensuel" : "Pourcentage"}</Badge> },
              {
                label: "Base",
                align: "right",
                render: (r) => <span className="text-ink">{r.paymentType === "monthly" ? formatDA(r.monthlyAmount || 0) : `${r.percentage || 0} %`}</span>,
              },
            ],
            rows: teachers,
            totalLabel: "Effectif",
            totalValue: `${teachers.length}`,
            totalTone: "primary",
            searchable: (r) => `${r.firstName} ${r.lastName} ${r.phone}`,
          },
        },
      ],
      panels: [
        {
          title: "Charges enseignants de la période",
          subtitle: `Période du ${reportRange.start} au ${reportRange.end}`,
          icon: <GraduationCap className="h-4 w-4 text-primary" />,
          lines: [
            { label: "Acomptes versés", value: outflow(teacherAcoTotal), tone: "danger" },
            { label: "Retenues pour absences", value: outflow(teacherAbsTotal), tone: "danger" },
            { label: "Séances dues non réglées", value: formatDA(teacherUnpaidTotal), tone: "warning", emphasis: true },
            {
              label: "Engagement total enseignants",
              value: formatDA(teacherAcoTotal + teacherUnpaidTotal),
              strong: true,
            },
          ],
          note: "Les retenues d'absences se déduisent du salaire lors du règlement ; elles ne sont pas un décaissement direct.",
        },
      ],
    };

    /* ============================= RECEPTION ========================== */
    const recAco = fAco.filter((a) => receptionIds.has(a.teacherId));
    const recAbs = fAbs.filter((a) => receptionIds.has(a.teacherId));
    const recAcoTotal = sum(recAco, (a) => a.amount);
    const recAbsTotal = sum(recAbs, (a) => a.cost);
    const recSalaryBase = sum(reception, (r) => r.salary);

    const receptionSection: Section = {
      id: "reception",
      label: "Réception",
      icon: <UserCog className="h-4 w-4" />,
      cards: [
        {
          label: "Agents de réception",
          value: `${reception.length}`,
          tone: "primary",
          icon: <UserCog className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Agent", render: (r) => <span className="font-bold text-ink">{r.firstName} {r.lastName}</span> },
              { label: "Téléphone", render: (r) => <span className="font-mono text-muted">{r.phone}</span> },
              { label: "Type", render: (r) => <Badge tone={r.paymentType === "monthly" ? "primary" : "warning"}>{r.paymentType === "monthly" ? "Mensuel" : "Journalier"}</Badge> },
              { label: "Salaire base", align: "right", render: (r) => <strong className="text-ink">{formatDA(r.salary)}</strong> },
            ],
            rows: reception,
            totalLabel: "Masse salariale de base",
            totalValue: formatDA(recSalaryBase),
            totalTone: "neutral",
            searchable: (r) => `${r.firstName} ${r.lastName} ${r.phone}`,
          },
        },
        {
          label: "Acomptes versés (staff)",
          value: outflow(recAcoTotal),
          tone: "danger",
          icon: <ArrowDownLeft className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Agent", render: (r) => <span className="font-bold text-ink">{tName(r.teacherId)}</span> },
              { label: "Motif", render: (r) => <span className="text-muted">{r.description}</span> },
              { label: "Montant", align: "right", render: (r) => <strong className="text-danger">{outflow(r.amount)}</strong> },
            ],
            rows: recAco,
            totalLabel: "Total acomptes",
            totalValue: outflow(recAcoTotal),
            totalTone: "danger",
            empty: "Aucun acompte réception.",
            searchable: (r) => `${tName(r.teacherId)} ${r.description}`,
          },
        },
        {
          label: "Retenues absences (staff)",
          value: outflow(recAbsTotal),
          tone: "danger",
          icon: <AlertCircle className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Agent", render: (r) => <span className="font-bold text-ink">{tName(r.teacherId)}</span> },
              { label: "Motif", render: (r) => <span className="text-muted">{r.description}</span> },
              { label: "Retenue", align: "right", render: (r) => <strong className="text-danger">{outflow(r.cost)}</strong> },
            ],
            rows: recAbs,
            totalLabel: "Total retenues",
            totalValue: outflow(recAbsTotal),
            totalTone: "danger",
            empty: "Aucune absence agent.",
            searchable: (r) => `${tName(r.teacherId)} ${r.description}`,
          },
        },
      ],
      panels: [
        {
          title: "Personnel de réception",
          subtitle: `Période du ${reportRange.start} au ${reportRange.end}`,
          icon: <UserCog className="h-4 w-4 text-primary" />,
          lines: [
            { label: "Agents actifs", value: `${reception.length}`, strong: true },
            { label: "Masse salariale de base", value: formatDA(recSalaryBase) },
            { label: "Acomptes versés", value: outflow(recAcoTotal), tone: "danger" },
            { label: "Retenues absences", value: outflow(recAbsTotal), tone: "danger", emphasis: true },
          ],
        },
      ],
    };

    /* ======================= INDEPENDENT / COURSEWORK ================= */
    const independentRevenue = sum(fInd, (i) => i.price);
    const courseworkInRange = coursework.filter((c) => c.dates.some((d) => inRange(d)));
    const courseworkRevenue = courseworkInRange.reduce(
      (s, c) => s + c.pricePerSession * c.dates.filter((d) => inRange(d)).length,
      0,
    );

    const independentSection: Section = {
      id: "independent",
      label: "Indépendant",
      icon: <Puzzle className="h-4 w-4" />,
      cards: [
        {
          label: "Séances libres encaissées",
          value: inflow(independentRevenue),
          tone: "success",
          icon: <CircleDollarSign className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              {
                label: "Bénéficiaire",
                render: (r) => <span className="font-bold text-ink">{r.studentId ? sName(r.studentId) : r.passagerName || "Passager"}</span>,
              },
              { label: "Prestation", render: (r) => <span className="text-primary">{r.itemLabel}</span> },
              { label: "Montant", align: "right", render: (r) => <strong className="text-success">{inflow(r.price)}</strong> },
            ],
            rows: [...fInd].sort((a, b) => (a.date < b.date ? 1 : -1)),
            totalLabel: "Recette séances libres",
            totalValue: inflow(independentRevenue),
            totalTone: "success",
            empty: "Aucune séance libre sur la période.",
            searchable: (r) => `${r.studentId ? sName(r.studentId) : r.passagerName} ${r.itemLabel}`,
          },
        },
        {
          label: "Stages / Coursework (période)",
          value: formatDA(courseworkRevenue),
          tone: "sky",
          icon: <Layers className="h-5 w-5" />,
          hint: "Séances programmées dans la période",
          detail: {
            columns: [
              { label: "Intitulé", render: (r) => <span className="font-bold text-ink">{r.name}</span> },
              { label: "Type", render: (r) => <Badge tone={r.type === "single" ? "primary" : "neutral"}>{r.type === "single" ? "Jour unique" : "Période"}</Badge> },
              { label: "Enseignant", render: (r) => <span className="text-muted">{tName(r.teacherId)}</span> },
              { label: "Séances (pér.)", align: "right", render: (r) => <span className="text-primary">{r.dates.filter((d: string) => inRange(d)).length}/{r.dates.length}</span> },
              { label: "Prix / séance", align: "right", render: (r) => <span className="text-ink">{formatDA(r.pricePerSession)}</span> },
              { label: "Recette pér.", align: "right", render: (r) => <strong className="text-sky-500">{formatDA(r.pricePerSession * r.dates.filter((d: string) => inRange(d)).length)}</strong> },
            ],
            rows: courseworkInRange,
            totalLabel: "Recette coursework",
            totalValue: formatDA(courseworkRevenue),
            totalTone: "sky",
            empty: "Aucun stage programmé sur la période.",
            searchable: (r) => `${r.name} ${tName(r.teacherId)}`,
          },
        },
        {
          label: "Total activités indépendantes",
          value: inflow(independentRevenue + courseworkRevenue),
          tone: "success",
          icon: <Puzzle className="h-5 w-5" />,
        },
      ],
      panels: [
        {
          title: "Activités indépendantes",
          subtitle: `Période du ${reportRange.start} au ${reportRange.end}`,
          icon: <Puzzle className="h-4 w-4 text-primary" />,
          lines: [
            { label: "Séances libres (nombre)", value: `${fInd.length}` },
            { label: "Recette séances libres", value: inflow(independentRevenue), tone: "success" },
            { label: "Stages actifs sur la période", value: `${courseworkInRange.length}` },
            { label: "Recette stages (période)", value: formatDA(courseworkRevenue), tone: "sky" },
            { label: "Total activités indépendantes", value: inflow(independentRevenue + courseworkRevenue), tone: "success", emphasis: true },
          ],
        },
      ],
    };

    /* ============================== EXPENSES ========================== */
    const expensesTotal = sum(fExp, (e) => e.amount);
    const catRows = categories
      .map((cat) => {
        const items = fExp.filter((e) => e.categoryId === cat.id);
        return { id: cat.id, name: cat.name, count: items.length, total: sum(items, (e) => e.amount) };
      })
      .filter((c) => c.count > 0)
      .sort((a, b) => b.total - a.total);
    const uncategorized = fExp.filter((e) => !categories.some((c) => c.id === e.categoryId));
    if (uncategorized.length) {
      catRows.push({ id: "none", name: "Sans catégorie", count: uncategorized.length, total: sum(uncategorized, (e) => e.amount) });
    }
    const catName = (id: string) => categories.find((c) => c.id === id)?.name ?? "Sans catégorie";

    const expensesSection: Section = {
      id: "expenses",
      label: "Dépenses",
      icon: <Receipt className="h-4 w-4" />,
      cards: [
        {
          label: "Dépenses de fonctionnement",
          value: outflow(expensesTotal),
          tone: "danger",
          icon: <Receipt className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Désignation", render: (r) => <span className="font-bold text-ink">{r.name}</span> },
              { label: "Catégorie", render: (r) => <Badge tone="neutral">{catName(r.categoryId)}</Badge> },
              { label: "Montant", align: "right", render: (r) => <strong className="text-danger">{outflow(r.amount)}</strong> },
            ],
            rows: [...fExp].sort((a, b) => (a.date < b.date ? 1 : -1)),
            totalLabel: "Total dépenses",
            totalValue: outflow(expensesTotal),
            totalTone: "danger",
            empty: "Aucune dépense sur la période.",
            searchable: (r) => `${r.name} ${catName(r.categoryId)}`,
          },
        },
        {
          label: "Catégories mouvementées",
          value: `${catRows.length}`,
          tone: "primary",
          icon: <Layers className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Catégorie", render: (r) => <span className="font-bold text-ink">{r.name}</span> },
              { label: "Dépenses", align: "right", render: (r) => <span className="text-muted">{r.count}</span> },
              { label: "Total", align: "right", render: (r) => <strong className="text-danger">{outflow(r.total)}</strong> },
            ],
            rows: catRows,
            totalLabel: "Total dépenses",
            totalValue: outflow(expensesTotal),
            totalTone: "danger",
            empty: "Aucune catégorie mouvementée.",
            searchable: (r) => r.name,
          },
        },
      ],
      panels: [
        {
          title: "Répartition des dépenses",
          subtitle: `Période du ${reportRange.start} au ${reportRange.end}`,
          icon: <Receipt className="h-4 w-4 text-danger" />,
          lines: [
            ...catRows.map((c) => ({ label: c.name, value: outflow(c.total), tone: "danger" as Tone })),
            { label: "Total des dépenses", value: outflow(expensesTotal), tone: "danger" as Tone, emphasis: true },
          ],
        },
      ],
    };

    /* =============================== CASH ============================= */
    const cashStudent = sum(
      fCash.filter((t) => t.type === "student_payment"),
      (t) => t.amount,
    );
    const cashDeposit = sum(
      fCash.filter((t) => t.type === "deposit"),
      (t) => t.amount,
    );
    const cashStaff = Math.abs(
      sum(
        fCash.filter((t) => t.type === "teacher_payment" || t.type === "acompte"),
        (t) => t.amount,
      ),
    );
    const cashExpenseWithdraw = Math.abs(
      sum(
        fCash.filter((t) => t.type === "expense" || t.type === "withdraw"),
        (t) => t.amount,
      ),
    );
    const cashIn = cashStudent + cashDeposit;
    const cashOut = cashStaff + cashExpenseWithdraw;
    const cashNet = cashIn - cashOut;

    const cashTypeLabel: Record<string, { label: string; tone: Tone }> = {
      student_payment: { label: "Encaissement élève", tone: "success" },
      deposit: { label: "Dépôt", tone: "success" },
      teacher_payment: { label: "Salaire / Staff", tone: "danger" },
      acompte: { label: "Acompte", tone: "warning" },
      expense: { label: "Dépense", tone: "danger" },
      withdraw: { label: "Retrait", tone: "danger" },
    };

    const cashSection: Section = {
      id: "cash",
      label: "Caisse",
      icon: <PiggyBank className="h-4 w-4" />,
      cards: [
        {
          label: "Encaissements élèves (caisse)",
          value: inflow(cashStudent),
          tone: "success",
          icon: <ArrowUpRight className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Désignation", render: (r) => <span className="font-semibold text-ink">{r.description}</span> },
              { label: "Montant", align: "right", render: (r) => <strong className="text-success">{inflow(r.amount)}</strong> },
            ],
            rows: fCash.filter((t) => t.type === "student_payment"),
            totalLabel: "Total",
            totalValue: inflow(cashStudent),
            totalTone: "success",
            searchable: (r) => r.description,
          },
        },
        {
          label: "Dépôts manuels",
          value: inflow(cashDeposit),
          tone: "success",
          icon: <PiggyBank className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Désignation", render: (r) => <span className="font-semibold text-ink">{r.description}</span> },
              { label: "Montant", align: "right", render: (r) => <strong className="text-success">{inflow(r.amount)}</strong> },
            ],
            rows: fCash.filter((t) => t.type === "deposit"),
            totalLabel: "Total dépôts",
            totalValue: inflow(cashDeposit),
            totalTone: "success",
            empty: "Aucun dépôt manuel.",
            searchable: (r) => r.description,
          },
        },
        {
          label: "Sorties salaires & acomptes",
          value: outflow(cashStaff),
          tone: "danger",
          icon: <ArrowDownLeft className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Type", render: (r) => <Badge tone={badgeTone(cashTypeLabel[r.type]?.tone ?? "neutral")}>{cashTypeLabel[r.type]?.label ?? r.type}</Badge> },
              { label: "Désignation", render: (r) => <span className="text-muted">{r.description}</span> },
              { label: "Montant", align: "right", render: (r) => <strong className="text-danger">{outflow(r.amount)}</strong> },
            ],
            rows: fCash.filter((t) => t.type === "teacher_payment" || t.type === "acompte"),
            totalLabel: "Total sorties staff",
            totalValue: outflow(cashStaff),
            totalTone: "danger",
            empty: "Aucun règlement de personnel.",
            searchable: (r) => r.description,
          },
        },
        {
          label: "Dépenses & retraits",
          value: outflow(cashExpenseWithdraw),
          tone: "danger",
          icon: <Receipt className="h-5 w-5" />,
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Type", render: (r) => <Badge tone={badgeTone(cashTypeLabel[r.type]?.tone ?? "neutral")}>{cashTypeLabel[r.type]?.label ?? r.type}</Badge> },
              { label: "Désignation", render: (r) => <span className="text-muted">{r.description}</span> },
              { label: "Montant", align: "right", render: (r) => <strong className="text-danger">{outflow(r.amount)}</strong> },
            ],
            rows: fCash.filter((t) => t.type === "expense" || t.type === "withdraw"),
            totalLabel: "Total",
            totalValue: outflow(cashExpenseWithdraw),
            totalTone: "danger",
            searchable: (r) => r.description,
          },
        },
        {
          label: "Solde net de caisse (période)",
          value: signed(cashNet),
          tone: cashNet >= 0 ? "success" : "danger",
          icon: <Banknote className="h-5 w-5" />,
          hint: "Entrées − Sorties de caisse",
          detail: {
            columns: [
              { label: "Date", render: (r) => dateCell(r.date) },
              { label: "Type", render: (r) => <Badge tone={badgeTone(cashTypeLabel[r.type]?.tone ?? "neutral")}>{cashTypeLabel[r.type]?.label ?? r.type}</Badge> },
              { label: "Désignation", render: (r) => <span className="text-muted">{r.description}</span> },
              { label: "Montant", align: "right", render: (r) => <strong className={r.amount >= 0 ? "text-success" : "text-danger"}>{signed(r.amount)}</strong> },
            ],
            rows: [...fCash].sort((a, b) => (a.date < b.date ? 1 : -1)),
            totalLabel: "Solde net",
            totalValue: signed(cashNet),
            totalTone: cashNet >= 0 ? "success" : "danger",
            searchable: (r) => `${r.description} ${cashTypeLabel[r.type]?.label ?? r.type}`,
          },
        },
      ],
      panels: [
        {
          title: "Journal de caisse",
          subtitle: `Période du ${reportRange.start} au ${reportRange.end}`,
          icon: <PiggyBank className="h-4 w-4 text-primary" />,
          lines: [
            { label: "Encaissements élèves", value: inflow(cashStudent), tone: "success" },
            { label: "Dépôts manuels", value: inflow(cashDeposit), tone: "success" },
            { label: "Total entrées", value: inflow(cashIn), tone: "success", emphasis: true },
            { label: "Salaires & acomptes", value: outflow(cashStaff), tone: "danger" },
            { label: "Dépenses & retraits", value: outflow(cashExpenseWithdraw), tone: "danger" },
            { label: "Total sorties", value: outflow(cashOut), tone: "danger", emphasis: true },
            { label: "Solde net de caisse", value: signed(cashNet), tone: cashNet >= 0 ? "success" : "danger", strong: true },
          ],
        },
      ],
    };

    /* ============================== OVERVIEW ========================== */
    const totalInflows = cashStudent + cashDeposit;
    const totalOutflows = cashStaff + cashExpenseWithdraw;
    const netGains = totalInflows - totalOutflows;

    const overviewSection: Section = {
      id: "overview",
      label: "Vue d'ensemble",
      icon: <FileSpreadsheet className="h-4 w-4" />,
      cards: [
        {
          label: "Total encaissements (période)",
          value: inflow(totalInflows),
          tone: "success",
          icon: <ArrowUpRight className="h-5 w-5" />,
          detail: cashSection.cards[0].detail,
        },
        {
          label: "Total sorties (période)",
          value: outflow(totalOutflows),
          tone: "danger",
          icon: <ArrowDownLeft className="h-5 w-5" />,
          detail: cashSection.cards[2].detail,
        },
        {
          label: "Recette des séances",
          value: inflow(seanceRevenue),
          tone: "primary",
          icon: <CircleDollarSign className="h-5 w-5" />,
          detail: attendanceSection.cards[0].detail,
        },
        {
          label: "Dépenses de fonctionnement",
          value: outflow(expensesTotal),
          tone: "danger",
          icon: <Receipt className="h-5 w-5" />,
          detail: expensesSection.cards[0].detail,
        },
        {
          label: "Dettes élèves (créances)",
          value: formatDA(totalDebts),
          tone: "warning",
          icon: <AlertCircle className="h-5 w-5" />,
          detail: studentsSection.cards[5].detail,
        },
        {
          label: "Séances profs non payées",
          value: formatDA(unpaidGlobalTotal),
          tone: "warning",
          icon: <Wallet className="h-5 w-5" />,
          detail: attendanceSection.cards[1].detail,
        },
        {
          label: "Bilan net consolidé",
          value: signed(netGains),
          tone: netGains >= 0 ? "success" : "danger",
          icon: <FileSpreadsheet className="h-5 w-5" />,
          hint: "Recettes − Sorties",
          featured: true,
        },
      ],
      panels: [
        {
          title: "Bilan des flux de trésorerie",
          subtitle: `Période du ${reportRange.start} au ${reportRange.end}`,
          icon: <FileSpreadsheet className="h-4 w-4 text-primary" />,
          lines: [
            { label: "Encaissements élèves", value: inflow(cashStudent), tone: "success" },
            { label: "Dépôts manuels", value: inflow(cashDeposit), tone: "success" },
            { label: "Total des recettes", value: inflow(totalInflows), tone: "success", emphasis: true },
            { label: "Règlements personnel", value: outflow(cashStaff), tone: "danger" },
            { label: "Dépenses & retraits", value: outflow(cashExpenseWithdraw), tone: "danger" },
            { label: "Total des sorties", value: outflow(totalOutflows), tone: "danger", emphasis: true },
            { label: "Bilan net consolidé", value: signed(netGains), tone: netGains >= 0 ? "success" : "danger", strong: true, formula: "Recettes − Sorties" },
          ],
        },
        {
          title: "Créances & engagements en cours",
          icon: <AlertCircle className="h-4 w-4 text-warning" />,
          lines: [
            { label: "Créances clients (dettes élèves)", value: formatDA(totalDebts), tone: "warning" },
            { label: "Séances enseignants à régler", value: formatDA(unpaidGlobalTotal), tone: "warning" },
            { label: "Engagements totaux à venir", value: formatDA(totalDebts + unpaidGlobalTotal), strong: true, emphasis: true },
          ],
          note: `Portée du bilan — ${students.length} élèves · ${teachers.length} enseignants · ${reception.length} agents · ${classes.length} classes · ${subscriptions.length} abonnements · ${parents.length} parents.`,
        },
      ],
    };

    return {
      sections: [
        overviewSection,
        studentsSection,
        attendanceSection,
        subscriptionsSection,
        teachersSection,
        receptionSection,
        independentSection,
        expensesSection,
        cashSection,
      ],
    };
  }, [
    isGenerated,
    reportRange,
    cash,
    students,
    unpaidTeacher,
    expenses,
    teachers,
    modules,
    sessions,
    classes,
    reception,
    acomptes,
    absences,
    balanceTx,
    attendance,
    independent,
    coursework,
    subscriptions,
    categories,
    parents,
  ]);

  const current = report?.sections.find((s) => s.id === activeSection) ?? report?.sections[0];

  return (
    <div className="space-y-6">
      <PageHeader emoji="💰" title="Rapports Financiers" subtitle="Bilans consolidés et détaillés par interface de l'application" />

      {/* Date controls + generate */}
      <div className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 card-shadow md:flex-row md:items-end">
        <div className="grid flex-1 grid-cols-2 gap-4">
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted">
              <Calendar className="h-3.5 w-3.5" /> Date de début
            </label>
            <Input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                setIsGenerated(false);
              }}
              className="rounded-xl text-xs"
            />
          </div>
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted">
              <Calendar className="h-3.5 w-3.5" /> Date de fin
            </label>
            <Input
              type="date"
              value={endDate}
              onChange={(e) => {
                setEndDate(e.target.value);
                setIsGenerated(false);
              }}
              className="rounded-xl text-xs"
            />
          </div>
        </div>
        <Button onClick={handleGenerate} className="flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl px-6 font-bold">
          <FileText className="h-4 w-4" /> Générer le Bilan
        </Button>
      </div>

      {!isGenerated || !reportRange || !report || !current ? (
        <Card className="border border-dashed border-line bg-canvas/30 p-12 text-center">
          <div className="mx-auto max-w-md space-y-3">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <FileSpreadsheet className="h-6 w-6" />
            </div>
            <h3 className="text-sm font-bold text-ink">Bilan financier en attente</h3>
            <p className="text-xs leading-relaxed text-muted">
              Sélectionnez une période puis cliquez sur <strong>&laquo;&nbsp;Générer le Bilan&nbsp;&raquo;</strong>. Aucune donnée n&apos;est
              calculée tant que vous n&apos;avez pas lancé la génération. Vous pourrez ensuite filtrer par interface et cliquer sur chaque carte
              pour afficher toutes les listes détaillées.
            </p>
          </div>
        </Card>
      ) : (
        <div className="animate-in fade-in space-y-6 duration-300">
          {/* Section filter chips */}
          <div className="flex gap-1.5 overflow-x-auto rounded-2xl border border-line bg-canvas/30 p-2 scrollbar-none">
            {report.sections.map((s) => (
              <button
                key={s.id}
                onClick={() => setActiveSection(s.id)}
                className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-4 py-2 text-xs font-bold transition-all ${
                  activeSection === s.id ? "bg-gradient-primary text-white shadow-sm" : "text-muted hover:bg-surface hover:text-ink"
                }`}
              >
                {s.icon}
                {s.label}
              </button>
            ))}
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {current.cards.map((c, i) => (
              <MetricCard key={i} spec={c} onOpen={openDetail} />
            ))}
          </div>

          {/* Small calculations */}
          {current.panels.length > 0 && (
            <div className={`grid grid-cols-1 gap-6 ${current.panels.length > 1 ? "lg:grid-cols-2" : ""}`}>
              {current.panels.map((p, i) => (
                <CalcCard key={i} panel={p} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detail modal */}
      <Modal open={!!detail} onClose={() => setDetail(null)} title={detail?.title} wide>
        {detail && (
          <div className="space-y-4">
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-muted">
                <Search className="h-4 w-4" />
              </span>
              <Input
                type="text"
                placeholder="Rechercher dans cette liste..."
                value={modalSearch}
                onChange={(e) => setModalSearch(e.target.value)}
                className="w-full rounded-xl px-4 py-2 pl-9 text-xs"
              />
              {modalSearch && (
                <button
                  onClick={() => setModalSearch("")}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-muted hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            <DetailTable spec={detail.spec} search={modalSearch} />

            <div className="flex justify-end border-t border-line pt-4">
              <Button variant="outline" onClick={() => setDetail(null)} className="rounded-xl">
                Fermer
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
