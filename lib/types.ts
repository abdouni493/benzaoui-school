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
  /** master switch for the automatic weekly-absence billing */
  absencePenaltyEnabled?: boolean;
  /** floor date (YYYY-MM-DD): absences are only billed for weeks ending on/after
   *  this day, so enabling the feature never retro-bills old history */
  absencePenaltySince?: string;
}

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
}

export type ReceptionPaymentType = "daily" | "monthly" | "half_day";
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

/** Per-student enrollment window for a formation subscription (YYYY-MM-DD). */
export interface SubscriptionDates {
  startDate?: string;
  expiryDate?: string;
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
  /** outstanding one-time registration cost not yet settled */
  registrationDue?: number;
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
}
