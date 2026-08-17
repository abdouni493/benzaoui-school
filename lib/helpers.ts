import type { Database } from "@/lib/store/data";
import { DAYS } from "@/lib/types";
import type {
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
export function todayIso(): string {
  return new Date().toLocaleDateString("fr-CA"); // YYYY-MM-DD
}

/** Add N months to a YYYY-MM-DD date, clamped to the last day of the target month. */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const target = new Date(y, m - 1 + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d, lastDay));
  return target.toLocaleDateString("fr-CA");
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
