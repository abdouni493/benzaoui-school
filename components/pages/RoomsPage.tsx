"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { PageHeader } from "@/components/layout/PageHeader";
import { ChevronLeft, ChevronRight, Printer, CalendarDays, DoorOpen } from "lucide-react";
import type { Day, ScheduleSession } from "@/lib/types";
import {
  DAY_LABELS_FR,
  classCascadeLabel,
  layoutRow,
  scheduleSlots,
  slotSpan,
  sessionSalleIds,
  type TimeSlot,
} from "@/lib/helpers";
import { printHtmlDocument } from "@/lib/print";
import {
  printDocument,
  letterheadHtml,
  bannerHtml,
  metaFooterHtml,
} from "@/lib/printTemplates";

const DAY_KEYS: Day[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

/** YYYY-MM-DD d'une Date, en heure LOCALE (jamais décalé en UTC). */
const isoOf = (d: Date) => d.toLocaleDateString("fr-CA");

/** Le jour de la semaine d'une date ISO, sans piège de fuseau. */
const dayOfIso = (iso: string): Day => DAY_KEYS[new Date(`${iso}T12:00:00`).getDay()];

const longDateFr = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

/** Couleur stable par module : la même matière garde sa teinte d'une salle à
 *  l'autre, ce qui rend la grille lisible d'un coup d'œil. */
const cardTone = (seed: string) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  const tones = [
    "border-l-blue-500 bg-blue-50/70 dark:bg-blue-950/25",
    "border-l-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/25",
    "border-l-amber-500 bg-amber-50/70 dark:bg-amber-950/25",
    "border-l-rose-500 bg-rose-50/70 dark:bg-rose-950/25",
    "border-l-purple-500 bg-purple-50/70 dark:bg-purple-950/25",
    "border-l-cyan-500 bg-cyan-50/70 dark:bg-cyan-950/25",
    "border-l-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/25",
  ];
  return tones[Math.abs(hash) % tones.length];
};

/**
 * Répartition des salles — qui occupe quoi, et quand.
 *
 * Une ligne par salle, une colonne par tranche horaire réellement utilisée ce
 * jour-là (les colonnes sont déduites des séances, pas d'une grille figée), et
 * chaque séance posée sur exactement les colonnes que couvrent son heure de
 * début et son heure de fin. C'est la vue qui manquait pour savoir, à un moment
 * donné, quelle salle est libre.
 */
export function RoomsPage() {
  const { sessions, salles, modules, groups, teachers, classes, filieres, subscriptions, students, school } =
    useData();
  const { language } = useSettings();

  const [date, setDate] = useState<string>(() => isoOf(new Date()));
  const [selected, setSelected] = useState<ScheduleSession | null>(null);

  const day = dayOfIso(date);

  // ---- Noms ----------------------------------------------------------------
  const moduleName = (id?: string) => modules.find((m) => m.id === id)?.name ?? "Matière";
  const groupName = (id?: string) => groups.find((g) => g.id === id)?.name ?? "—";
  const salleName = (id?: string) => salles.find((s) => s.id === id)?.name ?? "Salle";
  const teacherName = (id?: string) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.firstName} ${t.lastName}`.trim() : "—";
  };
  const filiereName = (id?: string) => (id ? filieres.find((f) => f.id === id)?.name ?? "" : "");
  const className = (id?: string) => {
    const c = classes.find((x) => x.id === id);
    if (!c) return "—";
    return classCascadeLabel(c, c.filiereId ? filiereName(c.filiereId) : "") || c.name;
  };

  /** Le titre porté par la carte : une séance libre a le sien, un cours prend
   *  le nom de son module. */
  const sessionTitle = (s: ScheduleSession) =>
    s.isOpen ? s.title || `Séance libre — ${moduleName(s.moduleId)}` : moduleName(s.moduleId);

  const enrolledCount = (sessionId: string) => {
    const subIds = subscriptions.filter((su) => su.sessionId === sessionId).map((su) => su.id);
    if (subIds.length === 0) return 0;
    return students.filter((stu) => stu.subscriptionIds.some((id) => subIds.includes(id))).length;
  };

  // ---- Les séances réellement posées ce jour-là ----------------------------
  // Un créneau n'existe ce jour que s'il est programmé sur ce jour de semaine
  // ET, pour une séance libre, à l'intérieur de sa période de dates.
  const daySessions = useMemo(
    () =>
      sessions
        .filter((s) => s.days.includes(day))
        .filter((s) => !s.periodStart || s.periodStart <= date)
        .filter((s) => !s.periodEnd || s.periodEnd >= date)
        .sort((a, b) => a.startTime.localeCompare(b.startTime)),
    [sessions, day, date],
  );

  const slots: TimeSlot[] = useMemo(() => scheduleSlots(daySessions), [daySessions]);

  /** Les salles à afficher : celles qui servent ce jour-là d'abord, puis les
   *  autres — une salle vide doit se voir, c'est justement une salle libre. */
  const usedSalleIds = useMemo(() => {
    const used = new Set<string>();
    for (const s of daySessions) sessionSalleIds(s).forEach((id) => used.add(id));
    return used;
  }, [daySessions]);

  const rows = useMemo(() => {
    const list = salles.map((salle) => {
      // Une séance libre couvrant plusieurs salles apparaît dans chacune.
      const placed = daySessions
        .filter((s) => sessionSalleIds(s).includes(salle.id))
        .map((s) => {
          const span = slotSpan(s, slots);
          return span ? { item: s, index: span.index, span: span.span } : null;
        })
        .filter((p): p is { item: ScheduleSession; index: number; span: number } => !!p);
      const cells = layoutRow(placed, slots.length);
      const shown = new Set(
        cells.filter((c) => c.kind === "item").map((c) => (c as { item: ScheduleSession }).item.id),
      );
      const overlapping = placed.map((p) => p.item).filter((s) => !shown.has(s.id));
      return { salle, placed, cells, overlapping };
    });
    // Salles occupées en premier, l'ordre de l'école conservé à l'intérieur.
    return [
      ...list.filter((r) => usedSalleIds.has(r.salle.id)),
      ...list.filter((r) => !usedSalleIds.has(r.salle.id)),
    ];
  }, [salles, daySessions, slots, usedSalleIds]);

  const shiftDate = (days: number) => {
    const d = new Date(`${date}T12:00:00`);
    d.setDate(d.getDate() + days);
    setDate(isoOf(d));
  };

  const todayIso = isoOf(new Date());

  // ---- Impression ----------------------------------------------------------
  // Le même tableau, avec les mêmes fusions de colonnes, en document A4 paysage.
  const handlePrint = () => {
    const head = slots
      .map((s) => `<th style="white-space:nowrap;">${s.start}<br/>${s.end}</th>`)
      .join("");

    const body = rows
      .map(({ salle, cells }) => {
        const html = cells
          .map((cell) =>
            cell.kind === "free"
              ? "<td></td>"
              : `<td colspan="${cell.span}" style="background:#f4f2fb; text-align:left;">
                   <strong>${sessionTitle(cell.item)}</strong><br/>
                   <span style="font-size:.85em; color:#5c567a;">
                     ${className(cell.item.classId)} · ${groupName(cell.item.groupId)}<br/>
                     ${teacherName(cell.item.teacherId)} · ${cell.item.startTime}-${cell.item.endTime}
                   </span>
                 </td>`,
          )
          .join("");
        return `<tr><th style="text-align:left; white-space:nowrap;">${salle.name}</th>${html}</tr>`;
      })
      .join("");

    const bodyHtml = `
      ${letterheadHtml(school)}
      ${bannerHtml("Répartition des salles", longDateFr(date))}
      <div class="frame">
        <table>
          <thead><tr><th style="text-align:left;">Salle</th>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div>
      <p style="font-size:.8em; color:#5c567a; margin-top:8px;">
        ${daySessions.length} séance(s) · ${usedSalleIds.size} salle(s) occupée(s) sur ${salles.length}.
      </p>
      ${metaFooterHtml(school.name, language)}
    `;

    printHtmlDocument(
      printDocument({
        title: `Répartition des salles - ${date}`,
        lang: language,
        bodyHtml,
        // Une journée compte souvent plus de colonnes que n'en tient un A4 portrait.
        extraCss: "@page { size: A4 landscape; margin: 10mm; } table { font-size: .78em; }",
      }),
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        emoji="🏛️"
        title="Répartition des Salles"
        subtitle="Qui occupe quelle salle, et à quelle heure"
        actions={
          <Button variant="outline" size="sm" onClick={handlePrint} disabled={slots.length === 0}>
            <Printer className="h-3.5 w-3.5" /> Imprimer
          </Button>
        }
      />

      {/* Navigation par date : la journée en cours, et tout l'historique. */}
      <Card className="border border-line">
        <CardBody className="flex flex-wrap items-center gap-3 p-3">
          <div className="flex items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={() => shiftDate(-1)} title="Jour précédent">
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value || todayIso)}
              className="h-9 rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none focus:border-primary"
            />
            <Button variant="outline" size="sm" onClick={() => shiftDate(1)} title="Jour suivant">
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>

          <span className="flex items-center gap-1.5 text-xs font-bold text-ink">
            <CalendarDays className="h-4 w-4 text-primary" />
            {DAY_LABELS_FR[day]} {longDateFr(date)}
          </span>

          {date !== todayIso && (
            <Button variant="outline" size="sm" onClick={() => setDate(todayIso)}>
              Revenir à aujourd&apos;hui
            </Button>
          )}

          <div className="ms-auto flex flex-wrap items-center gap-2 text-[10px] text-muted">
            <Badge tone="primary">{daySessions.length} séance(s)</Badge>
            <Badge tone={usedSalleIds.size > 0 ? "success" : "neutral"}>
              {usedSalleIds.size} / {salles.length} salle(s) occupée(s)
            </Badge>
          </div>
        </CardBody>
      </Card>

      {salles.length === 0 ? (
        <Card className="border border-line bg-canvas/30 p-8 text-center">
          <DoorOpen className="mx-auto mb-2 h-10 w-10 text-muted" />
          <h3 className="text-sm font-bold text-ink">Aucune salle enregistrée</h3>
          <p className="mt-1 text-[11px] text-muted">
            Ajoutez les salles de l&apos;école depuis <strong className="text-ink">Classes</strong> pour voir
            leur répartition ici.
          </p>
        </Card>
      ) : slots.length === 0 ? (
        <Card className="border border-line bg-canvas/30 p-8 text-center">
          <CalendarDays className="mx-auto mb-2 h-10 w-10 text-muted" />
          <h3 className="text-sm font-bold text-ink">Aucune séance ce jour-là</h3>
          <p className="mt-1 text-[11px] text-muted">
            Aucun créneau n&apos;est programmé le {DAY_LABELS_FR[day].toLowerCase()}{" "}
            {longDateFr(date)} : toutes les salles sont libres.
          </p>
        </Card>
      ) : (
        <Card className="border border-line">
          <CardBody className="p-0">
            {/* Le tableau déborde volontairement en largeur : une journée peut
                compter beaucoup de tranches horaires. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-xs">
                <thead>
                  <tr className="bg-canvas/50">
                    <th className="sticky start-0 z-10 w-40 border-b border-e border-line bg-canvas/95 p-2.5 text-start text-[10px] font-bold uppercase tracking-wider text-muted backdrop-blur">
                      Salle
                    </th>
                    {slots.map((slot) => (
                      <th
                        key={`${slot.start}-${slot.end}`}
                        className="border-b border-e border-line p-2 text-center text-[10px] font-bold text-ink"
                      >
                        <span className="block font-mono">{slot.start}</span>
                        <span className="block font-mono text-muted">{slot.end}</span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ salle, placed, cells: rowCells, overlapping }) => {
                    // Les cellules sont déjà découpées (layoutRow) : du temps
                    // libre, ou une séance sur exactement ses colonnes.
                    const cells: ReactNode[] = rowCells.map((cell, i) =>
                      cell.kind === "free" ? (
                        <td key={`free-${salle.id}-${i}`} className="border-b border-e border-line p-1" />
                      ) : (
                        <td
                          key={`ses-${salle.id}-${cell.item.id}-${i}`}
                          colSpan={cell.span}
                          className="border-b border-e border-line p-1 align-top"
                        >
                          <button
                            onClick={() => setSelected(cell.item)}
                            className={`w-full rounded-lg border border-line border-l-4 p-2 text-start transition-transform hover:scale-[1.01] ${cardTone(
                              cell.item.moduleId || cell.item.id,
                            )}`}
                          >
                            <strong className="block truncate text-[11px] font-black text-ink">
                              {cell.item.isOpen && <span className="me-1">🎯</span>}
                              {sessionTitle(cell.item)}
                            </strong>
                            <span className="block truncate text-[10px] text-muted">
                              {className(cell.item.classId)} · {groupName(cell.item.groupId)}
                            </span>
                            <span className="block truncate text-[10px] text-muted">
                              {teacherName(cell.item.teacherId)}
                            </span>
                            <span className="mt-0.5 block font-mono text-[10px] font-bold text-primary">
                              {cell.item.startTime} - {cell.item.endTime}
                            </span>
                          </button>
                        </td>
                      ),
                    );

                    const busy = placed.length > 0;
                    return (
                      <tr key={salle.id} className={busy ? "" : "opacity-60"}>
                        <th className="sticky start-0 z-10 border-b border-e border-line bg-surface p-2.5 text-start align-top">
                          <span className="block text-[11px] font-black text-ink">{salle.name}</span>
                          <span className="block text-[10px] font-semibold text-muted">
                            {busy ? `${placed.length} séance(s)` : "Libre toute la journée"}
                          </span>
                          {/* Deux cours dans la même salle à la même heure : la
                              grille n'en montre qu'un, l'autre est signalé ici
                              plutôt que de disparaître en silence. */}
                          {overlapping.length > 0 && (
                            <span
                              className="mt-1 block text-[10px] font-bold text-danger"
                              title={overlapping
                                .map((s) => `${sessionTitle(s)} (${s.startTime}-${s.endTime})`)
                                .join(" · ")}
                            >
                              ⚠ {overlapping.length} en conflit d&apos;horaire
                            </span>
                          )}
                        </th>
                        {cells}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Détail d'une séance — le même contenu que la carte, en entier. */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? sessionTitle(selected) : ""}
      >
        {selected && (
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                ["Salle", sessionSalleIds(selected).map(salleName).join(" · ")],
                ["Horaire", `${selected.startTime} - ${selected.endTime}`],
                ["Jour", selected.days.map((d) => DAY_LABELS_FR[d]).join(", ")],
                ["Classe", className(selected.classId)],
                ["Groupe", groupName(selected.groupId)],
                ["Enseignant", teacherName(selected.teacherId)],
                ["Module", moduleName(selected.moduleId)],
                ["Inscrits", `${enrolledCount(selected.id)} élève(s)`],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-line bg-canvas/30 p-2.5">
                  <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">
                    {label}
                  </span>
                  <strong className="text-ink">{value || "—"}</strong>
                </div>
              ))}
            </div>

            {selected.isOpen && (
              <div className="rounded-xl border border-success/25 bg-success/10 p-2.5 text-[11px] text-ink">
                <strong className="block">Séance libre</strong>
                {selected.periodStart && selected.periodEnd && (
                  <span className="text-muted">
                    Période du {selected.periodStart.split("-").reverse().join("/")} au{" "}
                    {selected.periodEnd.split("-").reverse().join("/")}.{" "}
                  </span>
                )}
                <span className="text-muted">
                  {selected.isFree
                    ? "Créneau offert : aucun débit sur le solde des élèves."
                    : `Tarif : ${selected.openPrice ?? 0} DA la séance.`}
                </span>
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="outline" size="sm" onClick={() => setSelected(null)}>
                Fermer
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
