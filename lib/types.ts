import type { Role } from "@/lib/store/session";

export type { Role };

export type Day =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export const DAYS: Day[] = [
  "saturday",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
];

export interface School {
  id: string;
  name: string;
  description: string;
  phone: string;
  email: string;
  logo?: string;
  address: string;
  articleFiscal?: string;
  registreCommerce?: string;
  nif?: string;
  nis?: string;
  /** one-time registration fee charged once per student on first enrollment */
  registrationFee?: number;
  /** how that first tariff is called at the desk ("Inscription 1" by default) */
  registrationFeeLabel?: string;
  /** a SECOND registration tariff: schools that charge two kinds of inscription
   *  (annuelle / semestrielle, interne / externe…) pick one of the two when the
   *  student is created */
  registrationFee2?: number;
  registrationFee2Label?: string;
  /** master switch for the automatic weekly-absence billing */
  absencePenaltyEnabled?: boolean;
  /** floor date (YYYY-MM-DD): absences are only billed for weeks ending on/after
   *  this day, so enabling the feature never retro-bills old history */
  absencePenaltySince?: string;
  /** weekday the absence week opens on (0 = sunday … 5 = friday, the default):
   *  a week runs from that day to the same day of the next week */
  absenceWeekStartDay?: number;
}

/** Which of the school's two registration tariffs a student is charged.
 *  "none" = this student pays no inscription at all. */
export type RegistrationFeeKey = "fee1" | "fee2";

export type ClassType = "cours" | "formation";
export type CoursLevel = "primaire" | "moyen" | "lycee";
export type FormationLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface SchoolClass {
  id: string;
  type: ClassType;
  name: string;
  description: string;
  // cours
  coursLevel?: CoursLevel;
  year?: string;
  filiereId?: string;
  // formation
  formationLevel?: FormationLevel;
}

export interface Filiere {
  id: string;
  name: string;
}
export interface Module {
  id: string;
  name: string;
}
export interface Group {
  id: string;
  name: string;
}
export interface Salle {
  id: string;
  name: string;
}

export type TeacherPaymentType = "monthly" | "percentage";
export interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  paymentType: TeacherPaymentType;
  monthlyAmount?: number;
  startDate?: string;
  percentage?: number;
  /** "enseignant passager": intervenant sans compte de connexion, réglé
   *  créneau par créneau depuis la fiche enseignant */
  isPassager?: boolean;
}

/** One settlement written for a teacher (fixed amount or percentage-based). */
export interface TeacherPayment {
  id: string;
  teacherId: string;
  amount: number;
  method: "fixed" | "percent";
  percentage?: number;
  studentsCount: number;
  sessionsCount: number;
  description: string;
  /** frozen snapshot of the settled timings, so the receipt can be reprinted */
  details: TeacherPaymentDetail[];
  paidAt: string;
}

export interface TeacherPaymentDetail {
  dateKey: string;
  sessionId: string;
  title: string;
  moduleName: string;
  groupName: string;
  startTime: string;
  endTime: string;
  presents: number;
  passagers: number;
  gross: number;
  share: number;
}

export type ReceptionPaymentType = "daily" | "monthly" | "half_day" | "hourly";
/** Réception / Agent de sécurité / Ménage — Ménage never gets a login. */
export type WorkerRole = "reception" | "security" | "menage";
export interface ReceptionStaff {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  paymentType: ReceptionPaymentType;
  startDate: string;
  salary: number;
  role?: WorkerRole;
  /** badge used by the worker check-in scanner */
  rfid?: string;
  /** paymentType === "hourly": price of one worked hour */
  hourlyRate?: number;
}

/** One worked day of an hourly worker (clock-in / clock-out). */
export interface WorkerShift {
  id: string;
  workerId: string;
  workDate: string; // YYYY-MM-DD
  startAt?: string;
  endAt?: string;
  minutes: number;
  /** the day ended without a clock-out: hours frozen until reception fixes it */
  frozen: boolean;
  paid: boolean;
  paymentId?: string;
  createdAt: string;
}

export interface ScheduleSession {
  id: string;
  classId: string;
  moduleId: string;
  groupId: string;
  salleId: string;
  teacherId: string;
  days: Day[];
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  /** "séance libre" timing: several classes/groups/salles over a date period */
  isOpen?: boolean;
  /** explicit, readable name — only set for séance libre timings */
  title?: string;
  periodStart?: string;
  periodEnd?: string;
  classIds?: string[];
  groupIds?: string[];
  salleIds?: string[];
  /** price of one séance libre (mirrored into the auto-created subscription) */
  openPrice?: number;
  /**
   * "Séance libre offerte": the whole créneau is free. Every présence recorded
   * on it is offered — the student's balance is never debited, the school cashes
   * nothing, and the teacher earns no share. What each séance WOULD have cost
   * (`openPrice`) is what the reports price as the value the school gave away.
   * Only meaningful when `isOpen` is true.
   */
  isFree?: boolean;
}

export interface Subscription {
  id: string;
  /** the schedule this subscription is priced against */
  sessionId: string;
  pricePerSession: number;
  /** formation classes: fixed price for the whole level (pricePerSession stays 0) */
  levelPrice?: number;
  /** formation classes: duration in months, drives the per-student expiry date */
  periodMonths?: number;
}

/**
 * Per-student enrollment dates (YYYY-MM-DD), kept for EVERY enrollment —
 * cours and formations alike:
 *  - `subscribedAt`: the day reception registered the student on that module
 *    (purely informative, it never drives a price),
 *  - `startDate`: the day billing starts. A séance attended BEFORE it is
 *    recorded as usual but never charged (see `AttendanceRecord.preStart`),
 *  - `expiryDate`: end of the enrollment — only formations get one, derived
 *    from the level's duration. Past it, the card is refused.
 */
export interface SubscriptionDates {
  subscribedAt?: string;
  startDate?: string;
  expiryDate?: string;
}

/** Reduction granted to ONE student on ONE module, applied by every price
 *  calculation (scan, manual présence, weekly absence billing). */
export type DiscountType = "percent" | "amount";
export interface SubscriptionDiscount {
  type: DiscountType;
  value: number;
}

/**
 * "Période gratuite": a date window during which attending is offered. The card
 * is scanned and the presence is written exactly as usual, but the séance price
 * is NEVER taken off the student's balance — it is stored on the presence
 * (`waivedAmount`) so the school can see what the period cost it.
 */
export interface FreePeriod {
  id: string;
  /** short label shown on the card, e.g. "Semaine portes ouvertes" */
  name: string;
  description: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  /** covers every class (the default); otherwise only `classIds` */
  allClasses: boolean;
  classIds: string[];
  /** teachers still earn their percentage on an offered séance */
  payTeachers: boolean;
  /** suspends the period without losing its history */
  active: boolean;
  createdAt?: string;
}

/** Server-side totals of one free period (never truncated by a row limit). */
export interface FreePeriodStat {
  id: string;
  /** presences recorded during the period */
  presences: number;
  /** distinct students who benefited from it */
  students: number;
  /** what those presences would have cost the students = cost of the period */
  waived: number;
}

/** Weekly-absence billing switch for a single module. */
export interface ModuleAbsenceRule {
  moduleId: string;
  enabled: boolean;
  /** length of the absence window in days (7 = the default weekly rule) */
  daysWindow: number;
}

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  phone: string;
  email: string;
  rfid: string;
  balance: number;
  isFree: boolean;
  parentId?: string;
  subscriptionIds: string[];
  /** formation enrollments: start/expiry per subscription id */
  subscriptionDates?: Record<string, SubscriptionDates>;
  /** per-module reduction, keyed by subscription id */
  subscriptionDiscounts?: Record<string, SubscriptionDiscount>;
  /** outstanding one-time registration cost not yet settled */
  registrationDue?: number;
}

/** Portal password kept so the payment receipt can print the student's login.
 *  Stored in a staff-only table — never readable by the student/parent. */
export interface StudentCredential {
  studentId: string;
  password: string;
  updatedAt: string;
}

export type BalanceTxType =
  | "topup"
  | "deduction"
  | "debt_payment"
  | "registration";
export interface BalanceTransaction {
  id: string;
  studentId: string;
  amount: number; // signed: + topup, - deduction
  date: string;
  type: BalanceTxType;
  description: string;
  /** module of the séance behind a deduction/refund — used by the per-module
   *  transactions filter in the student file (null for plain topups) */
  moduleId?: string;
}

/** One automatic weekly-absence charge: a module the student was absent on for
 *  a full 7-day window, billed at that module's séance price. Also mirrored as a
 *  `deduction` BalanceTransaction so it shows in every transaction list. */
export interface AbsencePenalty {
  id: string;
  studentId: string;
  subscriptionId?: string;
  sessionId?: string;
  moduleId?: string;
  /** first/last day of the absent 7-day window (YYYY-MM-DD) */
  periodStart: string;
  periodEnd: string;
  /** amount deducted (> 0) */
  amount: number;
  /** resulting balance (may be negative = debt) */
  balanceAfter: number;
  createdAt: string;
}

export type AttendanceStatus = "present" | "late" | "absent";
export interface AttendanceRecord {
  id: string;
  studentId: string;
  sessionId: string;
  timestamp: string;
  amountDeducted: number;
  status: AttendanceStatus;
  /** the student attended ANOTHER group of the same course (same class + module)
   *  than the one he is enrolled in — a "rattrapage" */
  substituteGroup?: boolean;
  /** the séance was offered by this free period (nothing was deducted) */
  freePeriodId?: string;
  /** the séance happened BEFORE the enrollment's start date: presence kept,
   *  balance untouched (the price sits in `waivedAmount`) */
  preStart?: boolean;
  /** the price that was NOT charged (free period or pre-start séance) — 0 on
   *  every ordinary presence */
  waivedAmount?: number;
}

export interface UnpaidTeacherSession {
  id: string;
  teacherId: string;
  sessionId: string;
  studentId: string;
  amount: number;
  date: string;
  paid: boolean;
}

export interface TeacherAcompte {
  id: string;
  teacherId: string;
  amount: number;
  description: string;
  date: string;
}
export interface TeacherAbsence {
  id: string;
  teacherId: string;
  cost: number;
  description: string;
  date: string;
}

export interface Subject {
  id: string;
  title: string;
  description: string;
  image?: string;
  sessionId: string;
  date: string;
}

export type Audience = "students" | "teachers" | "parents" | "all";
export interface Announcement {
  id: string;
  title: string;
  description: string;
  audience: Audience;
  endDate: string;
  date: string;
  /** empty = whole school; otherwise only these groups (and, when
   *  includeParents is on, the parents of their students) */
  targetGroupIds?: string[];
  includeParents?: boolean;
}

export interface ExpenseCategory {
  id: string;
  name: string;
}
export interface Expense {
  id: string;
  name: string;
  categoryId: string;
  amount: number;
  date: string;
}

export type CashTxType =
  | "deposit"
  | "withdraw"
  | "expense"
  | "student_payment"
  | "teacher_payment"
  | "acompte";
export interface CashTransaction {
  id: string;
  type: CashTxType;
  amount: number; // signed
  date: string;
  description: string;
}

export interface Parent {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  childIds: string[];
}

export interface Notification {
  id: string;
  parentId: string;
  title: string;
  description: string;
  date: string;
  read: boolean;
  auto: boolean;
}

export type CourseworkType = "single" | "period";
export interface Coursework {
  id: string;
  name: string;
  type: CourseworkType;
  dates: string[];
  pricePerSession: number;
  total: number;
  teacherId: string;
}

export interface IndependentSession {
  id: string;
  studentId?: string;
  passagerName?: string;
  itemLabel: string;
  price: number;
  date: string;
  /** séance libre timing this attendance belongs to (drives the teacher payout) */
  sessionId?: string;
  startTime?: string;
  endTime?: string;
  createdAt?: string;
  /** the teacher has already been settled for this passager's séance — a
   *  créneau attended only by passagers has no unpaid_teacher_sessions row */
  teacherPaid?: boolean;
  /**
   * "Séance offerte": the séance is held and recorded exactly as usual, but
   * NOBODY is paid on it — nothing is cashed by the school, nothing is taken
   * off a registered student's balance, and the teacher earns no share for it.
   * `price` is therefore 0; what the séance WOULD have cost sits in
   * `waivedAmount` so the reports can price what the school offered.
   */
  isFree?: boolean;
  /** tariff that was NOT charged (0 on every ordinary séance libre) */
  waivedAmount?: number;
}
