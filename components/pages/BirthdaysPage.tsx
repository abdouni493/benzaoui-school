"use client";

/**
 * Anniversaires des élèves.
 *
 * TROIS LISTES, ET UNE SEULE ALERTE
 * ---------------------------------
 *  1. AUJOURD'HUI — et, parmi eux, ceux que l'EMPLOI DU TEMPS DU JOUR attend
 *     réellement. Eux seuls déclenchent l'alerte (bandeau ici, pastille dans le
 *     menu, carte sur le tableau de bord) : féliciter quelqu'un suppose qu'il
 *     passe la porte. Ceux qui n'ont pas cours restent affichés juste en
 *     dessous, sans alerte.
 *  2. LES 30 PROCHAINS JOURS — pour préparer, pas pour alerter.
 *  3. TOUT L'ANNUAIRE, mois par mois, avec recherche.
 *
 * Rien de tout cela n'est stocké : la date de naissance est déjà sur la fiche
 * de l'élève, et l'emploi du temps est déjà en mémoire. Cette page ne fait que
 * croiser les deux.
 */

import { useMemo, useState } from "react";
import { Cake, CalendarHeart, Printer, Search } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/ui/EmptyState";
import { useData } from "@/lib/store/data";
import { useSettings } from "@/lib/store/settings";
import { useTodayBirthdays } from "@/lib/useTodayBirthdays";
import { birthdayIsoIn, isBirthdayOn, monthDayOf, upcomingBirthdays } from "@/lib/birthdays";
import {
  DAY_LABELS_FR,
  dayOfIsoDate,
  matchesAllWords,
  sessionSalleIds,
  studentName,
} from "@/lib/helpers";
import { printHtmlDocument } from "@/lib/print";
import {
  printDocument,
  letterheadHtml,
  bannerHtml,
  escapeHtml,
  metaFooterHtml,
} from "@/lib/printTemplates";
import type { ScheduleSession } from "@/lib/types";

const MONTHS_FR = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

const longDateFr = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const shortDateFr = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" });

/** "dans 3 jours", "demain", "aujourd'hui" — la seule formulation qu'on lit vite. */
const inDaysLabel = (n: number) =>
  n === 0 ? "aujourd'hui" : n === 1 ? "demain" : `dans ${n} jours`;

export function BirthdaysPage() {
  const { students, modules, salles, teachers, school } = useData();
  const { language } = useSettings();
  const { date, expected, away } = useTodayBirthdays();

  const [query, setQuery] = useState("");
  // "" = tous les mois. Le mois en cours d'office : c'est celui qu'on consulte.
  const [month, setMonth] = useState<string>(() => date.slice(5, 7));

  const moduleName = (id?: string) => modules.find((m) => m.id === id)?.name ?? "Matière";
  const teacherName = (id?: string) => {
    const t = teachers.find((x) => x.id === id);
    return t ? `${t.firstName} ${t.lastName}`.trim() : "";
  };
  const salleLabel = (s: ScheduleSession) =>
    sessionSalleIds(s)
      .map((id) => salles.find((sa) => sa.id === id)?.name ?? "Salle")
      .join(" · ");
  const sessionTitle = (s: ScheduleSession) =>
    s.isOpen ? s.title || `Séance libre — ${moduleName(s.moduleId)}` : moduleName(s.moduleId);

  const upcoming = useMemo(
    // Aujourd'hui a déjà sa propre liste, en haut de page : la suivante
    // commence donc demain, sinon les mêmes noms apparaissent deux fois.
    () => upcomingBirthdays(students, date, 30).filter((b) => b.inDays > 0),
    [students, date],
  );

  /** L'annuaire : les élèves du mois choisi, du 1er au 31, recherche comprise. */
  const directory = useMemo(() => {
    return students
      .map((s) => ({ student: s, md: monthDayOf(s.birthDate) }))
      .filter((row) => row.md !== null)
      .filter((row) => (month ? row.md!.startsWith(`${month}-`) : true))
      .filter((row) => (query.trim() ? matchesAllWords(studentName(row.student), query) : true))
      .sort(
        (a, b) =>
          a.md!.localeCompare(b.md!) || studentName(a.student).localeCompare(studentName(b.student), "fr"),
      );
  }, [students, month, query]);

  /** Les fiches sans date de naissance : rien ne les fêtera jamais tant que la
   *  case reste vide, et c'est le genre d'oubli qui ne se voit nulle part. */
  const missingBirthDate = useMemo(
    () => students.filter((s) => monthDayOf(s.birthDate) === null),
    [students],
  );

  const handlePrint = () => {
    const todayRows = [...expected, ...away]
      .map(
        (e) => `<tr>
            <td>${escapeHtml(studentName(e.student))}</td>
            <td>${e.age !== null ? `${e.age} ans` : "-"}</td>
            <td>${escapeHtml(e.student.phone || "-")}</td>
            <td>${
              e.sessions.length === 0
                ? "<em>aucune séance aujourd'hui</em>"
                : e.sessions
                    .map(
                      (s) =>
                        `${s.startTime}-${s.endTime} ${escapeHtml(sessionTitle(s))}${
                          salleLabel(s) ? ` (${escapeHtml(salleLabel(s))})` : ""
                        }`,
                    )
                    .join("<br/>")
            }</td>
          </tr>`,
      )
      .join("");

    const upcomingRows = upcoming
      .map(
        (b) => `<tr>
            <td>${escapeHtml(shortDateFr(b.date))}</td>
            <td>${escapeHtml(studentName(b.student))}</td>
            <td>${b.age !== null ? `${b.age} ans` : "-"}</td>
            <td>${escapeHtml(inDaysLabel(b.inDays))}</td>
          </tr>`,
      )
      .join("");

    const bodyHtml = `
      ${letterheadHtml(school)}
      ${bannerHtml("Anniversaires des élèves", longDateFr(date))}
      <div class="frame">
        <h3>Aujourd'hui (${expected.length + away.length})</h3>
        ${
          expected.length + away.length === 0
            ? "<p><em>Aucun anniversaire aujourd'hui.</em></p>"
            : `<table>
                 <thead><tr><th>Élève</th><th>Âge</th><th>Téléphone</th><th>Séances du jour</th></tr></thead>
                 <tbody>${todayRows}</tbody>
               </table>`
        }
      </div>
      <div class="frame">
        <h3>Les 30 prochains jours (${upcoming.length})</h3>
        ${
          upcoming.length === 0
            ? "<p><em>Aucun anniversaire dans les 30 jours.</em></p>"
            : `<table>
                 <thead><tr><th>Date</th><th>Élève</th><th>Âge</th><th>Échéance</th></tr></thead>
                 <tbody>${upcomingRows}</tbody>
               </table>`
        }
      </div>
      ${metaFooterHtml(school.name, language)}
    `;

    printHtmlDocument(
      printDocument({
        title: `Anniversaires - ${date}`,
        lang: language,
        bodyHtml,
        extraCss: "table { font-size: .82em; } h3 { margin: 4px 0 8px; font-size: 1em; }",
      }),
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        emoji="🎂"
        title="Anniversaires des Élèves"
        subtitle="Qui est fêté aujourd'hui, et à quelle heure il passe"
        actions={
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="h-3.5 w-3.5" /> Imprimer
          </Button>
        }
      />

      {/* L'ALERTE. Elle ne compte que les élèves de l'emploi du temps du jour. */}
      {expected.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-primary/25 bg-primary-50 p-3.5 text-xs font-semibold text-primary">
          <Cake className="h-4.5 w-4.5 shrink-0" />
          <span>
            🎂 {expected.length} élève(s) fêtent leur anniversaire aujourd&apos;hui ET ont cours :{" "}
            {expected.map((e) => studentName(e.student)).join(", ")}.
          </span>
        </div>
      ) : (
        <div className="rounded-2xl border border-line bg-canvas/30 p-3.5 text-xs text-muted">
          Aucun élève de l&apos;emploi du temps du {DAY_LABELS_FR[dayOfIsoDate(date)].toLowerCase()}{" "}
          {longDateFr(date)} ne fête son anniversaire aujourd&apos;hui.
        </div>
      )}

      {/* ---- Aujourd'hui ---------------------------------------------------- */}
      <Card className="border border-line card-shadow">
        <CardBody className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
            <h3 className="flex items-center gap-2 font-bold text-ink">
              <Cake className="h-4.5 w-4.5 text-primary" /> Aujourd&apos;hui — {longDateFr(date)}
            </h3>
            <Badge tone={expected.length > 0 ? "primary" : "neutral"}>
              {expected.length} en cours
            </Badge>
            {away.length > 0 && <Badge tone="neutral">{away.length} sans séance</Badge>}
          </div>

          {expected.length === 0 && away.length === 0 ? (
            <EmptyState emoji="🎈" message="Aucun anniversaire aujourd'hui." />
          ) : (
            <div className="space-y-2.5">
              {expected.map(({ student, age, sessions }) => (
                <div
                  key={student.id}
                  className="rounded-xl border border-primary/20 bg-primary-50/40 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-lg leading-none">🎂</span>
                    <strong className="text-xs text-ink">{studentName(student)}</strong>
                    {age !== null && <Badge tone="primary">{age} ans</Badge>}
                    {student.phone && (
                      <span className="font-mono text-[10px] text-muted">📞 {student.phone}</span>
                    )}
                    <Badge tone="success" className="ms-auto">
                      {sessions.length} séance(s) aujourd&apos;hui
                    </Badge>
                  </div>

                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sessions.map((s) => (
                      <span
                        key={s.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1 text-[10px] text-muted"
                      >
                        <strong className="font-mono text-primary">
                          {s.startTime}-{s.endTime}
                        </strong>
                        <span className="text-ink">{sessionTitle(s)}</span>
                        {salleLabel(s) && <span>· {salleLabel(s)}</span>}
                        {teacherName(s.teacherId) && <span>· {teacherName(s.teacherId)}</span>}
                      </span>
                    ))}
                  </div>
                </div>
              ))}

              {away.length > 0 && (
                <div className="rounded-xl border border-dashed border-line p-3">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Anniversaire aujourd&apos;hui, mais aucune séance programmée
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {away.map(({ student, age }) => (
                      <span
                        key={student.id}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-canvas/40 px-2 py-1 text-[10px] text-ink"
                      >
                        🎈 {studentName(student)}
                        {age !== null && <span className="text-muted">· {age} ans</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ---- Les 30 prochains jours ----------------------------------------- */}
      <Card className="border border-line card-shadow">
        <CardBody className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
            <h3 className="flex items-center gap-2 font-bold text-ink">
              <CalendarHeart className="h-4.5 w-4.5 text-primary" /> Les 30 prochains jours
            </h3>
            <Badge tone={upcoming.length > 0 ? "primary" : "neutral"}>{upcoming.length}</Badge>
          </div>

          {upcoming.length === 0 ? (
            <p className="py-8 text-center text-xs italic text-muted">
              Aucun anniversaire dans les 30 jours qui viennent.
            </p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto pe-1">
              {upcoming.map((b) => (
                <div
                  key={b.student.id}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-canvas/30 p-2.5 text-xs"
                >
                  <span className="w-32 shrink-0 font-mono text-[11px] font-bold text-primary">
                    {shortDateFr(b.date)}
                  </span>
                  <strong className="text-ink">{studentName(b.student)}</strong>
                  {b.age !== null && <span className="text-[10px] text-muted">{b.age} ans</span>}
                  <span className="ms-auto text-[10px] font-semibold text-muted">
                    {inDaysLabel(b.inDays)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      {/* ---- L'annuaire, mois par mois -------------------------------------- */}
      <Card className="border border-line card-shadow">
        <CardBody className="space-y-4 p-5">
          <div className="flex flex-wrap items-center gap-2 border-b border-line pb-3">
            <h3 className="font-bold text-ink">Annuaire des anniversaires</h3>
            <Badge tone="neutral">{directory.length} élève(s)</Badge>

            <div className="ms-auto flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted ltr:left-2.5 rtl:right-2.5" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Rechercher un élève"
                  className="h-8 rounded-lg border border-line bg-surface text-xs text-ink outline-none focus:border-primary ltr:pl-8 ltr:pr-2.5 rtl:pr-8 rtl:pl-2.5"
                />
              </div>
              <select
                value={month}
                onChange={(e) => setMonth(e.target.value)}
                className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-ink outline-none focus:border-primary"
              >
                <option value="">Tous les mois</option>
                {MONTHS_FR.map((label, i) => (
                  <option key={label} value={String(i + 1).padStart(2, "0")}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {directory.length === 0 ? (
            <p className="py-8 text-center text-xs italic text-muted">
              Aucun élève ne correspond à cette recherche.
            </p>
          ) : (
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-canvas/50 text-[10px] uppercase tracking-wider text-muted">
                    <th className="border-b border-line p-2 text-start font-bold">Élève</th>
                    <th className="border-b border-line p-2 text-start font-bold">Naissance</th>
                    <th className="border-b border-line p-2 text-start font-bold">Jour fêté</th>
                    <th className="border-b border-line p-2 text-start font-bold">Téléphone</th>
                  </tr>
                </thead>
                <tbody>
                  {directory.map(({ student }) => {
                    const isToday = isBirthdayOn(student.birthDate, date);
                    // Le jour RÉELLEMENT fêté cette année : un 29 février se lit
                    // « 28 février » les trois années où il n'existe pas.
                    const celebrated = birthdayIsoIn(student.birthDate, Number(date.slice(0, 4)));
                    return (
                      <tr key={student.id} className={isToday ? "bg-primary-50/50" : ""}>
                        <td className="border-b border-line p-2">
                          <strong className="text-ink">
                            {isToday && <span className="me-1">🎂</span>}
                            {studentName(student)}
                          </strong>
                        </td>
                        <td className="border-b border-line p-2 font-mono text-muted">
                          {student.birthDate}
                        </td>
                        <td className="border-b border-line p-2 text-muted">
                          {celebrated ? shortDateFr(celebrated) : "—"}
                        </td>
                        <td className="border-b border-line p-2 font-mono text-muted">
                          {student.phone || "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {missingBirthDate.length > 0 && (
            <p className="text-[10px] text-warning">
              ⚠ {missingBirthDate.length} fiche(s) élève n&apos;ont pas de date de naissance : leur
              anniversaire ne sera jamais signalé tant que la case reste vide.
            </p>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
