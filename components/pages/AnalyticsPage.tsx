"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { motion } from "framer-motion";
import { useData } from "@/lib/store/data";
import { Button } from "@/components/ui/Button";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { printHtmlDocument } from "@/lib/print";
import type {
  AttendanceRecord,
  ScheduleSession,
  School,
  SchoolClass,
  Student,
  Subscription,
  Teacher,
} from "@/lib/types";
import {
  Calendar,
  Sparkles,
  Users,
  GraduationCap,
  Printer,
  TrendingUp,
  AlertCircle,
  ChevronDown,
  UserCheck,
  Clock,
  CalendarDays,
  Activity,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Palette & shared helpers                                            */
/* ------------------------------------------------------------------ */

const CHART_POINTS = 8;

/** Distinct accent per card, tuned to read well on both light & dark themes. */
const PALETTE = [
  "#6366f1", // indigo
  "#0ea5e9", // sky
  "#f59e0b", // amber
  "#ec4899", // pink
  "#14b8a6", // teal
  "#8b5cf6", // violet
  "#f43f5e", // rose
  "#22c55e", // green
];

function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase();
}

const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);

/** Even, period-spanning buckets with a human date/time label for each. */
function makeBucketMeta(start: Date, end: Date, count: number) {
  const span = Math.max(end.getTime() - start.getTime(), 1);
  const size = span / count;
  const spanDays = span / 86_400_000;
  return Array.from({ length: count }, (_, i) => {
    const bStart = new Date(start.getTime() + i * size);
    const label =
      spanDays <= 2
        ? bStart.toLocaleTimeString("fr-DZ", { hour: "2-digit", minute: "2-digit" })
        : spanDays <= 90
          ? bStart.toLocaleDateString("fr-DZ", { day: "2-digit", month: "short" })
          : bStart.toLocaleDateString("fr-DZ", { month: "short", year: "2-digit" });
    return label;
  });
}

/** Number of DISTINCT students seen per time bucket (the requested time series). */
function studentsPerBucket(
  start: Date,
  end: Date,
  records: { timestamp: string; studentId: string }[],
  count: number,
): number[] {
  const sets = Array.from({ length: count }, () => new Set<string>());
  const span = Math.max(end.getTime() - start.getTime(), 1);
  const size = span / count;
  records.forEach((r) => {
    const offset = new Date(r.timestamp).getTime() - start.getTime();
    const idx = Math.min(count - 1, Math.max(0, Math.floor(offset / size)));
    sets[idx].add(r.studentId);
  });
  return sets.map((s) => s.size);
}

interface Stat {
  id: string;
  name: string;
  subtitle: string;
  enrolled: number;
  sessionsCount: number;
  present: number;
  late: number;
  absent: number;
  studentsSeen: number;
  /** distinct students per time bucket */
  studentTrend: number[];
  labels: string[];
}

function computeClassStats(
  classes: SchoolClass[],
  students: Student[],
  subscriptions: Subscription[],
  sessions: ScheduleSession[],
  attendance: AttendanceRecord[],
  start: Date,
  end: Date,
): Stat[] {
  const labels = makeBucketMeta(start, end, CHART_POINTS);
  return classes.map((cls) => {
    const classSessionIds = new Set(sessions.filter((s) => s.classId === cls.id).map((s) => s.id));

    const enrolled = students.filter((student) =>
      student.subscriptionIds.some((subId) => {
        const sub = subscriptions.find((s) => s.id === subId);
        return sub ? classSessionIds.has(sub.sessionId) : false;
      }),
    ).length;

    const records = attendance.filter((a) => {
      if (!classSessionIds.has(a.sessionId)) return false;
      const d = new Date(a.timestamp);
      return d >= start && d <= end;
    });

    const levelLabel = (cls.type === "cours" ? cls.coursLevel : cls.formationLevel) ?? "";
    return {
      id: cls.id,
      name: cls.name,
      subtitle: `${cls.type === "cours" ? "Cours" : "Formation"} ${levelLabel}`.trim(),
      enrolled,
      sessionsCount: classSessionIds.size,
      present: records.filter((r) => r.status === "present").length,
      late: records.filter((r) => r.status === "late").length,
      absent: records.filter((r) => r.status === "absent").length,
      studentsSeen: new Set(records.map((r) => r.studentId)).size,
      studentTrend: studentsPerBucket(start, end, records, CHART_POINTS),
      labels,
    };
  });
}

function computeTeacherStats(
  teachers: Teacher[],
  sessions: ScheduleSession[],
  attendance: AttendanceRecord[],
  start: Date,
  end: Date,
): Stat[] {
  const labels = makeBucketMeta(start, end, CHART_POINTS);
  return teachers.map((t) => {
    const tSessions = sessions.filter((s) => s.teacherId === t.id);
    const sessionIds = new Set(tSessions.map((s) => s.id));

    const records = attendance.filter((a) => {
      if (!sessionIds.has(a.sessionId)) return false;
      const d = new Date(a.timestamp);
      return d >= start && d <= end;
    });

    return {
      id: t.id,
      name: `${t.firstName} ${t.lastName}`,
      subtitle: `${tSessions.length} séance(s) programmée(s)`,
      enrolled: new Set(records.map((r) => r.studentId)).size,
      sessionsCount: tSessions.length,
      present: records.filter((r) => r.status === "present").length,
      late: records.filter((r) => r.status === "late").length,
      absent: records.filter((r) => r.status === "absent").length,
      studentsSeen: new Set(records.map((r) => r.studentId)).size,
      studentTrend: studentsPerBucket(start, end, records, CHART_POINTS),
      labels,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Print helpers (rendered inside a hidden iframe — same tab)          */
/* ------------------------------------------------------------------ */

const esc = (v: string) =>
  v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const PRINT_COLORS = { present: "#059669", late: "#d97706", absent: "#dc2626", line: "#e6e1f5" };

function donutHtml(present: number, late: number, absent: number) {
  const total = present + late + absent;
  let bg = `conic-gradient(${PRINT_COLORS.line} 0% 100%)`;
  if (total > 0) {
    const p = (present / total) * 100;
    const l = (late / total) * 100;
    bg = `conic-gradient(${PRINT_COLORS.present} 0% ${p}%, ${PRINT_COLORS.late} ${p}% ${p + l}%, ${PRINT_COLORS.absent} ${p + l}% 100%)`;
  }
  return `
    <div style="position:relative;width:92px;height:92px;border-radius:999px;background:${bg};flex-shrink:0;">
      <div style="position:absolute;inset:8px;border-radius:999px;background:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;">
        <strong style="font-size:1.1em;color:#222;">${total}</strong>
        <span style="font-size:0.58em;color:#888;">présences</span>
      </div>
    </div>`;
}

/** Inline SVG area chart of distinct students over the period (for print). */
function areaChartSvg(data: number[], labels: string[], color: string) {
  const w = 520;
  const h = 150;
  const padX = 10;
  const padTop = 14;
  const padBottom = 24;
  const max = Math.max(...data, 1);
  const n = data.length;
  const innerW = w - padX * 2;
  const innerH = h - padTop - padBottom;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const pts = data.map((v, i) => ({
    x: padX + i * stepX,
    y: padTop + innerH - (v / max) * innerH,
    v,
  }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area =
    n > 0
      ? `${line} L${pts[n - 1].x.toFixed(1)},${(padTop + innerH).toFixed(1)} L${pts[0].x.toFixed(1)},${(padTop + innerH).toFixed(1)} Z`
      : "";
  const grid = [0, 0.5, 1]
    .map((f) => {
      const y = padTop + innerH * f;
      return `<line x1="${padX}" y1="${y.toFixed(1)}" x2="${w - padX}" y2="${y.toFixed(1)}" stroke="#eee" stroke-width="1" />`;
    })
    .join("");
  const dots = pts
    .map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#fff" stroke="${color}" stroke-width="2" />`)
    .join("");
  const xlabels = labels
    .map((l, i) => `<text x="${(padX + i * stepX).toFixed(1)}" y="${h - 6}" font-size="8" fill="#999" text-anchor="middle">${esc(l)}</text>`)
    .join("");
  const gid = "g" + Math.random().toString(36).slice(2, 8);
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" style="max-height:150px;">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
    </linearGradient></defs>
    ${grid}
    ${area ? `<path d="${area}" fill="url(#${gid})" />` : ""}
    ${line ? `<path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ""}
    ${dots}
    ${xlabels}
  </svg>`;
}

function blockHtml(stat: Stat, accent: string, kind: "class" | "teacher") {
  const total = stat.present + stat.late + stat.absent;
  const rate = total ? Math.round((stat.present / total) * 100) : 0;
  return `
    <div class="block">
      <div class="block-top" style="border-top-color:${accent}">
        <div class="block-head">
          <div class="avatar" style="background:${accent}">${esc(initials(stat.name))}</div>
          <div>
            <h3>${esc(stat.name)}</h3>
            <span class="tag">${esc(stat.subtitle)}</span>
          </div>
        </div>
        <label class="trend-label">Nombre d'élèves suivis sur la période</label>
        ${areaChartSvg(stat.studentTrend, stat.labels, accent)}
        <div class="block-body">
          ${donutHtml(stat.present, stat.late, stat.absent)}
          <div class="stats-grid">
            <div class="stat"><label>${kind === "class" ? "Effectif" : "Élèves vus"}</label><strong>${kind === "class" ? stat.enrolled : stat.studentsSeen}</strong></div>
            <div class="stat"><label>Présents</label><strong style="color:${PRINT_COLORS.present}">${stat.present}</strong></div>
            <div class="stat"><label>Retards</label><strong style="color:${PRINT_COLORS.late}">${stat.late}</strong></div>
            <div class="stat"><label>Taux présence</label><strong>${rate}%</strong></div>
          </div>
        </div>
      </div>
    </div>`;
}

function buildPrintDocument(opts: {
  title: string;
  school: School;
  startLabel: string;
  endLabel: string;
  bodyHtml: string;
}) {
  const { title, school, startLabel, endLabel, bodyHtml } = opts;
  const logoHtml = school.logo
    ? `<img src="${esc(school.logo)}" alt="logo" class="school-logo" />`
    : `<div class="school-logo-fallback">🏫</div>`;
  return `
    <html>
      <head>
        <title>${esc(title)}</title>
        <style>
          @media print {
            body { padding: 0; margin: 0; background: #fff; color: #000; font-size: 11px; }
            .grid { grid-template-columns: repeat(2, 1fr) !important; }
            .page-break { page-break-before: always; }
          }
          * { box-sizing: border-box; }
          body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 25px; color: #1e1b4b; background-color: #faf9ff; }
          
          /* Letterhead Header */
          .letterhead { display: flex; justify-content: space-between; align-items: stretch; border: 1px solid #e8e6f4; background: #fff; padding: 15px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
          .school-identity { display: flex; align-items: center; gap: 15px; }
          .school-logo, .school-logo-fallback { width: 60px; height: 60px; border-radius: 12px; object-fit: cover; }
          .school-logo-fallback { background: #f5f3ff; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; font-size: 2em; }
          .school-details h2 { margin: 0; font-size: 1.35em; color: #7c3aed; font-weight: 800; }
          .school-details p { margin: 2px 0; font-size: 0.82em; color: #5c567a; }
          
          .school-tax-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; border-left: 2px solid #7c3aed; padding-left: 15px; align-items: center; }
          .tax-item { font-size: 0.75em; color: #5c567a; }
          .tax-item strong { color: #1e1b4b; font-family: monospace; }
          
          /* Document title banner */
          .doc-title-banner { background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: #fff; padding: 12px; border-radius: 12px; margin-bottom: 20px; text-align: center; }
          .doc-title-banner h1 { margin: 0; font-size: 1.35em; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
          .doc-title-banner p { margin: 4px 0 0; font-size: 0.85em; opacity: 0.9; }

          .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px; }
          .block { break-inside: avoid; border: 1px solid #e8e6f4; border-radius: 14px; overflow: hidden; margin-bottom: 15px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
          .block-top { border-top: 5px solid; padding: 16px; }
          .block-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
          .avatar { width: 38px; height: 38px; border-radius: 10px; color: #fff; font-weight: 700; font-size: 0.8em; display: flex; align-items: center; justify-content: center; }
          .block-head h3 { margin: 0; font-size: 1em; color: #1e1b4b; font-weight: 700; }
          .tag { display: inline-block; margin-top: 2px; font-size: 0.68em; background: #f5f3ff; color: #7c3aed; padding: 2px 8px; border-radius: 999px; font-weight: 600; }
          .block-body { display: flex; align-items: center; gap: 14px; margin-top: 12px; }
          .stats-grid { flex: 1; display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; }
          .stat { background: #faf9ff; border: 1px solid #f1f0fb; border-radius: 8px; padding: 6px 8px; }
          .stat label { display: block; font-size: 0.62em; text-transform: uppercase; color: #5c567a; font-weight: 700; }
          .stat strong { font-size: 1em; color: #1e1b4b; font-weight: 700; }
          .trend-label { display: block; font-size: 0.65em; text-transform: uppercase; color: #5c567a; font-weight: 700; margin-bottom: 6px; }
          
          .meta-text { text-align: center; font-size: 0.72em; color: #999; margin-top: 30px; font-style: italic; }
        </style>
      </head>
      <body>
        <div class="letterhead">
          <div class="school-identity">
            ${logoHtml}
            <div class="school-details">
              <h2>${school.name}</h2>
              <p>${school.description}</p>
              <p>📍 ${school.address} | 📞 ${school.phone}</p>
              <p>✉️ ${school.email}</p>
            </div>
          </div>
          <div class="school-tax-grid">
            <div class="tax-item">NIF: <strong>${school.nif || "-"}</strong></div>
            <div class="tax-item">NIS: <strong>${school.nis || "-"}</strong></div>
            <div class="tax-item">RC: <strong>${school.registreCommerce || "-"}</strong></div>
            <div class="tax-item">Art. Fiscal: <strong>${school.articleFiscal || "-"}</strong></div>
          </div>
        </div>

        <div class="doc-title-banner">
          <h1>${esc(title)}</h1>
          <p>Période : du <strong>${startLabel}</strong> au <strong>${endLabel}</strong></p>
        </div>

        <div class="grid">${bodyHtml}</div>
        
        <div class="meta-text">
          Document d'analyse d'activité édité électroniquement par l'école ${school.name} le ${new Date().toLocaleString("fr-DZ")}
        </div>
      </body>
    </html>`;
}

/* ------------------------------------------------------------------ */
/* On-screen chart primitives                                          */
/* ------------------------------------------------------------------ */

/** Area/line chart: distinct students seen per time bucket. */
function AreaChart({ data, labels, color }: { data: number[]; labels: string[]; color: string }) {
  const rawId = useId();
  const gid = `ac${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const w = 320;
  const h = 118;
  const padX = 8;
  const padTop = 14;
  const padBottom = 8;
  const max = Math.max(...data, 1);
  const n = data.length;
  const innerW = w - padX * 2;
  const innerH = h - padTop - padBottom;
  const stepX = n > 1 ? innerW / (n - 1) : 0;
  const pts = data.map((v, i) => ({
    x: padX + i * stepX,
    y: padTop + innerH - (v / max) * innerH,
    v,
  }));
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area =
    n > 0
      ? `${line} L${pts[n - 1].x.toFixed(1)},${(padTop + innerH).toFixed(1)} L${pts[0].x.toFixed(1)},${(padTop + innerH).toFixed(1)} Z`
      : "";

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label="Évolution du nombre d'élèves">
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.42} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={padX}
            x2={w - padX}
            y1={padTop + innerH * f}
            y2={padTop + innerH * f}
            stroke="var(--border)"
            strokeWidth={1}
          />
        ))}
        {area && (
          <motion.path
            d={area}
            fill={`url(#${gid})`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.15 }}
          />
        )}
        {line && (
          <motion.path
            d={line}
            fill="none"
            stroke={color}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.9, ease: "easeOut" }}
          />
        )}
        {pts.map((p, i) => (
          <motion.circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={3}
            fill="var(--surface)"
            stroke={color}
            strokeWidth={2}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.35 + i * 0.05 }}
          >
            <title>{`${labels[i]} — ${p.v} élève(s)`}</title>
          </motion.circle>
        ))}
      </svg>
      <div className="mt-1 flex justify-between px-1">
        {labels.map((l, i) => (
          <span key={i} className="text-[8px] font-medium leading-none text-muted">
            {l}
          </span>
        ))}
      </div>
    </div>
  );
}

function Donut({ present, late, absent }: { present: number; late: number; absent: number }) {
  const total = present + late + absent;
  const pPct = total ? (present / total) * 100 : 0;
  const lPct = total ? (late / total) * 100 : 0;
  const bg = total
    ? `conic-gradient(var(--success) 0% ${pPct}%, var(--warning) ${pPct}% ${pPct + lPct}%, var(--danger) ${pPct + lPct}% 100%)`
    : `conic-gradient(var(--line) 0% 100%)`;

  return (
    <motion.div
      initial={{ scale: 0.6, opacity: 0, rotate: -90 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative h-20 w-20 shrink-0 rounded-full"
      style={{ background: bg }}
    >
      <div className="absolute inset-[7px] flex flex-col items-center justify-center rounded-full bg-surface">
        <span className="text-base font-extrabold leading-none text-ink">{total}</span>
        <span className="mt-0.5 text-[9px] font-semibold text-muted">présences</span>
      </div>
    </motion.div>
  );
}

function Pill({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="rounded-xl border border-line/60 bg-canvas/40 px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="text-base font-extrabold leading-tight" style={tone ? { color: tone } : undefined}>
        {value}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Analytic card (class or teacher)                                    */
/* ------------------------------------------------------------------ */

function AnalyticCard({
  stat,
  index,
  accent,
  kind,
  onPrint,
}: {
  stat: Stat;
  index: number;
  accent: string;
  kind: "class" | "teacher";
  onPrint: () => void;
}) {
  const [open, setOpen] = useState(false);
  const total = stat.present + stat.late + stat.absent;
  const rate = total ? Math.round((stat.present / total) * 100) : 0;
  const peak = Math.max(...stat.studentTrend, 0);
  const peakLabel = stat.labels[stat.studentTrend.indexOf(peak)] ?? "—";
  const avg = stat.studentTrend.length ? (sum(stat.studentTrend) / stat.studentTrend.length).toFixed(1) : "0";

  return (
    <motion.div
      initial={{ opacity: 0, y: 22, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.35, delay: index * 0.06, ease: [0.22, 1, 0.36, 1] }}
      className="group relative h-full overflow-hidden rounded-3xl border border-line bg-surface card-shadow card-interactive"
    >
      {/* Accent glow header */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24 opacity-[0.14]"
        style={{ background: `radial-gradient(120% 120% at 20% 0%, ${accent} 0%, transparent 70%)` }}
      />
      <div className="h-1.5 w-full" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}00)` }} />

      <div className="relative space-y-4 p-5">
        {/* Head */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-md"
              style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
            >
              {initials(stat.name)}
            </div>
            <div>
              <h4 className="text-sm font-bold text-ink">{stat.name}</h4>
              <span
                className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold"
                style={{ backgroundColor: `${accent}1f`, color: accent }}
              >
                {stat.subtitle}
              </span>
            </div>
          </div>
          <button
            onClick={onPrint}
            className="rounded-xl border border-line/70 p-2 text-muted transition-colors hover:border-transparent hover:text-white"
            style={{ backgroundColor: "transparent" }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = accent)}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
            title="Imprimer ce graphique"
          >
            <Printer className="h-4 w-4" />
          </button>
        </div>

        {/* Hero: student count over time */}
        <div className="rounded-2xl border border-line/60 bg-canvas/30 p-3">
          <div className="mb-1 flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-muted">
              <Activity className="h-3.5 w-3.5" style={{ color: accent }} /> Élèves suivis / période
            </p>
            <span className="text-[11px] font-bold" style={{ color: accent }}>
              pic {peak}
            </span>
          </div>
          <AreaChart data={stat.studentTrend} labels={stat.labels} color={accent} />
        </div>

        {/* Snapshot: donut + key stats */}
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-center gap-1.5">
            <Donut present={stat.present} late={stat.late} absent={stat.absent} />
            <span className="text-[10px] font-semibold text-muted">{rate}% présence</span>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2">
            <Pill label={kind === "class" ? "Effectif" : "Élèves vus"} value={kind === "class" ? stat.enrolled : stat.studentsSeen} />
            <Pill label="Présents" value={stat.present} tone="var(--success)" />
            <Pill label="Retards" value={stat.late} tone="var(--warning)" />
            <Pill label="Séances" value={stat.sessionsCount} />
          </div>
        </div>

        {/* Expandable details */}
        <button
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-line/60 bg-canvas/30 py-2 text-[11px] font-semibold text-muted transition-colors hover:text-ink"
        >
          {open ? "Masquer les détails" : "Voir tous les détails"}
          <motion.span animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown className="h-3.5 w-3.5" />
          </motion.span>
        </button>

        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-2 gap-2 pt-1">
              <DetailRow icon={<UserCheck className="h-3.5 w-3.5 text-success" />} label="Présences validées" value={stat.present + stat.late} />
              <DetailRow icon={<Clock className="h-3.5 w-3.5 text-warning" />} label="Retards" value={stat.late} />
              <DetailRow icon={<Users className="h-3.5 w-3.5 text-primary" />} label="Élèves distincts vus" value={stat.studentsSeen} />
              <DetailRow icon={<CalendarDays className="h-3.5 w-3.5 text-muted" />} label="Pic d'affluence" value={`${peak} (${peakLabel})`} />
              <DetailRow icon={<TrendingUp className="h-3.5 w-3.5 text-primary" />} label="Moyenne / intervalle" value={avg} />
              <DetailRow icon={<Activity className="h-3.5 w-3.5" style={{ color: accent }} />} label="Taux de présence" value={`${rate}%`} />
            </div>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function DetailRow({ icon, label, value }: { icon: ReactNode; label: string; value: number | string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-line/50 bg-surface px-2.5 py-2">
      {icon}
      <div className="min-w-0">
        <p className="truncate text-[10px] font-medium text-muted">{label}</p>
        <p className="text-sm font-bold text-ink">{value}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */

export function AnalyticsPage() {
  const { classes, students, subscriptions, sessions, teachers, attendance, school } = useData();

  const todayIso = new Date().toISOString().split("T")[0];
  const yearStartIso = new Date(new Date().getFullYear(), 0, 1).toISOString().split("T")[0];

  const [startDate, setStartDate] = useState(yearStartIso);
  const [endDate, setEndDate] = useState(todayIso);
  const [appliedStartDate, setAppliedStartDate] = useState(yearStartIso);
  const [appliedEndDate, setAppliedEndDate] = useState(todayIso);
  const [hasGenerated, setHasGenerated] = useState(false);

  const [tab, setTab] = useState<"classes" | "teachers">("classes");
  const [classFilter, setClassFilter] = useState<string>("all");
  const [teacherFilter, setTeacherFilter] = useState<string>("all");

  const isDirty = hasGenerated && (startDate !== appliedStartDate || endDate !== appliedEndDate);

  const handleGenerate = () => {
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
    setHasGenerated(true);
  };

  const { start, end } = useMemo(() => {
    const s = new Date(appliedStartDate);
    const e = new Date(appliedEndDate);
    e.setHours(23, 59, 59, 999);
    return { start: s, end: e };
  }, [appliedStartDate, appliedEndDate]);

  const classStats = useMemo(() => {
    if (!hasGenerated) return [];
    return computeClassStats(classes, students, subscriptions, sessions, attendance, start, end);
  }, [hasGenerated, classes, students, subscriptions, sessions, attendance, start, end]);

  const teacherStats = useMemo(() => {
    if (!hasGenerated) return [];
    return computeTeacherStats(teachers, sessions, attendance, start, end);
  }, [hasGenerated, teachers, sessions, attendance, start, end]);

  const periodAttendance = useMemo(() => {
    if (!hasGenerated) return [];
    return attendance.filter((a) => {
      const d = new Date(a.timestamp);
      return d >= start && d <= end;
    });
  }, [hasGenerated, attendance, start, end]);

  const kpiStudentsSeen = useMemo(() => new Set(periodAttendance.map((a) => a.studentId)).size, [periodAttendance]);
  const kpiPresences = useMemo(
    () => periodAttendance.filter((a) => a.status === "present" || a.status === "late").length,
    [periodAttendance],
  );

  const filteredClassStats = classFilter === "all" ? classStats : classStats.filter((c) => c.id === classFilter);
  const filteredTeacherStats = teacherFilter === "all" ? teacherStats : teacherStats.filter((t) => t.id === teacherFilter);

  const startLabel = new Date(appliedStartDate).toLocaleDateString("fr-DZ");
  const endLabel = new Date(appliedEndDate).toLocaleDateString("fr-DZ");

  const printOne = (stat: Stat, accent: string, kind: "class" | "teacher") => {
    printHtmlDocument(
      buildPrintDocument({
        title: `Analyse — ${kind === "class" ? "Classe" : "Enseignant"} ${stat.name}`,
        school,
        startLabel,
        endLabel,
        bodyHtml: blockHtml(stat, accent, kind),
      }),
    );
  };

  const handlePrintAll = () => {
    const list = tab === "classes" ? filteredClassStats : filteredTeacherStats;
    const kind = tab === "classes" ? "class" : "teacher";
    const body = list.map((s, i) => blockHtml(s, PALETTE[i % PALETTE.length], kind as "class" | "teacher")).join("");
    printHtmlDocument(
      buildPrintDocument({
        title: tab === "classes" ? "Analyse — Classes" : "Analyse — Enseignants",
        school,
        startLabel,
        endLabel,
        bodyHtml: body,
      }),
    );
  };

  const activeList = tab === "classes" ? filteredClassStats : filteredTeacherStats;

  return (
    <div className="space-y-6">
      <PageHeader
        emoji="📈"
        title="Analytique"
        subtitle="Suivi de l'affluence des élèves par classe et par enseignant"
        actions={
          hasGenerated ? (
            <Button variant="secondary" onClick={handlePrintAll} className="flex items-center gap-2">
              <Printer className="h-4 w-4" /> Imprimer la vue
            </Button>
          ) : undefined
        }
      />

      {/* Control panel */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
        className="relative flex flex-col gap-4 overflow-hidden rounded-3xl border border-line bg-gradient-card p-5 md:flex-row md:items-end"
      >
        <div className="pointer-events-none absolute -end-12 -top-12 h-48 w-48 rounded-full bg-gradient-primary opacity-15 blur-3xl" />
        <div className="grid flex-1 grid-cols-2 gap-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Période du</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="pl-9" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Au</label>
            <div className="relative">
              <Calendar className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="pl-9" />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {isDirty && (
            <span className="flex items-center gap-1 text-[11px] font-semibold text-warning">
              <AlertCircle className="h-3.5 w-3.5" /> Cliquez sur Générer pour appliquer
            </span>
          )}
          <Button
            onClick={handleGenerate}
            className={`flex h-11 items-center gap-2 px-6 ${!hasGenerated ? "pulse-glow" : ""}`}
          >
            <Sparkles className="h-4 w-4" /> Générer l&apos;analyse
          </Button>
        </div>
      </motion.div>

      {!hasGenerated ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-line bg-surface/60 py-20 text-center"
        >
          <motion.div
            animate={{ y: [0, -10, 0] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-primary text-3xl card-shadow"
          >
            📈
          </motion.div>
          <div>
            <h3 className="font-bold text-ink">Aucune analyse générée</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
              Choisissez une période puis cliquez sur « Générer l&apos;analyse » pour afficher, classe par classe et
              enseignant par enseignant, le graphique d&apos;affluence des élèves.
            </p>
          </div>
        </motion.div>
      ) : (
        <div className="space-y-6">
          {/* KPI row */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <MiniKpi accent="#6366f1" emoji="👥" label="Élèves suivis" value={kpiStudentsSeen} index={0} />
            <MiniKpi accent="#22c55e" emoji="✅" label="Présences validées" value={kpiPresences} index={1} />
            <MiniKpi accent="#f59e0b" emoji="🏫" label="Classes actives" value={classes.length} index={2} />
            <MiniKpi accent="#ec4899" emoji="🎓" label="Enseignants actifs" value={teachers.length} index={3} />
          </div>

          {/* Segmented tabs: Classes / Enseignants */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-2xl border border-line bg-surface p-1">
              <TabButton active={tab === "classes"} onClick={() => setTab("classes")} icon={<Users className="h-4 w-4" />}>
                Par Classe
              </TabButton>
              <TabButton active={tab === "teachers"} onClick={() => setTab("teachers")} icon={<GraduationCap className="h-4 w-4" />}>
                Par Enseignant
              </TabButton>
            </div>

            {tab === "classes" ? (
              <Select value={classFilter} onChange={(e) => setClassFilter(e.target.value)} className="w-60">
                <option value="all">Toutes les classes</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            ) : (
              <Select value={teacherFilter} onChange={(e) => setTeacherFilter(e.target.value)} className="w-60">
                <option value="all">Tous les enseignants</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
              </Select>
            )}
          </div>

          {/* Cards grid */}
          {activeList.length === 0 ? (
            <EmptyState
              emoji={tab === "classes" ? "🏫" : "🎓"}
              message={tab === "classes" ? "Aucune classe à afficher." : "Aucun enseignant à afficher."}
            />
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
              {activeList.map((s, i) => (
                <AnalyticCard
                  key={s.id}
                  stat={s}
                  index={i}
                  accent={PALETTE[i % PALETTE.length]}
                  kind={tab === "classes" ? "class" : "teacher"}
                  onPrint={() => printOne(s, PALETTE[i % PALETTE.length], tab === "classes" ? "class" : "teacher")}
                />
              ))}
            </div>
          )}

          <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-muted">
            <TrendingUp className="h-3.5 w-3.5" /> Analyse générée pour la période du {startLabel} au {endLabel}
          </p>
        </div>
      )}
    </div>
  );
}

function MiniKpi({
  accent,
  emoji,
  label,
  value,
  index,
}: {
  accent: string;
  emoji: string;
  label: string;
  value: number;
  index: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.32 }}
      className="relative overflow-hidden rounded-2xl border border-line bg-surface p-4 card-shadow"
    >
      <div
        className="pointer-events-none absolute -end-4 -top-4 h-20 w-20 rounded-full opacity-20 blur-xl"
        style={{ backgroundColor: accent }}
      />
      <div className="flex items-center gap-3">
        <div
          className="flex h-10 w-10 items-center justify-center rounded-xl text-lg"
          style={{ backgroundColor: `${accent}22` }}
        >
          {emoji}
        </div>
        <div>
          <p className="text-[11px] font-semibold text-muted">{label}</p>
          <p className="text-2xl font-extrabold text-ink">{value}</p>
        </div>
      </div>
    </motion.div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200 ${
        active ? "bg-gradient-primary text-white shadow-sm" : "text-muted hover:text-ink"
      }`}
    >
      <span className="relative flex items-center gap-2">
        {icon}
        {children}
      </span>
    </button>
  );
}
