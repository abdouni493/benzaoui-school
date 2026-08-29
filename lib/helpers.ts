import type { Database } from "@/lib/store/data";
import { DAYS } from "@/lib/types";
import type { AttendanceOpenMode } from "@/lib/types";
import type {
  AttendanceRecord,
  CoursLevel,
  Day,
  RegistrationFeeKey,
  ScheduleSession,
  School,
  SchoolClass,
  Student,
  Subscription,
  SubscriptionDiscount,
} from "@/lib/types";

/** French weekday labels — shared by every screen that prints a timing. */
export const DAY_LABELS_FR: Record<Day, string> = {
  saturday: "Samedi",
  sunday: "Dimanche",
  monday: "Lundi",
  tuesday: "Mardi",
  wednesday: "Mercredi",
  thursday: "Jeudi",
  friday: "Vendredi",
};

/** "Samedi, Lundi" — always in the school's week order, never the click order. */
export function formatDays(days: Day[] = []): string {
  return DAYS.filter((d) => days.includes(d))
    .map((d) => DAY_LABELS_FR[d])
    .join(", ");
}

export const teacherName = (db: Database, id: string) => {
  const t = db.teachers.find((x) => x.id === id);
  return t ? `${t.firstName} ${t.lastName}` : "—";
};
export const moduleName = (db: Database, id: string) =>
  db.modules.find((m) => m.id === id)?.name ?? "—";
export const groupName = (db: Database, id: string) =>
  db.groups.find((g) => g.id === id)?.name ?? "—";
export const salleName = (db: Database, id: string) =>
  db.salles.find((s) => s.id === id)?.name ?? "—";
export const filiereName = (db: Database, id?: string) =>
  id ? db.filieres.find((f) => f.id === id)?.name ?? "" : "";

export const studentName = (s: Student) => `${s.firstName} ${s.lastName}`;

// ---- Pourquoi une présence n'a-t-elle rien coûté ? ---------------------------

/** Les cinq raisons pour lesquelles une présence est enregistrée à 0 DA.
 *  `null` = elle a bien été facturée. */
export type FreeReason =
  /** une période gratuite couvrait la classe ce jour-là */
  | "freePeriod"
  /** la date de début de facturation de l'inscription n'était pas atteinte */
  | "preStart"
  /** le créneau lui-même est coché « séance libre offerte » */
  | "freeSeance"
  /** l'élève est marqué gratuit sur sa fiche */
  | "freeStudent"
  /** le tarif du créneau est réellement à 0 DA */
  | "zeroPrice"
  | null;

/**
 * Pourquoi cette présence n'a rien débité.
 *
 * Trois réglages mettent une séance à 0 DA, et deux d'entre eux se
 * reconnaissent à une colonne dédiée (`freePeriodId`, `preStart`). Le
 * troisième — un créneau coché « séance libre offerte » — n'en a aucune : il
 * ne laisse que le prix non facturé dans `waivedAmount`. Une présence de ce
 * type s'affichait donc « -0 DA » en rouge, comme si la facturation avait
 * échoué, alors qu'elle avait été offerte volontairement.
 */
export function freeReasonOf(
  att: Pick<AttendanceRecord, "amountDeducted" | "freePeriodId" | "preStart" | "waivedAmount">,
  opts: { studentIsFree?: boolean } = {},
): FreeReason {
  if (att.amountDeducted > 0) return null;
  if (att.freePeriodId) return "freePeriod";
  if (att.preStart) return "preStart";
  // Aucune colonne dédiée : c'est le prix mis de côté qui trahit la gratuité.
  if ((att.waivedAmount ?? 0) > 0) return "freeSeance";
  if (opts.studentIsFree) return "freeStudent";
  return "zeroPrice";
}

/** Libellé court, tel qu'il tient dans une ligne d'historique. */
export const FREE_REASON_LABELS: Record<NonNullable<FreeReason>, string> = {
  freePeriod: "période gratuite",
  preStart: "avant le début",
  freeSeance: "créneau offert",
  freeStudent: "élève gratuit",
  zeroPrice: "tarif à 0",
};

/** La même chose en une phrase, pour l'infobulle. */
export const FREE_REASON_HINTS: Record<NonNullable<FreeReason>, string> = {
  freePeriod: "Séance offerte : une période gratuite couvrait cette classe ce jour-là.",
  preStart:
    "Séance offerte : la date de début de facturation de l'inscription n'était pas encore atteinte.",
  freeSeance:
    "Séance offerte : le créneau est coché « séance libre offerte » — ni débit élève, ni rémunération enseignant.",
  freeStudent: "Séance offerte : l'élève est marqué gratuit sur sa fiche.",
  zeroPrice: "Rien à débiter : le tarif de ce créneau est de 0 DA.",
};

// ---- Ordre d'affichage des fiches --------------------------------------------

/** Date d'inscription en millisecondes.
 *
 *  Une fiche sans date exploitable — base antérieure à la colonne `created_at`,
 *  ou ligne tout juste écrite dont la base n'a pas encore été relue — compte
 *  comme la PLUS RÉCENTE : c'est toujours celle qu'on vient d'enregistrer,
 *  jamais une archive. */
export function createdAtMs(item: { createdAt?: string }): number {
  const t = item.createdAt ? Date.parse(item.createdAt) : NaN;
  return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
}

/**
 * Comparateur « du plus récemment créé au plus ancien ».
 *
 * La réception ouvre la liste des élèves juste après avoir enregistré une
 * fiche : la voir en tête est le seul ordre utile. Sans tri, les lignes
 * sortaient dans l'ordre rendu par Postgres et la nouvelle atterrissait en
 * dernier, hors de l'écran dès que la promotion dépasse quelques dizaines.
 */
export function byNewestFirst(a: { createdAt?: string }, b: { createdAt?: string }): number {
  const at = createdAtMs(a);
  const bt = createdAtMs(b);
  // Dates égales, ou deux dates inconnues : renvoyer `bt - at` vaudrait NaN
  // entre deux infinis, et le tri deviendrait incohérent d'un moteur à l'autre.
  return at === bt ? 0 : bt - at;
}

export function classLabel(db: Database, cls: SchoolClass): string {
  if (cls.type === "formation") return `${cls.name} (${cls.formationLevel})`;
  const fil = filiereName(db, cls.filiereId);
  return [cls.name, fil].filter(Boolean).join(" · ");
}

export function classOf(db: Database, id: string): SchoolClass | undefined {
  return db.classes.find((c) => c.id === id);
}

// ---- Niveau / année / filière ------------------------------------------------
/** Niveaux scolaires, dans l'ordre où la scolarité se déroule. */
export const COURS_LEVELS: CoursLevel[] = ["primaire", "moyen", "lycee"];
export const COURS_LEVEL_LABELS: Record<CoursLevel, string> = {
  primaire: "Primaire",
  moyen: "Moyen",
  lycee: "Lycée",
};
/** Années, dans l'ordre — les classes n'en stockent que le libellé brut. */
export const YEAR_ORDER = ["1er", "2eme", "3eme", "4eme", "5eme"];

/**
 * How a class is spoken about at the desk: "Lycée · 2eme Année · Sciences".
 * Formations have neither année nor filière, so they show their level instead.
 * `filiereName` is passed in (empty when the class carries none) so this stays
 * a pure function of the class itself.
 */
export function classCascadeLabel(cls: SchoolClass, filiereName = ""): string {
  if (cls.type === "formation") {
    return ["Formation", cls.formationLevel, cls.name].filter(Boolean).join(" · ");
  }
  return [
    cls.coursLevel ? COURS_LEVEL_LABELS[cls.coursLevel] : "",
    cls.year ? `${cls.year} Année` : "",
    filiereName,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Accent- and case-insensitive text, so "lycee" matches "Lycée". NFD splits an
 *  accented letter into letter + combining mark, and the marks (U+0300 to
 *  U+036F) are then dropped. */
export function normalizeSearchText(value: string): string {
  return [...value.normalize("NFD")]
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code < 0x0300 || code > 0x036f;
    })
    .join("")
    .toLowerCase();
}

/**
 * Every word of the query must appear somewhere in `text`, in any order and
 * ignoring accents — so "2eme lycee sciences" finds "Lycée · 2eme Année ·
 * Sciences" just as well as "lycee 2eme sciences" does. An empty query matches
 * everything.
 */
export function matchesAllWords(text: string, query: string): boolean {
  const words = normalizeSearchText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeSearchText(text);
  return words.every((word) => haystack.includes(word));
}

/** Identity of a "cours": one class + one module + one teacher, taught to
 *  several groups. Every group of a cours shares ONE tariff, and a student
 *  enrolled in any of them may attend any other (rattrapage). A séance libre
 *  timing is a product on its own, so it never merges with anything. */
export function courseKeyOf(session: ScheduleSession): string {
  return session.isOpen
    ? `open-${session.id}`
    : `${session.classId}|${session.moduleId}|${session.teacherId}`;
}

/** Every timing of the same cours (i.e. all its groups), week-order sorted. */
export function siblingSessions(db: Database, session: ScheduleSession): ScheduleSession[] {
  const key = courseKeyOf(session);
  return db.sessions.filter((s) => courseKeyOf(s) === key);
}

/** Full session label. `withGroup=false` drops the group (used by the
 *  Subscriptions listing where one label covers multiple groups). */
export function sessionLabel(
  db: Database,
  session: ScheduleSession,
  opts: { withGroup?: boolean } = {},
): string {
  const cls = classOf(db, session.classId);
  const parts = [
    cls ? classLabel(db, cls) : "",
    moduleName(db, session.moduleId),
    opts.withGroup === false ? "" : groupName(db, session.groupId),
    salleName(db, session.salleId),
    teacherName(db, session.teacherId),
  ].filter(Boolean);
  return parts.join(" · ");
}

export function subscriptionPrice(db: Database, sub: Subscription): number {
  return sub.pricePerSession;
}

// ---- Per-module reductions ----
/**
 * Price actually charged once the student's reduction on that module is
 * applied. Mirrors the `public.discounted_price()` SQL function 1:1 — the scan,
 * the manual présence and the weekly-absence billing all use the SQL one, so
 * this must stay in sync or the UI would advertise a price the server doesn't
 * charge. Never returns a negative price.
 */
export function netPriceFor(basePrice: number, discount?: SubscriptionDiscount): number {
  const price = Math.max(0, Math.round(basePrice || 0));
  if (!discount || discount.value <= 0) return price;
  const cut =
    discount.type === "percent"
      ? Math.round((price * Math.min(Math.max(discount.value, 0), 100)) / 100)
      : Math.max(discount.value, 0);
  return Math.max(0, price - cut);
}

// ---- Frais d'inscription -----------------------------------------------------
// The school charges at most two kinds of inscription. Both are optional: a
// tariff left at 0 simply isn't offered when a student is created.

/** Shown when the school never named its tariffs. */
export const REGISTRATION_FEE_LABELS: Record<RegistrationFeeKey, string> = {
  fee1: "Inscription 1",
  fee2: "Inscription 2",
};

export interface RegistrationFeeOption {
  key: RegistrationFeeKey;
  label: string;
  amount: number;
}

/** Both tariffs, named and rounded — including the ones left at 0. */
function allRegistrationFees(school?: Partial<School>): RegistrationFeeOption[] {
  return [
    {
      key: "fee1" as const,
      label: (school?.registrationFeeLabel || "").trim() || REGISTRATION_FEE_LABELS.fee1,
      amount: Math.max(0, Math.round(school?.registrationFee || 0)),
    },
    {
      key: "fee2" as const,
      label: (school?.registrationFee2Label || "").trim() || REGISTRATION_FEE_LABELS.fee2,
      amount: Math.max(0, Math.round(school?.registrationFee2 || 0)),
    },
  ];
}

/** Only the tariffs the school actually charges — what the création screen
 *  offers. Empty means "cette école ne facture aucune inscription". */
export function registrationFeeOptions(school?: Partial<School>): RegistrationFeeOption[] {
  return allRegistrationFees(school).filter((o) => o.amount > 0);
}

/** Ce que le guichet encaisse réellement, et ce que devient le solde. */
export interface DeskPayment {
  /** Montant encaissé en caisse — la ligne « Versement / Recharge ». */
  cashed: number;
  /** Variation du solde de l'élève une fois les frais déduits. */
  balanceDelta: number;
}

/**
 * Un écran qui prend un versement ET règle l'inscription en une fois (création
 * d'un élève, modification de sa fiche) : les frais réglés sont TOUJOURS pris
 * sur le versement, donc seul ce que le guichet reçoit vraiment part en caisse.
 *  - versement 5000, frais 3000 réglés → 5000 encaissés, solde +2000
 *  - versement 0, frais 3000 réglés    → 3000 encaissés, solde inchangé
 *  - versement 5000, frais non réglés  → 5000 encaissés, solde +5000
 */
export function deskPaymentFor(topup: number, fee: number, settleNow: boolean): DeskPayment {
  const paid = Math.max(0, Math.round(topup || 0));
  const due = settleNow ? Math.max(0, Math.round(fee || 0)) : 0;
  // Sans versement, les frais sont encaissés seuls : le solde ne bouge pas.
  const cashed = paid > 0 ? paid : due;
  return { cashed, balanceDelta: cashed - due };
}

/** Human label for a reduction, e.g. "-20%" or "-500 DA". Empty when none. */
export function discountLabel(discount?: SubscriptionDiscount): string {
  if (!discount || discount.value <= 0) return "";
  return discount.type === "percent" ? `-${discount.value}%` : `-${discount.value} DA`;
}

/** Net price of one séance for a given student on a given subscription. */
export function studentSeancePrice(student: Student, sub: Subscription): number {
  return netPriceFor(sub.pricePerSession, student.subscriptionDiscounts?.[sub.id]);
}

export function subscriptionLabel(db: Database, sub: Subscription): string {
  const session = db.sessions.find((s) => s.id === sub.sessionId);
  return session ? sessionLabel(db, session, { withGroup: false }) : "—";
}

/** Modules a student is enrolled in (via their subscriptions). */
export function studentModules(db: Database, student: Student): string[] {
  return student.subscriptionIds
    .map((sid) => db.subscriptions.find((s) => s.id === sid))
    .filter(Boolean)
    .map((sub) => {
      const session = db.sessions.find((s) => s.id === sub!.sessionId);
      return session ? moduleName(db, session.moduleId) : "";
    })
    .filter(Boolean);
}

export type BalanceStatus = "positive" | "low" | "debt";
export function balanceStatus(student: Student): BalanceStatus {
  if (student.balance < 0) return "debt";
  if (student.balance < 1000) return "low";
  return "positive";
}

export function enrolledCount(db: Database, classId: string): number {
  const sessionIds = db.sessions
    .filter((s) => s.classId === classId)
    .map((s) => s.id);
  const subIds = new Set(
    db.subscriptions.filter((s) => sessionIds.includes(s.sessionId)).map((s) => s.id),
  );
  return db.students.filter((st) =>
    st.subscriptionIds.some((id) => subIds.has(id)),
  ).length;
}

export function sessionEnrolledStudents(db: Database, sessionId: string): Student[] {
  const subIds = db.subscriptions
    .filter((s) => s.sessionId === sessionId)
    .map((s) => s.id);
  return db.students.filter((st) =>
    st.subscriptionIds.some((id) => subIds.includes(id)),
  );
}

// ---- Formation dates ----
// ---- Ouverture de la feuille de pointage -------------------------------------
// Le pointage manuel d'une séance n'est pas ouvert en permanence : il s'ouvre à
// l'heure décidée par l'école, ou sur un clic de la réception. Les règles sont
// ici, pures et testées, pour que l'écran Présence n'ait plus qu'à les appeler.

/** "HH:mm" → minutes depuis minuit (0 si la valeur est illisible). */
export function timeToMinutes(time: string): number {
  const [h, m] = (time || "").split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
}

/** Minutes depuis minuit → "HH:mm", borné à la journée. */
export function minutesToTime(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutes || 0)));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** La politique choisie par l'école, telle qu'elle est réglée sur l'écran. */
export interface RollCallPolicy {
  mode: AttendanceOpenMode;
  /** Mode "lead" : minutes d'avance sur le début de la séance (0 = à l'heure). */
  leadMinutes: number;
  /** Mode "fixed" : heure "HH:mm", la même pour toutes les séances du jour. */
  fixedTime: string;
}

/**
 * Heure à laquelle le pointage de cette séance s'ouvre TOUT SEUL — ou `null`
 * en mode manuel, où rien ne s'ouvre sans un clic.
 */
export function rollCallOpensAt(sessionStart: string, policy: RollCallPolicy): string | null {
  if (policy.mode === "manual") return null;
  if (policy.mode === "fixed") return policy.fixedTime || "00:00";
  return minutesToTime(timeToMinutes(sessionStart) - (policy.leadMinutes || 0));
}

/**
 * Cette séance accepte-t-elle un pointage maintenant ?
 *
 * Une journée à venir est toujours fermée (on ne pointe pas d'avance) et une
 * journée passée toujours ouverte : c'est là que la réception corrige les
 * oublis, le verrou n'ayant de sens que sur la journée en cours. Un clic sur
 * « Démarrer le pointage » ouvre la feuille quel que soit le mode.
 */
export function isRollCallOpen(args: {
  /** jour affiché par la feuille, "YYYY-MM-DD" */
  sheetDate: string;
  /** aujourd'hui, "YYYY-MM-DD" en heure locale */
  today: string;
  /** heure de début de la séance, "HH:mm" */
  sessionStart: string;
  /** minutes écoulées depuis minuit */
  nowMinutes: number;
  /** la réception a démarré CETTE séance ce jour-là */
  startedManually: boolean;
  policy: RollCallPolicy;
}): boolean {
  if (args.sheetDate > args.today) return false;
  if (args.sheetDate < args.today) return true;
  if (args.startedManually) return true;
  const opensAt = rollCallOpensAt(args.sessionStart, args.policy);
  if (opensAt === null) return false;
  return args.nowMinutes >= timeToMinutes(opensAt);
}

// ---- Emploi du temps : colonnes horaires -------------------------------------
// Une journée n'a pas d'horaires fixes : chaque école pose ses créneaux où elle
// veut (08:00-09:00, 09:00-11:00…). Les colonnes d'un tableau d'emploi du temps
// sont donc DÉDUITES des séances du jour : on prend toutes les bornes (débuts et
// fins), on les trie, et chaque paire consécutive devient une colonne. Une
// séance couvre alors un nombre exact de colonnes (colSpan), et les trous entre
// deux cours restent visibles.

export interface TimeRange {
  startTime: string;
  endTime: string;
}

export interface TimeSlot {
  start: string;
  end: string;
}

/** Colonnes horaires d'une journée, dans l'ordre. Vide s'il n'y a rien à poser. */
export function scheduleSlots(ranges: TimeRange[]): TimeSlot[] {
  const bounds = new Set<number>();
  for (const r of ranges) {
    const from = timeToMinutes(r.startTime);
    const to = timeToMinutes(r.endTime);
    if (to <= from) continue; // horaire inutilisable : ignoré, jamais affiché
    bounds.add(from);
    bounds.add(to);
  }
  const sorted = [...bounds].sort((a, b) => a - b);
  const slots: TimeSlot[] = [];
  for (let i = 0; i < sorted.length - 1; i += 1) {
    slots.push({ start: minutesToTime(sorted[i]), end: minutesToTime(sorted[i + 1]) });
  }
  return slots;
}

/** Première colonne occupée par une séance et nombre de colonnes couvertes,
 *  ou `null` quand elle n'en touche aucune. */
export function slotSpan(range: TimeRange, slots: TimeSlot[]): { index: number; span: number } | null {
  const from = timeToMinutes(range.startTime);
  const to = timeToMinutes(range.endTime);
  if (to <= from) return null;
  let index = -1;
  let span = 0;
  slots.forEach((slot, i) => {
    if (timeToMinutes(slot.start) >= from && timeToMinutes(slot.end) <= to) {
      if (index === -1) index = i;
      span += 1;
    }
  });
  return index === -1 ? null : { index, span };
}

/** Une cellule d'une ligne d'emploi du temps : du temps libre, ou une séance
 *  qui occupe `span` colonnes. */
export type RowCell<T> = { kind: "free" } | { kind: "item"; item: T; span: number };

/**
 * Découpe une ligne du tableau, de gauche à droite : les colonnes vides, puis
 * chaque séance sur exactement les colonnes qu'elle couvre.
 *
 * Une séance qui chevauche celle déjà posée est ÉCARTÉE : une salle ne peut pas
 * être occupée deux fois sur la même colonne, et un tableau HTML dont les
 * colSpan se recouvrent se décale sur toute la ligne.
 */
export function layoutRow<T>(
  placed: { item: T; index: number; span: number }[],
  slotCount: number,
): RowCell<T>[] {
  const cells: RowCell<T>[] = [];
  let cursor = 0;
  for (const { item, index, span } of [...placed].sort((a, b) => a.index - b.index)) {
    if (index < cursor || span <= 0) continue;
    for (let i = cursor; i < index; i += 1) cells.push({ kind: "free" });
    const clamped = Math.min(span, slotCount - index);
    if (clamped <= 0) continue;
    cells.push({ kind: "item", item, span: clamped });
    cursor = index + clamped;
  }
  for (let i = cursor; i < slotCount; i += 1) cells.push({ kind: "free" });
  return cells;
}

/** Les salles d'un créneau : une séance libre peut en couvrir plusieurs. */
export function sessionSalleIds(session: Pick<ScheduleSession, "isOpen" | "salleId" | "salleIds">): string[] {
  const ids = session.isOpen && session.salleIds?.length ? session.salleIds : [session.salleId];
  return ids.filter(Boolean) as string[];
}

/**
 * Créneaux DÉJÀ posés qui entrent en collision avec celui qu'on est en train de
 * créer : même salle, un jour en commun, et la même heure de début. Sert à
 * prévenir la réception — sans jamais l'empêcher d'enregistrer, une école
 * pouvant volontairement doubler une salle.
 */
export function salleStartClashes(
  sessions: ScheduleSession[],
  candidate: { id?: string; salleIds: string[]; days: Day[]; startTime: string },
): ScheduleSession[] {
  const salles = new Set(candidate.salleIds.filter(Boolean));
  const days = new Set(candidate.days);
  if (salles.size === 0 || days.size === 0) return [];
  return sessions.filter((s) => {
    if (candidate.id && s.id === candidate.id) return false;
    if (s.startTime !== candidate.startTime) return false;
    if (!s.days.some((d) => days.has(d))) return false;
    return sessionSalleIds(s).some((id) => salles.has(id));
  });
}

export function todayIso(): string {
  return new Date().toLocaleDateString("fr-CA"); // YYYY-MM-DD
}

/**
 * Une séance libre est « expirée » quand sa période de dates est entièrement
 * écoulée : sa `periodEnd` est antérieure à aujourd'hui. Un cours ordinaire n'a
 * pas de période — il n'expire jamais. Le dernier jour de la période compte
 * encore comme actif, aligné sur le guichet et le pointage (une séance tenue le
 * jour même de `periodEnd` reste encaissable).
 */
export function isExpiredOpenSeance(
  session: Pick<ScheduleSession, "isOpen" | "periodEnd">,
  today: string = todayIso(),
): boolean {
  return Boolean(session.isOpen && session.periodEnd && session.periodEnd < today);
}

/**
 * Les créneaux à AFFICHER sur un emploi du temps : tous les cours, plus les
 * séances libres encore dans leur période. Une séance libre dont la période est
 * terminée disparaît de tous les emplois du temps — inutile de la reproposer,
 * son public n'existe plus. Sa gestion (modifier / supprimer) reste possible
 * depuis le Planner, qui garde un filtre dédié pour la retrouver.
 */
export function visibleTimetableSessions<
  T extends Pick<ScheduleSession, "isOpen" | "periodEnd">,
>(sessions: T[], today: string = todayIso()): T[] {
  return sessions.filter((s) => !isExpiredOpenSeance(s, today));
}

/** Add N months to a YYYY-MM-DD date, clamped to the last day of the target month. */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return target.toLocaleDateString("fr-CA");
}

/**
 * End date of an enrollment, or `undefined` when it never expires.
 *
 * Only a formation that declares a real duration gets one. A duration of 0 (or
 * none at all) used to produce `addMonths(start, 0)` — an expiry landing on the
 * very start date, i.e. an inscription born expired, whose card was refused
 * with « abonnement expiré » from the next day on. No duration now means no
 * expiry at all, which is what an open-ended cours enrollment is.
 */
export function enrollmentExpiry(startDate: string, periodMonths?: number): string | undefined {
  const months = Math.floor(periodMonths ?? 0);
  if (!startDate || months <= 0) return undefined;
  return addMonths(startDate, months);
}

/** Whole days from today (local) until a YYYY-MM-DD date. Negative = already past. */
export function daysUntil(dateStr: string): number {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - today) / 86400000);
}

export function formatDateFr(dateStr?: string): string {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

export const EXPIRY_WARNING_DAYS = 7;
export type FormationExpiryStatus = "active" | "expiring" | "expired";
export function formationExpiryStatus(expiryDate: string): FormationExpiryStatus {
  const days = daysUntil(expiryDate);
  if (days < 0) return "expired";
  if (days <= EXPIRY_WARNING_DAYS) return "expiring";
  return "active";
}

// ---- Teacher dues ----
export function teacherUnpaidSessions(db: Database, teacherId: string) {
  return db.unpaidTeacher.filter((u) => u.teacherId === teacherId && !u.paid);
}
export function teacherUnpaidTotal(db: Database, teacherId: string): number {
  return teacherUnpaidSessions(db, teacherId).reduce((s, u) => s + u.amount, 0);
}

// ---- Money ----
export function subscriptionRevenue(db: Database, sub: Subscription): number {
  return db.attendance
    .filter((a) => a.sessionId === sub.sessionId)
    .reduce((s, a) => s + a.amountDeducted, 0);
}

export function cashBalance(db: Database, from?: Date, to?: Date): number {
  return db.cash
    .filter((c) => {
      const d = new Date(c.date);
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    })
    .reduce((s, c) => s + c.amount, 0);
}

export function totalDebt(db: Database): number {
  return db.students
    .filter((s) => s.balance < 0)
    .reduce((s, st) => s + st.balance, 0);
}

export function totalRevenue(db: Database): number {
  return db.cash
    .filter((c) => c.type === "student_payment")
    .reduce((s, c) => s + c.amount, 0);
}

export function totalExpenses(db: Database): number {
  return db.expenses.reduce((s, e) => s + e.amount, 0);
}
