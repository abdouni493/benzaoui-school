"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/lib/store/toast";
import type {
  AbsencePenalty,
  Announcement,
  AttendanceRecord,
  BalanceTransaction,
  BalanceTxType,
  CashTransaction,
  Coursework,
  Expense,
  ExpenseCategory,
  Filiere,
  FreePeriod,
  FreePeriodStat,
  Group,
  IndependentSession,
  Module,
  ModuleAbsenceRule,
  Notification,
  Parent,
  PrivateSession,
  PrivateSessionModule,
  PrivateSessionStatus,
  PrivateSessionStudent,
  Profile,
  ReceptionPaymentType,
  ReceptionStaff,
  Salle,
  School,
  ScheduleSession,
  SchoolClass,
  Student,
  StudentCredential,
  Subject,
  Subscription,
  Teacher,
  TeacherAbsence,
  TeacherAcompte,
  TeacherPayment,
  UnpaidTeacherSession,
  WorkerPayment,
  WorkerShift,
  WorkerShiftStatus,
} from "@/lib/types";

export interface Database {
  school: School;
  filieres: Filiere[];
  modules: Module[];
  groups: Group[];
  salles: Salle[];
  classes: SchoolClass[];
  teachers: Teacher[];
  teacherPayments: TeacherPayment[];
  reception: ReceptionStaff[];
  workerShifts: WorkerShift[];
  workerPayments: WorkerPayment[];
  sessions: ScheduleSession[];
  subscriptions: Subscription[];
  freePeriods: FreePeriod[];
  students: Student[];
  studentCredentials: StudentCredential[];
  moduleAbsenceRules: ModuleAbsenceRule[];
  balanceTx: BalanceTransaction[];
  attendance: AttendanceRecord[];
  absencePenalties: AbsencePenalty[];
  unpaidTeacher: UnpaidTeacherSession[];
  acomptes: TeacherAcompte[];
  absences: TeacherAbsence[];
  subjects: Subject[];
  announcements: Announcement[];
  categories: ExpenseCategory[];
  expenses: Expense[];
  cash: CashTransaction[];
  parents: Parent[];
  notifications: Notification[];
  coursework: Coursework[];
  independent: IndependentSession[];
  privateSessions: PrivateSession[];
  privateSessionModules: PrivateSessionModule[];
  privateSessionStudents: PrivateSessionStudent[];
  /** Les comptes de l'application — la caisse a besoin de NOMMER qui a encaissé. */
  profiles: Profile[];
}

/** Real UUIDs now (Postgres primary keys), the prefix argument is kept only
 *  so the ~100 existing `uid("stu")`-style call sites don't need to change. */
export function uid(_prefix?: string): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyDatabase(): Database {
  return {
    school: {
      id: "",
      name: "",
      description: "",
      phone: "",
      email: "",
      address: "",
      registrationFee: 0,
      registrationFee2: 0,
    },
    filieres: [],
    modules: [],
    groups: [],
    salles: [],
    classes: [],
    teachers: [],
    teacherPayments: [],
    reception: [],
    workerShifts: [],
    workerPayments: [],
    sessions: [],
    subscriptions: [],
    freePeriods: [],
    students: [],
    studentCredentials: [],
    moduleAbsenceRules: [],
    balanceTx: [],
    attendance: [],
    absencePenalties: [],
    unpaidTeacher: [],
    acomptes: [],
    absences: [],
    subjects: [],
    announcements: [],
    categories: [],
    expenses: [],
    cash: [],
    parents: [],
    notifications: [],
    coursework: [],
    independent: [],
    privateSessions: [],
    privateSessionModules: [],
    privateSessionStudents: [],
    profiles: [],
  };
}

// =============================================================================
// Row <-> app-object field mapping. `Database`'s shape (camelCase, arrays of
// domain objects) never changes here, so the ~20 page components that read
// `useData()` keep working unmodified — only this file talks to Postgres.
// =============================================================================

type FieldSpec<T> = readonly [keyof T & string, string];

function makeMapper<T>(fields: readonly FieldSpec<T>[]) {
  const fromRow = (row: Record<string, unknown>): T => {
    const out = {} as Record<string, unknown>;
    for (const [js, db] of fields) {
      const v = row[db];
      out[js] = v === null ? undefined : v;
    }
    return out as T;
  };
  const toRow = (item: Partial<T>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [js, db] of fields) {
      if (js in item) {
        // JSON.stringify drops `undefined` keys, so an update meant to CLEAR
        // a field (e.g. { parentId: undefined }) would silently leave the
        // old value in Postgres — looking "saved" locally until the next
        // fetch snapped it back. Send an explicit null instead.
        const v = (item as Record<string, unknown>)[js];
        out[db] = v === undefined ? null : v;
      }
    }
    return out;
  };
  return { fromRow, toRow };
}

interface TableConfig {
  table: string;
  select: string;
  /**
   * Colonne de tri de la pagination — la CLÉ PRIMAIRE de la table, et rien
   * d'autre : c'est elle qui rend deux pages successives disjointes.
   *
   * Toutes les tables ne s'appellent pas `id`. `student_credentials` est
   * classée par `student_id`, `module_absence_rules` par `module_id` : leur
   * clé primaire EST la référence. Trier sur un `id` qui n'existe pas faisait
   * répondre 400 à PostgREST (« column student_credentials.id does not
   * exist »), donc échouer la lecture de la table ENTIÈRE — et, comme un
   * échec de page conserve volontairement les lignes déjà chargées, l'écran
   * restait vide sans jamais se réparer.
   */
  orderBy?: string;
  fromRow: (row: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
  toRow: (item: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const filieresMapper = makeMapper<Filiere>([["id", "id"], ["name", "name"]]);
const modulesMapper = makeMapper<Module>([["id", "id"], ["name", "name"]]);
const groupsMapper = makeMapper<Group>([["id", "id"], ["name", "name"]]);
const sallesMapper = makeMapper<Salle>([["id", "id"], ["name", "name"]]);

const classesMapper = makeMapper<SchoolClass>([
  ["id", "id"],
  ["type", "type"],
  ["name", "name"],
  ["description", "description"],
  ["coursLevel", "cours_level"],
  ["year", "year"],
  ["filiereId", "filiere_id"],
  ["formationLevel", "formation_level"],
]);

const teachersMapper = makeMapper<Teacher>([
  ["id", "id"],
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["phone", "phone"],
  ["email", "email"],
  ["paymentType", "payment_type"],
  ["monthlyAmount", "monthly_amount"],
  ["startDate", "start_date"],
  ["percentage", "percentage"],
  ["isPassager", "is_passager"],
  ["description", "description"],
]);

const teacherPaymentsMapper = makeMapper<TeacherPayment>([
  ["id", "id"],
  ["teacherId", "teacher_id"],
  ["amount", "amount"],
  ["method", "method"],
  ["percentage", "percentage"],
  ["studentsCount", "students_count"],
  ["sessionsCount", "sessions_count"],
  ["description", "description"],
  ["details", "details"],
  ["paidAt", "paid_at"],
  ["cashTxId", "cash_tx_id"],
]);

const receptionMapper = makeMapper<ReceptionStaff>([
  ["id", "id"],
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["phone", "phone"],
  ["email", "email"],
  ["paymentType", "payment_type"],
  ["startDate", "start_date"],
  ["salary", "salary"],
  ["role", "role"],
  ["rfid", "rfid"],
  ["hourlyRate", "hourly_rate"],
  ["workDays", "work_days"],
  ["dailyStart", "daily_start"],
  ["dailyEnd", "daily_end"],
  ["jobTitle", "job_title"],
  ["payAlertDays", "pay_alert_days"],
  ["payStartDate", "pay_start_date"],
]);

const workerShiftsMapper = makeMapper<WorkerShift>([
  ["id", "id"],
  ["workerId", "worker_id"],
  ["workDate", "work_date"],
  ["startAt", "start_at"],
  ["endAt", "end_at"],
  ["minutes", "minutes"],
  ["frozen", "frozen"],
  ["paid", "paid"],
  ["paymentId", "payment_id"],
  ["createdAt", "created_at"],
  ["status", "status"],
  ["source", "source"],
  ["notes", "notes"],
  ["absenceResolved", "absence_resolved"],
  ["absenceCost", "absence_cost"],
  ["absenceId", "absence_id"],
]);

const workerPaymentsMapper = makeMapper<WorkerPayment>([
  ["id", "id"],
  ["workerId", "worker_id"],
  ["amount", "amount"],
  ["method", "method"],
  ["periodStart", "period_start"],
  ["periodEnd", "period_end"],
  ["periodKey", "period_key"],
  ["daysCount", "days_count"],
  ["minutes", "minutes"],
  ["description", "description"],
  ["details", "details"],
  ["paidAt", "paid_at"],
  ["cashTxId", "cash_tx_id"],
]);

const profilesMapper = makeMapper<Profile>([
  ["id", "id"],
  ["role", "role"],
  ["fullName", "full_name"],
  ["email", "email"],
  ["phone", "phone"],
]);

const privateSessionsMapper = makeMapper<PrivateSession>([
  ["id", "id"],
  ["studentId", "student_id"],
  ["guestName", "guest_name"],
  ["guestPhone", "guest_phone"],
  ["guestPhone2", "guest_phone2"],
  ["classId", "class_id"],
  ["year", "year"],
  ["filiereId", "filiere_id"],
  ["scheduledAt", "scheduled_at"],
  ["durationMinutes", "duration_minutes"],
  ["totalPrice", "total_price"],
  ["paidAmount", "paid_amount"],
  ["status", "status"],
  ["notes", "notes"],
  ["createdAt", "created_at"],
  ["createdBy", "created_by"],
  ["requestDate", "request_date"],
  ["receptionistId", "receptionist_id"],
  ["receptionistName", "receptionist_name"],
  ["observation", "observation"],
  ["depositAmount", "deposit_amount"],
  ["schoolPercentage", "school_percentage"],
  ["teacherShare", "teacher_share"],
  ["schoolShare", "school_share"],
  ["completedAt", "completed_at"],
]);

const privateSessionModulesMapper = makeMapper<PrivateSessionModule>([
  ["id", "id"],
  ["privateSessionId", "private_session_id"],
  ["moduleId", "module_id"],
  ["teacherId", "teacher_id"],
  ["minutes", "minutes"],
  ["hourlyPrice", "hourly_price"],
  ["totalPrice", "total_price"],
  ["teacherPercentage", "teacher_percentage"],
  ["teacherAmount", "teacher_amount"],
  ["teacherPaid", "teacher_paid"],
  ["teacherPaidAt", "teacher_paid_at"],
  ["scheduledAt", "scheduled_at"],
  ["flatPrice", "flat_price"],
  ["teacherName", "teacher_name"],
  ["teacherPhone", "teacher_phone"],
]);

const privateSessionStudentsMapper = makeMapper<PrivateSessionStudent>([
  ["id", "id"],
  ["privateSessionId", "private_session_id"],
  ["studentId", "student_id"],
  ["guestName", "guest_name"],
  ["guestPhone", "guest_phone"],
  ["classId", "class_id"],
  ["year", "year"],
  ["filiereId", "filiere_id"],
  ["totalPrice", "total_price"],
  ["paidAmount", "paid_amount"],
  ["createdAt", "created_at"],
]);

const studentCredentialsMapper = makeMapper<StudentCredential>([
  ["studentId", "student_id"],
  ["password", "password"],
  ["updatedAt", "updated_at"],
]);

const moduleAbsenceRulesMapper = makeMapper<ModuleAbsenceRule>([
  ["moduleId", "module_id"],
  ["enabled", "enabled"],
  ["daysWindow", "days_window"],
]);

const parentsBaseMapper = makeMapper<Parent>([
  ["id", "id"],
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["phone", "phone"],
  ["email", "email"],
]);

const studentsBaseMapper = makeMapper<Student>([
  ["id", "id"],
  ["firstName", "first_name"],
  ["lastName", "last_name"],
  ["birthDate", "birth_date"],
  ["phone", "phone"],
  ["email", "email"],
  ["rfid", "rfid"],
  ["balance", "balance"],
  ["isFree", "is_free"],
  ["parentId", "parent_id"],
  ["registrationDue", "registration_due"],
  // Lu seulement : la colonne a sa valeur par défaut en base, et `toRow` ne
  // l'émet que si l'appelant la fournit — ce qu'aucune mise à jour ne fait.
  ["createdAt", "created_at"],
]);

const sessionsMapper = makeMapper<ScheduleSession>([
  ["id", "id"],
  ["classId", "class_id"],
  ["moduleId", "module_id"],
  ["groupId", "group_id"],
  ["salleId", "salle_id"],
  ["teacherId", "teacher_id"],
  ["days", "days"],
  ["startTime", "start_time"],
  ["endTime", "end_time"],
  ["isOpen", "is_open"],
  ["title", "title"],
  ["periodStart", "period_start"],
  ["periodEnd", "period_end"],
  ["classIds", "class_ids"],
  ["groupIds", "group_ids"],
  ["salleIds", "salle_ids"],
  ["openPrice", "open_price"],
  ["isFree", "is_free"],
  ["openAudience", "open_audience"],
  ["billingStartDate", "billing_start_date"],
]);

const subscriptionsMapper = makeMapper<Subscription>([
  ["id", "id"],
  ["sessionId", "session_id"],
  ["pricePerSession", "price_per_session"],
  ["levelPrice", "level_price"],
  ["periodMonths", "period_months"],
]);

const freePeriodsMapper = makeMapper<FreePeriod>([
  ["id", "id"],
  ["name", "name"],
  ["description", "description"],
  ["startDate", "start_date"],
  ["endDate", "end_date"],
  ["allClasses", "all_classes"],
  ["classIds", "class_ids"],
  ["payTeachers", "pay_teachers"],
  ["active", "active"],
  ["createdAt", "created_at"],
]);

const balanceTxMapper = makeMapper<BalanceTransaction>([
  ["id", "id"],
  ["studentId", "student_id"],
  ["amount", "amount"],
  ["date", "date"],
  ["type", "type"],
  ["description", "description"],
  ["moduleId", "module_id"],
  ["createdBy", "created_by"],
]);

const attendanceMapper = makeMapper<AttendanceRecord>([
  ["id", "id"],
  ["studentId", "student_id"],
  ["sessionId", "session_id"],
  ["timestamp", "occurred_at"],
  ["amountDeducted", "amount_deducted"],
  ["status", "status"],
  ["substituteGroup", "substitute_group"],
  ["freePeriodId", "free_period_id"],
  ["preStart", "pre_start"],
  ["waivedAmount", "waived_amount"],
]);

const absencePenaltiesMapper = makeMapper<AbsencePenalty>([
  ["id", "id"],
  ["studentId", "student_id"],
  ["subscriptionId", "subscription_id"],
  ["sessionId", "session_id"],
  ["moduleId", "module_id"],
  ["periodStart", "period_start"],
  ["periodEnd", "period_end"],
  ["amount", "amount"],
  ["balanceAfter", "balance_after"],
  ["createdAt", "created_at"],
]);

const unpaidTeacherMapper = makeMapper<UnpaidTeacherSession>([
  ["id", "id"],
  ["teacherId", "teacher_id"],
  ["sessionId", "session_id"],
  ["studentId", "student_id"],
  ["amount", "amount"],
  ["date", "date"],
  ["paid", "paid"],
]);

const acomptesMapper = makeMapper<TeacherAcompte>([
  ["id", "id"],
  ["teacherId", "staff_id"],
  ["amount", "amount"],
  ["description", "description"],
  ["date", "date"],
  ["paymentId", "payment_id"],
]);

const absencesMapper = makeMapper<TeacherAbsence>([
  ["id", "id"],
  ["teacherId", "staff_id"],
  ["cost", "cost"],
  ["description", "description"],
  ["date", "date"],
  ["paymentId", "payment_id"],
]);

const subjectsMapper = makeMapper<Subject>([
  ["id", "id"],
  ["title", "title"],
  ["description", "description"],
  ["image", "image_url"],
  ["sessionId", "session_id"],
  ["date", "date"],
]);

const announcementsMapper = makeMapper<Announcement>([
  ["id", "id"],
  ["title", "title"],
  ["description", "description"],
  ["audience", "audience"],
  ["endDate", "end_date"],
  ["date", "date"],
  ["targetGroupIds", "target_group_ids"],
  ["includeParents", "include_parents"],
]);

const categoriesMapper = makeMapper<ExpenseCategory>([["id", "id"], ["name", "name"]]);

const expensesMapper = makeMapper<Expense>([
  ["id", "id"],
  ["name", "name"],
  ["categoryId", "category_id"],
  ["amount", "amount"],
  ["date", "date"],
]);

const cashMapper = makeMapper<CashTransaction>([
  ["id", "id"],
  ["type", "type"],
  ["amount", "amount"],
  ["date", "date"],
  ["description", "description"],
  ["createdBy", "created_by"],
]);

const notificationsMapper = makeMapper<Notification>([
  ["id", "id"],
  ["parentId", "parent_id"],
  ["title", "title"],
  ["description", "description"],
  ["date", "date"],
  ["read", "read"],
  ["auto", "auto"],
]);

const courseworkMapper = makeMapper<Coursework>([
  ["id", "id"],
  ["name", "name"],
  ["type", "type"],
  ["dates", "dates"],
  ["pricePerSession", "price_per_session"],
  ["total", "total"],
  ["teacherId", "teacher_id"],
]);

const independentMapper = makeMapper<IndependentSession>([
  ["id", "id"],
  ["studentId", "student_id"],
  ["passagerName", "passager_name"],
  ["itemLabel", "item_label"],
  ["price", "price"],
  ["date", "date"],
  ["sessionId", "session_id"],
  ["startTime", "start_time"],
  ["endTime", "end_time"],
  ["createdAt", "created_at"],
  ["teacherPaid", "teacher_paid"],
  ["isFree", "is_free"],
  ["waivedAmount", "waived_amount"],
  ["passagerPhone", "passager_phone"],
  ["classId", "class_id"],
  ["year", "year"],
  ["filiereId", "filiere_id"],
  ["moduleId", "module_id"],
  ["teacherPercentage", "teacher_percentage"],
  ["teacherAmount", "teacher_amount"],
  ["createdBy", "created_by"],
]);

const TABLES: Record<Exclude<keyof Database, "school">, TableConfig> = {
  filieres: { table: "filieres", select: "*", ...filieresMapper },
  modules: { table: "modules", select: "*", ...modulesMapper },
  groups: { table: "groups", select: "*", ...groupsMapper },
  salles: { table: "salles", select: "*", ...sallesMapper },
  classes: { table: "classes", select: "*", ...classesMapper },
  teachers: { table: "teachers", select: "*", ...teachersMapper },
  teacherPayments: { table: "teacher_payments", select: "*", ...teacherPaymentsMapper },
  reception: { table: "reception_staff", select: "*", ...receptionMapper },
  workerShifts: { table: "worker_shifts", select: "*", ...workerShiftsMapper },
  workerPayments: { table: "worker_payments", select: "*", ...workerPaymentsMapper },
  profiles: { table: "profiles", select: "*", ...profilesMapper },
  // Ces deux tables n'ont pas de colonne `id` : leur clé primaire est la
  // référence qu'elles portent. Trier sur `id` leur valait un 400.
  studentCredentials: {
    table: "student_credentials",
    select: "*",
    orderBy: "student_id",
    ...studentCredentialsMapper,
  },
  moduleAbsenceRules: {
    table: "module_absence_rules",
    select: "*",
    orderBy: "module_id",
    ...moduleAbsenceRulesMapper,
  },
  sessions: { table: "sessions", select: "*", ...sessionsMapper },
  subscriptions: { table: "subscriptions", select: "*", ...subscriptionsMapper },
  freePeriods: { table: "free_periods", select: "*", ...freePeriodsMapper },
  students: {
    table: "students",
    // `(*)` instead of explicit columns so the fetch keeps working before the
    // start_date/expiry_date migration has been applied.
    select: "*, student_subscriptions(*)",
    fromRow: (row) => ({
      ...studentsBaseMapper.fromRow(row),
      subscriptionIds: (row.student_subscriptions ?? []).map((r: any) => r.subscription_id), // eslint-disable-line @typescript-eslint/no-explicit-any
      subscriptionDates: Object.fromEntries(
        (row.student_subscriptions ?? [])
          .filter((r: any) => r.subscribed_at || r.start_date || r.expiry_date) // eslint-disable-line @typescript-eslint/no-explicit-any
          .map((r: any) => [ // eslint-disable-line @typescript-eslint/no-explicit-any
            r.subscription_id,
            {
              subscribedAt: r.subscribed_at ?? undefined,
              startDate: r.start_date ?? undefined,
              expiryDate: r.expiry_date ?? undefined,
            },
          ]),
      ),
      subscriptionDiscounts: Object.fromEntries(
        (row.student_subscriptions ?? [])
          .filter((r: any) => r.discount_type && r.discount_value > 0) // eslint-disable-line @typescript-eslint/no-explicit-any
          .map((r: any) => [ // eslint-disable-line @typescript-eslint/no-explicit-any
            r.subscription_id,
            { type: r.discount_type, value: r.discount_value ?? 0 },
          ]),
      ),
    }),
    toRow: studentsBaseMapper.toRow,
  },
  balanceTx: { table: "balance_tx", select: "*", ...balanceTxMapper },
  attendance: { table: "attendance", select: "*", ...attendanceMapper },
  absencePenalties: { table: "absence_penalties", select: "*", ...absencePenaltiesMapper },
  unpaidTeacher: { table: "unpaid_teacher_sessions", select: "*", ...unpaidTeacherMapper },
  acomptes: { table: "teacher_acomptes", select: "*", ...acomptesMapper },
  absences: { table: "teacher_absences", select: "*", ...absencesMapper },
  subjects: { table: "subjects", select: "*", ...subjectsMapper },
  announcements: { table: "announcements", select: "*", ...announcementsMapper },
  categories: { table: "expense_categories", select: "*", ...categoriesMapper },
  expenses: { table: "expenses", select: "*", ...expensesMapper },
  cash: { table: "cash_transactions", select: "*", ...cashMapper },
  parents: {
    table: "parents",
    select: "*, students(id)",
    fromRow: (row) => ({
      ...parentsBaseMapper.fromRow(row),
      childIds: (row.students ?? []).map((r: any) => r.id), // eslint-disable-line @typescript-eslint/no-explicit-any
    }),
    toRow: parentsBaseMapper.toRow,
  },
  notifications: { table: "notifications", select: "*", ...notificationsMapper },
  coursework: { table: "coursework", select: "*", ...courseworkMapper },
  independent: { table: "independent_sessions", select: "*", ...independentMapper },
  privateSessions: { table: "private_sessions", select: "*", ...privateSessionsMapper },
  privateSessionModules: {
    table: "private_session_modules",
    select: "*",
    ...privateSessionModulesMapper,
  },
  privateSessionStudents: {
    table: "private_session_students",
    select: "*",
    ...privateSessionStudentsMapper,
  },
};

// ---- Lire une table EN ENTIER ----------------------------------------------
//
// POURQUOI CE CODE EXISTE — la panne qu'il répare
// ------------------------------------------------
// PostgREST plafonne toute réponse à `db-max-rows` (1000 chez Supabase) et ne
// le SIGNALE PAS : la requête réussit, `error` est nul, et il manque
// simplement des lignes. `balance_tx` a dépassé ce seuil, et l'application a
// commencé à travailler sur un historique amputé de ses lignes les plus
// récentes. Les conséquences n'avaient aucun rapport apparent entre elles :
//
//   · une recharge enregistrée « disparaissait » du récapitulatif ;
//   · une fiche élève affichait 1 transaction sur 5 ;
//   · surtout, tout écran qui CONFRONTE le solde à son historique voyait des
//     débits sans leurs recettes et annonçait une dette de plusieurs centaines
//     de dinars à des élèves parfaitement à jour.
//
// Sans ORDER BY, l'ordre des lignes rendues n'est même pas défini : deux
// chargements successifs pouvaient retenir deux sous-ensembles différents.
//
// On pagine donc explicitement, en triant sur la clé primaire — le seul tri
// que toutes les tables partagent, et le seul qui rende la pagination stable.

/** Taille de page. Sous le plafond de PostgREST, pour que « moins d'une page
 *  reçue » signifie toujours « fin de table » et jamais « plafond atteint ». */
const PAGE_SIZE = 500;

/** Garde-fou : une table qui dépasserait ce total signale une anomalie plutôt
 *  que de boucler indéfiniment (et de saturer la mémoire du navigateur). */
const MAX_ROWS = 200_000;

export type FetchOutcome =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

/** Le strict minimum que `fetchWholeTable` demande à un client Supabase — de
 *  quoi le tester sans base. */
export interface PagedSource {
  from(table: string): {
    select(columns: string): {
      order(
        column: string,
        opts: { ascending: boolean },
      ): {
        range(
          from: number,
          to: number,
        ): PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
      };
    };
  };
}

/**
 * Toutes les lignes d'une table, page par page.
 *
 * Un échec de page ne rend PAS un résultat partiel : il rend `ok: false`, et
 * l'appelant conserve alors ce qu'il avait déjà. Une demi-table est pire que
 * pas de table du tout — c'est précisément elle qui faisait inventer des
 * dettes.
 */
export async function fetchWholeTable(
  supabase: PagedSource,
  cfg: Pick<TableConfig, "table" | "select" | "orderBy">,
): Promise<FetchOutcome> {
  const rows: Record<string, unknown>[] = [];
  // Tri sur la clé primaire — `id` pour la plupart des tables, sa vraie clé
  // pour celles qui n'en ont pas (voir `TableConfig.orderBy`).
  const orderColumn = cfg.orderBy ?? "id";

  for (let from = 0; from < MAX_ROWS; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(cfg.table)
      .select(cfg.select)
      // Sans ce tri, deux pages peuvent se recouvrir ou s'ignorer, et la table
      // lue n'est plus la table stockée.
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error || !data) return { ok: false, error: error?.message ?? "no data" };

    rows.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < PAGE_SIZE) return { ok: true, rows };
  }

  console.error(
    `[db] ${cfg.table} dépasse ${MAX_ROWS} lignes : lecture interrompue. ` +
      "Les écrans qui recoupent cette table seront désactivés plutôt que faux.",
  );
  return { ok: false, error: `plus de ${MAX_ROWS} lignes` };
}

const schoolMapper = makeMapper<School>([
  ["id", "id"],
  ["name", "name"],
  ["description", "description"],
  ["phone", "phone"],
  ["email", "email"],
  ["logo", "logo_url"],
  ["address", "address"],
  ["articleFiscal", "article_fiscal"],
  ["registreCommerce", "registre_commerce"],
  ["nif", "nif"],
  ["nis", "nis"],
  ["registrationFee", "registration_fee"],
  ["registrationFeeLabel", "registration_fee_label"],
  ["registrationFee2", "registration_fee_2"],
  ["registrationFee2Label", "registration_fee_2_label"],
  ["absencePenaltyEnabled", "absence_penalty_enabled"],
  ["absencePenaltySince", "absence_penalty_since"],
  ["absenceWeekStartDay", "absence_week_start_day"],
]);

/** These entity tables are auth-linked (id === auth.users.id): creation goes
 *  through /api/admin/users and deletion must remove the auth user too. */
const AUTH_LINKED_KEYS = new Set(["students", "teachers", "parents", "reception"]);

// ---- Écritures tolérantes au schéma ----------------------------------------
// PostgREST refuse la requête ENTIÈRE dès qu'une colonne lui est inconnue :
// « Could not find the 'is_free' column of 'sessions' in the schema cache ».
// Une migration pas encore passée faisait donc échouer l'enregistrement complet
// d'un créneau — qui restait affiché puis disparaissait au refetch suivant.
// On retire la colonne fautive et on réessaie : la ligne est écrite avec ce que
// la base connaît, au lieu de n'être écrite nulle part.

/** Nom de la colonne inconnue, quand c'est bien de ça qu'il s'agit. */
export function unknownColumnOf(message: string): string | null {
  const m = /Could not find the '([^']+)' column/i.exec(message);
  return m ? m[1] : null;
}

type WriteRun = (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;

/**
 * Lance l'écriture, en abandonnant une à une les colonnes que la base ne
 * connaît pas encore. Renvoie `null` si la ligne est passée, sinon le message
 * d'erreur final.
 */
async function writeWithSchemaFallback(
  row: Record<string, unknown>,
  run: WriteRun,
): Promise<string | null> {
  let patch = { ...row };
  // Autant de tentatives que de colonnes, jamais plus : pas de boucle infinie.
  for (let attempt = 0; attempt <= Object.keys(row).length; attempt++) {
    const { error } = await run(patch);
    if (!error) return null;

    const missing = unknownColumnOf(error.message);
    if (!missing || !(missing in patch)) return error.message;

    console.warn(
      `[db] colonne « ${missing} » absente de la base : écriture relancée sans elle. ` +
        "Passez la migration correspondante depuis supabase/migrations/.",
    );
    delete patch[missing];
    if (Object.keys(patch).length === 0) return error.message;
  }
  return "écriture refusée";
}

/** Une écriture refusée doit se VOIR : sans ça, la ligne semble enregistrée
 *  jusqu'au prochain rechargement, où elle disparaît sans explication. */
function reportWriteFailure(table: string, message: string): void {
  useToast.getState().addToast({
    type: "danger",
    title: "Enregistrement refusé",
    message: `La base a refusé l'écriture dans « ${table} » : ${message}. La modification n'a PAS été enregistrée.`,
  });
}

export interface ScanResult {
  ok: boolean;
  studentId?: string;
  sessionId?: string;
  cost?: number;
  newBalance?: number;
  /** present | late (set on successful writes) */
  status?: "present" | "late" | "absent";
  /** balance is negative after (or already was before) this operation */
  debt?: boolean;
  /** balance will not cover 2 more séances of this price */
  lowBalance?: boolean;
  moduleName?: string;
  sessionStart?: string;
  sessionEnd?: string;
  /** on scan.tooEarly: start time (HH:mm) of the next séance today */
  nextStart?: string;
  /** on scan.debtBlocked: the current (negative) balance */
  balance?: number;
  /** on absent/cancel: the amount refunded to the student */
  refunded?: number;
  /** group of the séance the scan was actually matched to */
  groupName?: string;
  /** the student is enrolled in ANOTHER group of the same course: he attended
   *  a sibling group ("rattrapage"), which is allowed and billed normally */
  otherGroup?: boolean;
  /** the group he is actually enrolled in (only set when otherGroup) */
  ownGroupName?: string;
  /** the student has NO enrollment on this course at all: he was admitted on
   *  the créneau because his class is part of its public (same class, same
   *  year, same filière). Billed at the créneau's listed price. */
  viaClass?: boolean;
  /** the séance was offered: presence written, balance intact. Set both by a
   *  "période gratuite" and by a séance libre créneau flagged as offered. */
  free?: boolean;
  /** label of that free period */
  freePeriodName?: string;
  /** the CRÉNEAU itself is a "séance libre offerte" (sessions.is_free): nothing
   *  is debited, nothing is cashed by the school, and the teacher earns nothing
   *  on it. Always comes with `free: true`. */
  freeSeance?: boolean;
  /** the séance happened BEFORE the enrollment's start date: presence written,
   *  balance strictly untouched */
  preStart?: boolean;
  /** that start date (YYYY-MM-DD), only set when preStart */
  enrollmentStart?: string;
  /** what was offered on this scan — free period or pre-start séance (the
   *  price NOT charged) */
  waived?: number;
  messageKey: string;
}

/** Result of a balance-transaction correction (edit / delete). */
export interface BalanceTxResult {
  ok: boolean;
  /** the student's balance once the correction was applied */
  newBalance?: number;
  /** a compensating cash entry was written (the row was a "topup") */
  cashAdjusted?: boolean;
  error?: string;
}

export interface TeacherSettlement {
  ok: boolean;
  net?: number;
  gross?: number;
  sessions?: number;
  acomptes?: number;
  absences?: number;
  messageKey?: string;
}

/** Result of a worker badge swipe (clock-in / clock-out). */
export interface WorkerScanResult {
  ok: boolean;
  workerId?: string;
  workerName?: string;
  date?: string;
  startAt?: string;
  minutes?: number;
  messageKey: string;
}

interface DataActions {
  loaded: boolean;
  /**
   * Les tables dont TOUTES les lignes sont bien arrivées, au dernier
   * chargement.
   *
   * Ce n'est pas un détail de plomberie : un écran qui CONFRONTE deux tables
   * (le solde d'un élève contre son historique, par exemple) tire une
   * conclusion fausse dès qu'il en manque un morceau — il voit un débit sans
   * sa recette et invente une dette. Tant qu'une table n'est pas ici, aucun
   * recoupement ne doit être affiché à partir d'elle.
   */
  complete: Partial<Record<keyof typeof TABLES, boolean>>;
  fetchSchool: () => Promise<void>;
  fetchAll: () => Promise<void>;
  clear: () => void;

  scanCard: (rfidOrStudentId: string, when?: Date) => Promise<ScanResult>;
  markAttendance: (
    studentId: string,
    sessionId: string,
    status: "present" | "late" | "absent",
    opts?: { date?: string; allowDebt?: boolean; skipTeacherDue?: boolean },
  ) => Promise<ScanResult>;
  cancelAttendance: (attendanceId: string) => Promise<ScanResult>;
  /** Corrects one presence (status / date-time / amount charged); the balance
   *  moves by exactly the same delta, server-side. */
  updateAttendance: (
    attendanceId: string,
    fields: { status?: "present" | "late" | "absent"; occurredAt?: string; amount?: number },
  ) => Promise<ScanResult>;
  /** Removes one automatic weekly-absence charge and refunds it. */
  deleteAbsencePenalty: (penaltyId: string) => Promise<ScanResult>;
  /** Writes ONE tariff for every group of a course (same class + module +
   *  teacher), creating the missing ones. Returns how many groups were priced. */
  setSubscriptionPrice: (
    sessionId: string,
    price: number,
    levelPrice?: number,
    periodMonths?: number,
  ) => Promise<{ ok: boolean; groups?: number; created?: number; updated?: number }>;
  /** Deletes the tariff of a whole course (every group). */
  deleteSubscriptionPrice: (sessionId: string) => Promise<{ ok: boolean; deleted?: number }>;
  /** Cost of every "période gratuite" (presences, students, total offered),
   *  aggregated server-side so the totals never depend on how many attendance
   *  rows the browser managed to load. */
  fetchFreePeriodStats: () => Promise<FreePeriodStat[]>;
  /** Bills every module a student has been absent on for a full week (idempotent,
   *  server-side). Returns how many weekly charges were written. */
  processWeeklyAbsences: () => Promise<{ ok: boolean; charged?: number; students?: number }>;
  settleTeacherPercentage: (teacherId: string) => Promise<TeacherSettlement>;

  /** Worker badge: 1st swipe of the day = clock-in, 2nd = clock-out. */
  scanWorkerCard: (code: string) => Promise<WorkerScanResult>;
  /** Freezes days started without a clock-out once the day is over. */
  freezeOpenWorkerShifts: () => Promise<{ ok: boolean; frozen?: number }>;
  /** Écrit (ou corrige) LA journée d'un travailleur à la main : arrivée,
   *  sortie, ou absence constatée. Le badge n'est qu'une des portes — une
   *  journée saisie ici vaut exactement la même chose qu'une journée pointée. */
  setWorkerShift: (args: {
    workerId: string;
    workDate: string;
    startAt?: string | null;
    endAt?: string | null;
    status?: WorkerShiftStatus;
    notes?: string;
  }) => Promise<{ ok: boolean; shiftId?: string; minutes?: number; messageKey?: string }>;
  /** Clôture la journée en cours d'un travailleur (fin de service à la main). */
  endWorkerShift: (
    workerId: string,
    endAt?: string,
  ) => Promise<{ ok: boolean; minutes?: number; messageKey?: string }>;
  /** Constate les absences : chaque jour ouvré RÉVOLU où le travailleur n'a ni
   *  badgé ni été pointé à la main devient une absence enregistrée. Idempotent :
   *  une journée déjà présente ou déjà marquée absente n'est jamais réécrite.
   *  Ne concerne que les travailleurs AU MOIS : un journalier payé aux journées
   *  travaillées n'a rien à se faire retenir quand il ne vient pas. */
  markWorkerAbsences: (args?: {
    workerId?: string;
    from?: string;
    to?: string;
  }) => Promise<{ ok: boolean; marked?: number; workers?: number }>;
  /**
   * Tranche la retenue d'une absence : « elle coûte tant », ou « elle ne
   * coûte rien ».
   *
   * Une absence constatée ne dit pas encore ce qu'elle retient sur la paie. Le
   * RPC écrit la décision sur la journée (`absence_resolved`) et, quand il y a
   * une retenue, la ligne `teacher_absences` que le règlement déduira. Décider
   * 0 DA est une décision : la journée sort des alertes sans rien retenir.
   */
  resolveWorkerAbsence: (args: {
    shiftId: string;
    cost: number;
    description?: string;
  }) => Promise<{ ok: boolean; absenceId?: string; cost?: number; messageKey?: string }>;
  /** Règle une PÉRIODE de travail (mois, journée, demi-journée ou heures) et
   *  l'inscrit au registre des règlements — le seul endroit qui dise avec
   *  certitude si un mois a déjà été payé. */
  payWorkerPeriod: (args: {
    workerId: string;
    method: ReceptionPaymentType;
    periodKey: string;
    periodStart?: string;
    periodEnd?: string;
    shiftIds?: string[];
    amount: number;
    description?: string;
    details?: unknown[];
    settleDeductions?: boolean;
    acompteIds?: string[];
    absenceIds?: string[];
  }) => Promise<{ ok: boolean; paymentId?: string; days?: number; minutes?: number; messageKey?: string }>;
  /** Annule un règlement : les journées redeviennent dues, les acomptes et
   *  retenues redeviennent exigibles, et la ligne de caisse est retirée. */
  deleteWorkerPayment: (
    paymentId: string,
  ) => Promise<{ ok: boolean; restored?: number; amount?: number; messageKey?: string }>;

  // ---- Séances particulières ------------------------------------------------
  //
  // UNE SÉANCE PARTICULIÈRE SE DÉROULE EN TROIS TEMPS, et chacun a son RPC :
  //
  //   1. `createPrivateRequest`  — le RENSEIGNEMENT. Quelqu'un demande un cours.
  //      On note qui (un ou plusieurs élèves), quand il a demandé, quel
  //      réceptionniste l'a reçu, ce qu'il veut, et le versement pris au
  //      passage. Rien n'est programmé — et c'est une alerte tant que ça dure.
  //   2. `programPrivateSession` — la PROGRAMMATION. Les modules, leurs dates,
  //      leurs prix, leurs enseignants.
  //   3. `completePrivateSession` — la CONCLUSION. L'élève a étudié et vient
  //      payer : total ajusté, répartition école / enseignant, enseignants
  //      réglés ou pas.
  //
  // L'ancien `createPrivateSession` (tout d'un bloc) reste : il sert encore à
  // l'édition complète d'une séance déjà programmée.

  /** Étape 1 — le dossier de demande, un ou plusieurs élèves. */
  createPrivateRequest: (payload: {
    id?: string;
    requestDate?: string;
    receptionistId?: string;
    receptionistName?: string;
    observation?: string;
    notes?: string;
    /** versement pris à la demande (entre en caisse tout de suite) */
    depositAmount?: number;
    students: Array<{
      studentId?: string;
      guestName?: string;
      guestPhone?: string;
      guestPhone2?: string;
      classId?: string;
      year?: string;
      filiereId?: string;
    }>;
  }) => Promise<{ ok: boolean; id?: string; students?: number; messageKey?: string }>;
  /** Corrige le dossier de demande (les élèves sont réécrits en bloc). */
  updatePrivateRequest: (
    id: string,
    payload: Parameters<DataActions["createPrivateRequest"]>[0],
  ) => Promise<{ ok: boolean; students?: number; messageKey?: string }>;
  /** Étape 2 — la programmation : modules, dates, prix, enseignants. */
  programPrivateSession: (
    id: string,
    payload: {
      /** repli quand aucun module ne porte sa propre date */
      scheduledAt?: string;
      modules: Array<{
        moduleId: string;
        teacherId?: string;
        /** enseignant hors base : un nom, un téléphone */
        teacherName?: string;
        teacherPhone?: string;
        scheduledAt?: string;
        minutes: number;
        hourlyPrice: number;
        /** prix forfaitaire ; > 0, c'est LUI le prix du module */
        flatPrice?: number;
        teacherPercentage: number;
      }>;
    },
  ) => Promise<{ ok: boolean; total?: number; scheduledAt?: string; messageKey?: string }>;
  /** Étape 3 — la conclusion : total, répartition, encaissement, enseignants. */
  completePrivateSession: (
    id: string,
    payload: {
      totalPrice: number;
      /** lequel des deux pourcentages a été saisi — l'autre s'en déduit */
      percentageMode: "school" | "teacher";
      percentage: number;
      /** encaissé maintenant */
      cashNow?: number;
      /** régler les enseignants fichés dans la foulée */
      teacherPaid?: boolean;
      /** ce que chaque élève doit et a versé */
      students?: Array<{ id: string; totalPrice?: number; paidAmount?: number }>;
    },
  ) => Promise<{
    ok: boolean;
    total?: number;
    paid?: number;
    due?: number;
    teacherShare?: number;
    schoolShare?: number;
    teacherPercentage?: number;
    schoolPercentage?: number;
    teachersPaid?: number;
    messageKey?: string;
  }>;

  /** Crée le rendez-vous, ses modules et — si la famille paie tout de suite —
   *  son encaissement, en une seule transaction. */
  createPrivateSession: (payload: {
    id?: string;
    studentId?: string;
    guestName?: string;
    guestPhone?: string;
    guestPhone2?: string;
    classId?: string;
    year?: string;
    filiereId?: string;
    scheduledAt: string;
    notes?: string;
    paidAmount?: number;
    modules: Array<{
      moduleId: string;
      teacherId?: string;
      minutes: number;
      hourlyPrice: number;
      teacherPercentage: number;
      /** l'enseignant est réglé dans la foulée */
      teacherPaid?: boolean;
    }>;
  }) => Promise<{ ok: boolean; id?: string; total?: number; messageKey?: string }>;
  /** Réécrit le rendez-vous et ses modules (l'encaissement déjà fait est
   *  conservé ; seule la dette bouge si le total change). */
  updatePrivateSession: (
    id: string,
    payload: Parameters<DataActions["createPrivateSession"]>[0],
  ) => Promise<{ ok: boolean; total?: number; messageKey?: string }>;
  /** Encaisse (tout ou partie de) la dette de la famille sur ce rendez-vous. */
  payPrivateSession: (
    id: string,
    amount: number,
  ) => Promise<{ ok: boolean; paid?: number; due?: number; messageKey?: string }>;
  /** Règle l'enseignant d'UN module de ce rendez-vous : caisse + historique de
   *  l'enseignant, comme n'importe quel autre versement. */
  payPrivateSessionTeacher: (
    moduleRowId: string,
    amount?: number,
  ) => Promise<{ ok: boolean; amount?: number; messageKey?: string }>;
  /** Séance tenue / annulée / replanifiée. */
  setPrivateSessionStatus: (
    id: string,
    status: PrivateSessionStatus,
  ) => Promise<{ ok: boolean; messageKey?: string }>;
  reschedulePrivateSession: (
    id: string,
    scheduledAt: string,
  ) => Promise<{ ok: boolean; messageKey?: string }>;
  /** Supprime le rendez-vous. Refusé tant qu'il reste de l'argent dessus. */
  deletePrivateSession: (
    id: string,
    force?: boolean,
  ) => Promise<{ ok: boolean; messageKey?: string }>;

  /** Settles the selected worked days; they never reappear as unpaid. */
  payWorkerShifts: (
    workerId: string,
    shiftIds: string[],
    amount: number,
    description?: string,
  ) => Promise<{ ok: boolean; days?: number; minutes?: number; messageKey?: string }>;
  /** Settles the selected teacher timings ("YYYY-MM-DD|sessionId" keys). */
  payTeacherSessions: (args: {
    teacherId: string;
    keys: string[];
    amount: number;
    method: "fixed" | "percent";
    percentage?: number;
    details?: unknown[];
    description?: string;
    /** also consume the teacher's outstanding acomptes / absence deductions:
     *  they are ATTACHED to the settlement, not destroyed, so cancelling it
     *  makes them payable again */
    settleDeductions?: boolean;
    acompteIds?: string[];
    absenceIds?: string[];
    /**
     * Les séances libres (`independent_sessions.id`) que ce règlement solde.
     *
     * Le RPC savait déjà retourner les passagers d'un créneau-jour, mais il les
     * devinait — `student_id is null` et la date. Une séance libre suivie par
     * un élève INSCRIT restait donc éternellement due à l'enseignant, et une
     * séance libre à pourcentage dédié n'avait aucun moyen d'être soldée sans
     * emporter ses voisines. On envoie désormais les identifiants exacts.
     */
    independentIds?: string[];
  }) => Promise<{ ok: boolean; paymentId?: string; sessions?: number; messageKey?: string }>;
  /** Removes séances the teacher is owed for but should not be paid on (a
   *  créneau recorded by mistake, a séance that turned out to be offered).
   *  Only UNPAID rows can go; a settled one is never touched. */
  deleteUnpaidTeacherSessions: (
    teacherId: string,
    ids: string[],
  ) => Promise<{ ok: boolean; deleted?: number; amount?: number }>;
  /** Corrects one settlement of the history (amount / method / label / date);
   *  the caisse movement follows. The settled timings stay settled — to give
   *  them back, cancel the settlement instead. */
  updateTeacherPayment: (
    paymentId: string,
    fields: {
      amount?: number;
      method?: "fixed" | "percent";
      percentage?: number;
      description?: string;
      paidAt?: string;
    },
  ) => Promise<{ ok: boolean; amount?: number; messageKey?: string }>;
  /** Cancels one settlement: its timings become due again, its acomptes and
   *  absence deductions become payable again, and its caisse line is removed. */
  deleteTeacherPayment: (
    paymentId: string,
  ) => Promise<{ ok: boolean; restored?: number; amount?: number; messageKey?: string }>;
  /** Writes ONE tariff for every group of a course AND, when `from` is given,
   *  re-prices every presence recorded from that day on: the student's debit is
   *  corrected (with its own balance line) and the teacher's share still due
   *  follows the new price. Séances already settled to the teacher are never
   *  touched. */
  repriceSession: (args: {
    sessionId: string;
    price: number;
    levelPrice?: number;
    periodMonths?: number;
    /** YYYY-MM-DD — omit to change the tariff only, like before */
    from?: string;
  }) => Promise<{
    ok: boolean;
    groups?: number;
    repriced?: number;
    charged?: number;
    refunded?: number;
    teacherDues?: number;
    teacherDuesRemoved?: number;
  }>;
  /** Applies the gratuities decided AFTER the fact to presences already
   *  recorded: a student charged on a séance that is now offered (créneau
   *  « offert », période gratuite) is REFUNDED, the price moves to the
   *  presence's `waivedAmount`, and the teacher's unsettled share on it goes
   *  away when he earns nothing. Money is only ever given back, never taken.
   *  Séances already settled to the teacher are never touched. */
  applyOfferedRules: (args?: {
    /** YYYY-MM-DD — omit for the whole history */
    from?: string;
    to?: string;
    sessionId?: string;
  }) => Promise<{
    ok: boolean;
    presences?: number;
    refunded?: number;
    stamped?: number;
    duesRemoved?: number;
    duesUpdated?: number;
  }>;
  /** Stores/updates the printable portal password (staff-only table). */
  setStudentPassword: (studentId: string, password: string) => Promise<void>;
  /** Turns the weekly-absence billing on/off for a single module. */
  setModuleAbsenceRule: (moduleId: string, enabled: boolean, daysWindow?: number) => Promise<void>;
  /** Writes a top-up: balance + `balance_tx` history row + caisse entry, in one
   *  server-side transaction. Reports failures so the caller never claims a
   *  payment was recorded when it wasn't. */
  addBalance: (
    studentId: string,
    amount: number,
    description: string,
    settleRegistration?: boolean,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** Débite une séance encaissée au guichet. Le solde bouge RELATIVEMENT au
   *  solde stocké, et la ligne d'historique part dans la même transaction :
   *  deux caisses ouvertes en même temps ne peuvent plus s'effacer l'une
   *  l'autre. Le solde a le droit de passer en dette — l'élève a suivi la
   *  séance, elle lui est comptée. */
  chargeStudent: (
    studentId: string,
    amount: number,
    description: string,
    moduleId?: string,
  ) => Promise<{ ok: boolean; error?: string; newBalance?: number }>;
  /** Règle les frais d'inscription sur le solde. `fee` omis = ce que la BASE
   *  dit encore dû, jamais ce que l'écran croyait dû. */
  settleRegistrationFee: (
    studentId: string,
    fee?: number,
    label?: string,
  ) => Promise<{ ok: boolean; error?: string; newBalance?: number }>;
  /** Encaisse les frais d'inscription À PART : l'argent entre en caisse, le
   *  solde de l'élève ne bouge pas d'un dinar. C'est le règlement « au
   *  guichet », celui qui ne mange pas la recharge de l'élève. `fee` omis =
   *  ce que la BASE dit encore dû. */
  payRegistrationFeeCash: (
    studentId: string,
    fee?: number,
    label?: string,
  ) => Promise<{ ok: boolean; error?: string; fee?: number; newBalance?: number }>;
  /** Encaisse un règlement de dette : l'inscription due d'abord, les séances
   *  suivies ensuite, le reste au solde — plus l'entrée en caisse. */
  payDebt: (
    studentId: string,
    amount: number,
  ) => Promise<{ ok: boolean; error?: string; registrationPaid?: number; debtPaid?: number; credited?: number }>;
  /** Corrects one balance_tx row (amount / description / date / type) and
   *  carries the difference over to the student's balance atomically. */
  updateBalanceTx: (
    txId: string,
    fields: {
      amount: number;
      description?: string;
      date?: string;
      type?: BalanceTxType;
      /** a "topup" also hit the caisse: write the compensating cash entry */
      adjustCash?: boolean;
    },
  ) => Promise<BalanceTxResult>;
  /** Deletes one balance_tx row and undoes its effect on the balance. */
  deleteBalanceTx: (txId: string, adjustCash?: boolean) => Promise<BalanceTxResult>;
  deleteFrom: <K extends keyof Database>(key: K, id: string) => void;
  /** Ajoute la ligne (localement d'abord, puis en base). Résout à `true` quand
   *  la base l'a acceptée, `false` quand elle l'a refusée — ce que doit
   *  attendre tout appelant dont l'écriture SUIVANTE référence cette ligne. */
  push: <K extends keyof Database>(
    key: K,
    item: Database[K] extends Array<infer T> ? T : never,
  ) => Promise<boolean>;
  /** Patche la ligne (localement d'abord, puis en base). Résout à `true` quand
   *  la base l'a acceptée — ce qu'un appelant doit attendre avant de lancer une
   *  RPC qui LIT cette ligne (une période gratuite qu'on vient d'activer, par
   *  exemple), sans quoi la RPC peut passer avant l'écriture. */
  updateItem: <K extends keyof Database>(
    key: K,
    id: string,
    updatedFields: Partial<Database[K] extends Array<infer T> ? T : never>,
  ) => Promise<boolean>;
  cashMove: (
    type: "deposit" | "withdraw",
    amount: number,
    description: string,
    date?: string,
  ) => void;
  /** Writes the school row. Resolves with the outcome so screens that save a
   *  setting (frais d'inscription…) can tell the user when the write is refused
   *  — a column missing on a database that has not run the latest migration
   *  rejects the WHOLE update, and the optimistic state would otherwise lie. */
  updateSchool: (updatedFields: Partial<School>) => Promise<{ ok: boolean; error?: string }>;
  restoreState: (dump: Partial<Database>) => void;
  reset: () => void;
}

export type DataStore = Database & DataActions;

export const useData = create<DataStore>((set, get) => ({
  ...emptyDatabase(),
  loaded: false,
  complete: {},

  fetchSchool: async () => {
    const supabase = createClient();
    const { data } = await supabase.from("school").select("*").limit(1).maybeSingle();
    if (data) set({ school: schoolMapper.fromRow(data) });
  },

  // A refetch must never DESTROY what the screen already holds. A single table
  // that answers with an error (network blip, RLS, a migration not applied yet)
  // used to be replaced by an empty array — which is what made a subscription
  // just saved "disappear again" a moment later, together with every timing.
  // A failed table now keeps the rows already loaded.
  fetchAll: async () => {
    const supabase = createClient();
    const keys = Object.keys(TABLES) as Array<keyof typeof TABLES>;
    const before = get();
    const results = await Promise.all(
      keys.map(async (key) => {
        const cfg = TABLES[key];
        const page = await fetchWholeTable(supabase, cfg);
        if (!page.ok) {
          console.error(
            `Failed to load ${cfg.table}: ${page.error} — les lignes déjà chargées sont conservées.`,
          );
          return [key, (before[key] as unknown[]) ?? [], false] as const;
        }
        return [key, page.rows.map(cfg.fromRow), true] as const;
      }),
    );
    const patch: Record<string, unknown> = { loaded: true };
    const complete: Record<string, boolean> = {};
    for (const [key, rows, ok] of results) {
      patch[key] = rows;
      complete[key] = ok;
    }
    patch.complete = complete;
    set(patch as Partial<DataStore>);
  },

  clear: () => set({ ...emptyDatabase(), school: get().school, loaded: false, complete: {} }),

  // The whole scan (window matching, debt gate, deduction, attendance,
  // balance_tx, teacher due) runs atomically in the scan_card RPC — the
  // schedule/money rules live in one place, server-side.
  scanCard: async (rfidOrStudentId, when) => {
    const supabase = createClient();
    const args: { p_code: string; p_when?: string } = { p_code: rfidOrStudentId.trim() };
    if (when) args.p_when = when.toISOString();
    const { data, error } = await supabase.rpc("scan_card", args);
    if (error || !data) {
      console.error("scan_card failed:", error?.message);
      return { ok: false, messageKey: "scan.error" };
    }
    const res = data as ScanResult;
    // Refresh local state whenever the RPC wrote something (a deduction, a
    // presence, a teacher due).
    if (res.ok && res.messageKey !== "scan.alreadyPresent") await get().fetchAll();
    return res;
  },

  markAttendance: async (studentId, sessionId, status, opts) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("mark_attendance", {
      p_student_id: studentId,
      p_session_id: sessionId,
      p_status: status,
      p_date: opts?.date ?? null,
      p_allow_debt: !!opts?.allowDebt,
      p_skip_teacher_due: !!opts?.skipTeacherDue,
    });
    if (error || !data) {
      console.error("mark_attendance failed:", error?.message);
      return { ok: false, messageKey: "scan.error" };
    }
    const res = data as ScanResult;
    if (res.ok) await get().fetchAll();
    return res;
  },

  cancelAttendance: async (attendanceId) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("cancel_attendance", {
      p_attendance_id: attendanceId,
    });
    if (error || !data) {
      console.error("cancel_attendance failed:", error?.message);
      return { ok: false, messageKey: "scan.error" };
    }
    const res = data as ScanResult;
    if (res.ok) await get().fetchAll();
    return res;
  },

  updateAttendance: async (attendanceId, fields) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("update_attendance", {
      p_attendance_id: attendanceId,
      p_status: fields.status ?? null,
      p_occurred_at: fields.occurredAt ?? null,
      p_amount: fields.amount === undefined ? null : Math.round(fields.amount),
    });
    if (error || !data) {
      console.error("update_attendance failed:", error?.message);
      return { ok: false, messageKey: "scan.error" };
    }
    const res = data as ScanResult;
    if (res.ok) await get().fetchAll();
    return res;
  },

  deleteAbsencePenalty: async (penaltyId) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("delete_absence_penalty", {
      p_penalty_id: penaltyId,
    });
    if (error || !data) {
      console.error("delete_absence_penalty failed:", error?.message);
      return { ok: false, messageKey: "scan.error" };
    }
    const res = data as ScanResult;
    if (res.ok) await get().fetchAll();
    return res;
  },

  // One tariff per COURSE, not per group: the RPC writes/updates the
  // subscription of every sibling timing (same class + module + teacher) in one
  // transaction, so two groups of the same course can never drift apart.
  setSubscriptionPrice: async (sessionId, price, levelPrice, periodMonths) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("set_subscription_price", {
      p_session_id: sessionId,
      p_price: Math.round(price || 0),
      p_level_price: levelPrice === undefined ? null : Math.round(levelPrice),
      p_period_months: periodMonths === undefined ? null : Math.round(periodMonths),
    });
    if (error || !data) {
      console.error("set_subscription_price failed:", error?.message);
      return { ok: false };
    }
    const res = data as { ok: boolean; groups?: number; created?: number; updated?: number };
    if (res.ok) await get().fetchAll();
    return res;
  },

  deleteSubscriptionPrice: async (sessionId) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("delete_subscription_price", {
      p_session_id: sessionId,
    });
    if (error || !data) {
      console.error("delete_subscription_price failed:", error?.message);
      return { ok: false };
    }
    const res = data as { ok: boolean; deleted?: number };
    if (res.ok) await get().fetchAll();
    return res;
  },

  fetchFreePeriodStats: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("free_period_stats", {
      p_free_period_id: null,
    });
    if (error || !data) {
      // Migration not applied yet, or caller is not staff — no totals to show.
      return [];
    }
    return data as FreePeriodStat[];
  },

  // Automatic weekly-absence billing lives entirely in the process_weekly_absences
  // RPC (enrollment walk, 7-day windows, deduction, absence_penalties + balance_tx
  // rows). It is idempotent + throttled server-side, so calling it on staff load
  // is safe; we only refresh local state when it actually charged something.
  processWeeklyAbsences: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("process_weekly_absences", {});
    if (error || !data) {
      // Table/RPC missing (migration not applied yet) or not authorized — no-op.
      // Le message EST dit : un 400 muet ici a déjà coûté des jours de
      // recherche, alors que PostgREST nomme précisément la colonne ou la
      // fonction qui manque à la base en ligne.
      if (error) {
        console.warn(
          `process_weekly_absences: ${error.message} — la facturation hebdomadaire des absences ` +
            "n'a pas tourné (migration à repasser ?). Le reste de l'écran n'est pas affecté.",
        );
      }
      return { ok: false };
    }
    const res = data as { ok: boolean; charged?: number; students?: number };
    if (res.ok && (res.charged ?? 0) > 0) await get().fetchAll();
    return res;
  },

  settleTeacherPercentage: async (teacherId) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("settle_teacher_percentage", {
      p_teacher_id: teacherId,
    });
    if (error || !data) {
      console.error("settle_teacher_percentage failed:", error?.message);
      return { ok: false, messageKey: "scan.error" };
    }
    const res = data as TeacherSettlement;
    if (res.ok) await get().fetchAll();
    return res;
  },

  // ---- Workers: badge + hourly settlement -----------------------------------
  scanWorkerCard: async (code) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("scan_worker_card", { p_code: code.trim() });
    if (error || !data) {
      // Table/RPC missing (migration not applied) or unknown badge.
      return { ok: false, messageKey: "worker.notFound" };
    }
    const res = data as WorkerScanResult;
    if (res.ok) await get().fetchAll();
    return res;
  },

  freezeOpenWorkerShifts: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("freeze_open_worker_shifts", {});
    if (error || !data) return { ok: false };
    const res = data as { ok: boolean; frozen?: number };
    if (res.ok && (res.frozen ?? 0) > 0) await get().fetchAll();
    return res;
  },

  payWorkerShifts: async (workerId, shiftIds, amount, description) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("pay_worker_shifts", {
      p_worker_id: workerId,
      p_shift_ids: shiftIds,
      p_amount: Math.round(amount),
      p_description: description ?? "",
    });
    if (error || !data) {
      console.error("pay_worker_shifts failed:", error?.message);
      return { ok: false, messageKey: "worker.error" };
    }
    const res = data as { ok: boolean; days?: number; minutes?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  // ---- Workers: manual register, absences, period settlements ---------------
  //
  // Le badge ne suffit pas : un travailleur qui oublie sa carte, un agent de
  // ménage qui n'en a pas, une journée à corriger — tout cela doit pouvoir
  // s'écrire à la main, et valoir exactement autant qu'un pointage.
  setWorkerShift: async ({ workerId, workDate, startAt, endAt, status, notes }) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("set_worker_shift", {
      p_worker_id: workerId,
      p_work_date: workDate,
      p_start_at: startAt ?? null,
      p_end_at: endAt ?? null,
      p_status: status ?? "present",
      p_notes: notes ?? "",
    });
    if (error || !data) {
      console.error("set_worker_shift failed:", error?.message);
      reportWriteFailure("worker_shifts", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "worker.error" };
    }
    const res = data as { ok: boolean; shiftId?: string; minutes?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  endWorkerShift: async (workerId, endAt) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("end_worker_shift", {
      p_worker_id: workerId,
      p_end_at: endAt ?? null,
    });
    if (error || !data) {
      console.error("end_worker_shift failed:", error?.message);
      reportWriteFailure("worker_shifts", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "worker.error" };
    }
    const res = data as { ok: boolean; minutes?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  markWorkerAbsences: async (args = {}) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("mark_worker_absences", {
      p_worker_id: args.workerId ?? null,
      p_from: args.from ?? null,
      p_to: args.to ?? null,
    });
    // Migration pas encore passée : l'écran continue de fonctionner, il ne
    // constate simplement aucune absence automatique.
    if (error || !data) return { ok: false };
    const res = data as { ok: boolean; marked?: number; workers?: number };
    if (res.ok && (res.marked ?? 0) > 0) await get().fetchAll();
    return res;
  },

  resolveWorkerAbsence: async ({ shiftId, cost, description }) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("resolve_worker_absence", {
      p_shift_id: shiftId,
      p_cost: Math.max(0, Math.round(cost || 0)),
      p_description: description ?? "",
    });
    if (error || !data) {
      console.error("resolve_worker_absence failed:", error?.message);
      reportWriteFailure("worker_shifts", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "worker.error" };
    }
    const res = data as { ok: boolean; absenceId?: string; cost?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  payWorkerPeriod: async ({
    workerId,
    method,
    periodKey,
    periodStart,
    periodEnd,
    shiftIds,
    amount,
    description,
    details,
    settleDeductions,
    acompteIds,
    absenceIds,
  }) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("pay_worker_period", {
      p_worker_id: workerId,
      p_method: method,
      p_period_key: periodKey,
      p_period_start: periodStart ?? null,
      p_period_end: periodEnd ?? null,
      p_shift_ids: shiftIds ?? null,
      p_amount: Math.round(amount),
      p_description: description ?? "",
      p_details: details ?? [],
      p_acompte_ids: acompteIds ?? null,
      p_absence_ids: absenceIds ?? null,
      p_settle_deductions: !!settleDeductions,
    });
    if (error || !data) {
      console.error("pay_worker_period failed:", error?.message);
      reportWriteFailure("worker_payments", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "worker.error" };
    }
    const res = data as {
      ok: boolean;
      paymentId?: string;
      days?: number;
      minutes?: number;
      messageKey?: string;
    };
    if (res.ok) await get().fetchAll();
    return res;
  },

  deleteWorkerPayment: async (paymentId) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("delete_worker_payment", {
      p_payment_id: paymentId,
    });
    if (error || !data) {
      console.error("delete_worker_payment failed:", error?.message);
      reportWriteFailure("worker_payments", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "worker.error" };
    }
    const res = data as { ok: boolean; restored?: number; amount?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  // ---- Séances particulières -------------------------------------------------
  // Le rendez-vous, ses modules et son encaissement partent ensemble : une
  // séance à moitié écrite (les modules sans la séance, l'argent sans la
  // séance) n'aurait aucun sens et laisserait une dette orpheline.
  createPrivateRequest: async (payload) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_private_request", {
      p_payload: payload,
    });
    if (error || !data) {
      console.error("create_private_request failed:", error?.message);
      reportWriteFailure("private_sessions", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "particulier.error" };
    }
    const res = data as { ok: boolean; id?: string; students?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  updatePrivateRequest: async (id, payload) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("update_private_request", {
      p_id: id,
      p_payload: payload,
    });
    if (error || !data) {
      console.error("update_private_request failed:", error?.message);
      reportWriteFailure("private_sessions", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "particulier.error" };
    }
    const res = data as { ok: boolean; students?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  programPrivateSession: async (id, payload) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("program_private_session", {
      p_id: id,
      p_payload: payload,
    });
    if (error || !data) {
      console.error("program_private_session failed:", error?.message);
      reportWriteFailure("private_session_modules", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "particulier.error" };
    }
    const res = data as {
      ok: boolean;
      total?: number;
      scheduledAt?: string;
      messageKey?: string;
    };
    if (res.ok) await get().fetchAll();
    return res;
  },

  completePrivateSession: async (id, payload) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("complete_private_session", {
      p_id: id,
      p_payload: payload,
    });
    if (error || !data) {
      console.error("complete_private_session failed:", error?.message);
      reportWriteFailure("private_sessions", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "particulier.error" };
    }
    const res = data as {
      ok: boolean;
      total?: number;
      paid?: number;
      due?: number;
      teacherShare?: number;
      schoolShare?: number;
      teacherPercentage?: number;
      schoolPercentage?: number;
      teachersPaid?: number;
      messageKey?: string;
    };
    if (res.ok) await get().fetchAll();
    return res;
  },

  createPrivateSession: async (payload) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_private_session", {
      p_payload: payload,
    });
    if (error || !data) {
      console.error("create_private_session failed:", error?.message);
      reportWriteFailure("private_sessions", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "particulier.error" };
    }
    const res = data as { ok: boolean; id?: string; total?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  updatePrivateSession: async (id, payload) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("update_private_session", {
      p_id: id,
      p_payload: payload,
    });
    if (error || !data) {
      console.error("update_private_session failed:", error?.message);
      reportWriteFailure("private_sessions", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "particulier.error" };
    }
    const res = data as { ok: boolean; total?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  payPrivateSession: async (id, amount) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("pay_private_session", {
      p_id: id,
      p_amount: Math.round(amount),
    });
    if (error || !data) {
      console.error("pay_private_session failed:", error?.message);
      reportWriteFailure("private_sessions", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "particulier.error" };
    }
    const res = data as { ok: boolean; paid?: number; due?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  payPrivateSessionTeacher: async (moduleRowId, amount) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("pay_private_session_teacher", {
      p_module_row_id: moduleRowId,
      p_amount: amount === undefined ? null : Math.round(amount),
    });
    if (error || !data) {
      console.error("pay_private_session_teacher failed:", error?.message);
      reportWriteFailure("private_session_modules", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "particulier.error" };
    }
    const res = data as { ok: boolean; amount?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  setPrivateSessionStatus: async (id, status) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("set_private_session_status", {
      p_id: id,
      p_status: status,
    });
    if (error || !data) {
      console.error("set_private_session_status failed:", error?.message);
      reportWriteFailure("private_sessions", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "particulier.error" };
    }
    const res = data as { ok: boolean; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  reschedulePrivateSession: async (id, scheduledAt) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("reschedule_private_session", {
      p_id: id,
      p_scheduled_at: scheduledAt,
    });
    if (error || !data) {
      console.error("reschedule_private_session failed:", error?.message);
      reportWriteFailure("private_sessions", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "particulier.error" };
    }
    const res = data as { ok: boolean; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  deletePrivateSession: async (id, force) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("delete_private_session", {
      p_id: id,
      p_force: !!force,
    });
    if (error || !data) {
      console.error("delete_private_session failed:", error?.message);
      reportWriteFailure("private_sessions", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "particulier.error" };
    }
    const res = data as { ok: boolean; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  payTeacherSessions: async ({
    teacherId,
    keys,
    amount,
    method,
    percentage,
    details,
    description,
    settleDeductions,
    acompteIds,
    absenceIds,
    independentIds,
  }) => {
    const supabase = createClient();
    const args: Record<string, unknown> = {
      p_teacher_id: teacherId,
      p_keys: keys,
      p_amount: Math.round(amount),
      p_method: method,
      p_percentage: percentage ?? null,
      p_details: details ?? [],
      p_description: description ?? "",
      p_acompte_ids: acompteIds ?? null,
      p_absence_ids: absenceIds ?? null,
      p_settle_deductions: !!settleDeductions,
      p_independent_ids: independentIds ?? null,
    };
    let { data, error } = await supabase.rpc("pay_teacher_sessions", args);
    // Base pas encore migrée : le paramètre est inconnu, donc TOUT le règlement
    // échouait. On réessaie sans lui — les séances libres à pourcentage dédié
    // ne seront pas soldées, mais le versement, lui, est enregistré.
    if (error && /p_independent_ids|does not exist|Could not find/i.test(error.message)) {
      delete args.p_independent_ids;
      ({ data, error } = await supabase.rpc("pay_teacher_sessions", args));
    }
    if (error || !data) {
      console.error("pay_teacher_sessions failed:", error?.message);
      return { ok: false, messageKey: "pay.error" };
    }
    const res = data as { ok: boolean; paymentId?: string; sessions?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  deleteUnpaidTeacherSessions: async (teacherId, ids) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("delete_unpaid_teacher_sessions", {
      p_teacher_id: teacherId,
      p_ids: ids,
    });
    if (error || !data) {
      console.error("delete_unpaid_teacher_sessions failed:", error?.message);
      reportWriteFailure("unpaid_teacher_sessions", error?.message ?? "RPC absente");
      return { ok: false };
    }
    const res = data as { ok: boolean; deleted?: number; amount?: number };
    if (res.ok) await get().fetchAll();
    return res;
  },

  updateTeacherPayment: async (paymentId, fields) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("update_teacher_payment", {
      p_payment_id: paymentId,
      p_amount: fields.amount === undefined ? null : Math.round(fields.amount),
      p_method: fields.method ?? null,
      p_percentage: fields.percentage === undefined ? null : Math.round(fields.percentage),
      p_description: fields.description ?? null,
      p_paid_at: fields.paidAt ?? null,
    });
    if (error || !data) {
      console.error("update_teacher_payment failed:", error?.message);
      reportWriteFailure("teacher_payments", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "pay.error" };
    }
    const res = data as { ok: boolean; amount?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  deleteTeacherPayment: async (paymentId) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("delete_teacher_payment", {
      p_payment_id: paymentId,
    });
    if (error || !data) {
      console.error("delete_teacher_payment failed:", error?.message);
      reportWriteFailure("teacher_payments", error?.message ?? "RPC absente");
      return { ok: false, messageKey: "pay.error" };
    }
    const res = data as { ok: boolean; restored?: number; amount?: number; messageKey?: string };
    if (res.ok) await get().fetchAll();
    return res;
  },

  repriceSession: async ({ sessionId, price, levelPrice, periodMonths, from }) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("reprice_session", {
      p_session_id: sessionId,
      p_price: Math.round(price || 0),
      p_level_price: levelPrice === undefined ? null : Math.round(levelPrice),
      p_period_months: periodMonths === undefined ? null : Math.round(periodMonths),
      p_from: from ?? null,
    });
    if (error || !data) {
      // Migration pas encore passée : on retombe sur l'ancien chemin, qui écrit
      // au moins le tarif — plutôt que de laisser l'écran croire à un échec.
      console.error("reprice_session failed:", error?.message);
      const fallback = await get().setSubscriptionPrice(sessionId, price, levelPrice, periodMonths);
      return { ok: fallback.ok, groups: fallback.groups };
    }
    const res = data as {
      ok: boolean;
      groups?: number;
      repriced?: number;
      charged?: number;
      refunded?: number;
      teacherDues?: number;
      teacherDuesRemoved?: number;
    };
    if (res.ok) await get().fetchAll();
    return res;
  },

  applyOfferedRules: async (args = {}) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("apply_offered_rules", {
      p_from: args.from ?? null,
      p_to: args.to ?? null,
      p_session_id: args.sessionId ?? null,
    });
    if (error || !data) {
      // Migration pas encore passée : la gratuité s'applique quand même aux
      // présences À VENIR, seules celles déjà pointées restent facturées.
      console.error("apply_offered_rules failed:", error?.message);
      return { ok: false };
    }
    const res = data as {
      ok: boolean;
      presences?: number;
      refunded?: number;
      stamped?: number;
      duesRemoved?: number;
      duesUpdated?: number;
    };
    if (res.ok) await get().fetchAll();
    return res;
  },

  setStudentPassword: async (studentId, password) => {
    const supabase = createClient();
    const row = { student_id: studentId, password, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("student_credentials").upsert(row, { onConflict: "student_id" });
    if (error) {
      console.error("Failed to store the student password:", error.message);
      return;
    }
    set((state) => ({
      studentCredentials: [
        ...state.studentCredentials.filter((c) => c.studentId !== studentId),
        { studentId, password, updatedAt: row.updated_at },
      ],
    }));
  },

  setModuleAbsenceRule: async (moduleId, enabled, daysWindow = 7) => {
    const supabase = createClient();
    const row = { module_id: moduleId, enabled, days_window: daysWindow };
    const { error } = await supabase.from("module_absence_rules").upsert(row, { onConflict: "module_id" });
    if (error) {
      console.error("Failed to save the module absence rule:", error.message);
      return;
    }
    set((state) => ({
      moduleAbsenceRules: [
        ...state.moduleAbsenceRules.filter((r) => r.moduleId !== moduleId),
        { moduleId, enabled, daysWindow },
      ],
    }));
  },

  addBalance: async (studentId, amount, description, settleRegistration) => {
    const supabase = createClient();
    const { error } = await supabase.rpc("add_student_balance", {
      p_student_id: studentId,
      p_amount: amount,
      p_description: description,
      p_settle_registration: !!settleRegistration,
    });
    if (error) {
      console.error("add_student_balance failed:", error.message);
      return { ok: false, error: error.message };
    }
    await get().fetchAll();
    return { ok: true };
  },

  // Le solde ne s'écrit JAMAIS depuis le navigateur. Un `updateItem` sur
  // `students.balance` calcule une valeur absolue à partir de la copie locale
  // et écrase tout ce que le serveur a débité entre-temps (un badge à
  // l'entrée, un appel fait par l'enseignant) : la présence et sa ligne
  // d'historique restaient, le débit sur le solde disparaissait. Ces trois RPC
  // sont le seul chemin.
  chargeStudent: async (studentId, amount, description, moduleId) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("charge_student", {
      p_student_id: studentId,
      p_amount: Math.round(amount),
      p_description: description,
      p_module_id: moduleId ?? null,
    });
    if (error) {
      console.error("charge_student failed:", error.message);
      return { ok: false, error: error.message };
    }
    await get().fetchAll();
    const res = data as { newBalance?: number } | null;
    return { ok: true, newBalance: res?.newBalance };
  },

  settleRegistrationFee: async (studentId, fee, label) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("settle_registration_fee", {
      p_student_id: studentId,
      p_fee: fee === undefined ? null : Math.round(fee),
      p_label: label ?? null,
    });
    if (error) {
      console.error("settle_registration_fee failed:", error.message);
      return { ok: false, error: error.message };
    }
    await get().fetchAll();
    const res = data as { newBalance?: number } | null;
    return { ok: true, newBalance: res?.newBalance };
  },

  // Même règlement, autre porte : l'école encaisse les frais d'inscription en
  // espèces. Le solde n'est pas touché (les deux lignes d'historique
  // s'annulent), la caisse du jour, elle, voit passer l'argent.
  payRegistrationFeeCash: async (studentId, fee, label) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("pay_registration_fee_cash", {
      p_student_id: studentId,
      p_fee: fee === undefined ? null : Math.round(fee),
      p_label: label ?? null,
    });
    if (error) {
      console.error("pay_registration_fee_cash failed:", error.message);
      return { ok: false, error: error.message };
    }
    await get().fetchAll();
    const res = data as { fee?: number; newBalance?: number } | null;
    return { ok: true, fee: res?.fee, newBalance: res?.newBalance };
  },

  payDebt: async (studentId, amount) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("pay_student_debt", {
      p_student_id: studentId,
      p_amount: Math.round(amount),
    });
    if (error) {
      console.error("pay_student_debt failed:", error.message);
      return { ok: false, error: error.message };
    }
    await get().fetchAll();
    const res = data as
      | { registrationPaid?: number; debtPaid?: number; credited?: number }
      | null;
    return {
      ok: true,
      registrationPaid: res?.registrationPaid,
      debtPaid: res?.debtPaid,
      credited: res?.credited,
    };
  },

  // Editing/deleting a transaction has to move students.balance by exactly the
  // same amount, so both live in one server-side RPC — a client-side pair of
  // writes could leave the balance out of sync with its own history.
  updateBalanceTx: async (txId, fields) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("update_balance_tx", {
      p_tx_id: txId,
      p_amount: Math.round(fields.amount),
      p_description: fields.description ?? null,
      p_date: fields.date ?? null,
      p_type: fields.type ?? null,
      p_adjust_cash: fields.adjustCash ?? true,
    });
    if (error || !data) {
      console.error("update_balance_tx failed:", error?.message);
      return { ok: false, error: error?.message };
    }
    const res = data as BalanceTxResult;
    if (res.ok) await get().fetchAll();
    return res;
  },

  deleteBalanceTx: async (txId, adjustCash = true) => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("delete_balance_tx", {
      p_tx_id: txId,
      p_adjust_cash: adjustCash,
    });
    if (error || !data) {
      console.error("delete_balance_tx failed:", error?.message);
      return { ok: false, error: error?.message };
    }
    const res = data as BalanceTxResult;
    if (res.ok) await get().fetchAll();
    return res;
  },

  // The row is added locally first (so the screen answers instantly), then
  // written. If the write is REFUSED, the optimistic row is taken back out:
  // leaving it on screen was the whole reason a créneau or a subscription
  // looked saved and then vanished on the next refetch.
  push: async (key, item) => {
    set((state) => ({
      [key]: [...(state[key] as unknown[]), item],
    }) as Partial<DataStore>);

    // auth-linked rows are created via /api/admin/users
    if (key === "school" || AUTH_LINKED_KEYS.has(key as string)) return true;

    const cfg = TABLES[key as Exclude<keyof Database, "school">];
    const supabase = createClient();
    const error = await writeWithSchemaFallback(cfg.toRow(item), (row) =>
      supabase.from(cfg.table).insert(row),
    );
    if (!error) return true;

    console.error(`Failed to insert into ${cfg.table}:`, error);
    // Rollback: what the database refused must not linger on screen.
    const id = (item as { id?: string }).id;
    if (id !== undefined) {
      set((state) => ({
        [key]: (state[key] as Array<{ id: string }>).filter((x) => x.id !== id),
      }) as Partial<DataStore>);
    }
    reportWriteFailure(cfg.table, error);
    return false;
  },

  updateItem: async (key, id, updatedFields) => {
    set((state) => ({
      [key]: (state[key] as Array<{ id: string }>).map((x) =>
        x.id === id ? { ...x, ...updatedFields } : x,
      ),
    }) as Partial<DataStore>);

    if (key === "school") return true;

    const supabase = createClient();

    if (key === "students" && updatedFields && "subscriptionIds" in updatedFields) {
      const fields = updatedFields as Partial<Student>;
      const ids = fields.subscriptionIds ?? [];
      const previous = get().students.find((s) => s.id === id);
      // Keep existing formation dates / reductions when the caller only changes
      // the id list (e.g. unsubscribing from one module).
      const dates = fields.subscriptionDates ?? previous?.subscriptionDates ?? {};
      const discounts = fields.subscriptionDiscounts ?? previous?.subscriptionDiscounts ?? {};
      const hasDates = ids.some(
        (sid) => dates[sid]?.subscribedAt || dates[sid]?.startDate || dates[sid]?.expiryDate,
      );
      const hasDiscounts = ids.some((sid) => (discounts[sid]?.value ?? 0) > 0);

      // Les inscriptions sont réécrites en bloc (delete puis insert). Si
      // l'insert échoue en silence, l'élève ressort SANS AUCUNE inscription au
      // rechargement suivant, alors que l'écran affichait encore les siennes.
      // On ne supprime donc l'ancien jeu que si le nouveau passe, et un échec
      // est annoncé au lieu d'être avalé.
      void (async () => {
        const rows = ids.map((subscription_id) => {
          // Only send the optional columns when they carry a value, so
          // cours-only enrollments still work before the migrations.
          const row: Record<string, unknown> = { student_id: id, subscription_id };
          if (hasDates) {
            row.subscribed_at = dates[subscription_id]?.subscribedAt ?? null;
            row.start_date = dates[subscription_id]?.startDate ?? null;
            row.expiry_date = dates[subscription_id]?.expiryDate ?? null;
          }
          if (hasDiscounts) {
            const d = discounts[subscription_id];
            row.discount_type = d && d.value > 0 ? d.type : null;
            row.discount_value = d && d.value > 0 ? d.value : 0;
          }
          return row;
        });

        const { error: delError } = await supabase
          .from("student_subscriptions")
          .delete()
          .eq("student_id", id);
        if (delError) {
          console.error("Failed to clear student_subscriptions:", delError.message);
          reportWriteFailure("student_subscriptions", delError.message);
          return;
        }

        if (rows.length === 0) return;

        // Les colonnes optionnelles (dates, réductions) peuvent manquer si une
        // migration n'est pas passée : on réessaie sans elles plutôt que de
        // perdre les inscriptions.
        let payload = rows;
        for (let attempt = 0; attempt <= 6; attempt++) {
          const { error } = await supabase.from("student_subscriptions").insert(payload);
          if (!error) return;
          const missing = unknownColumnOf(error.message);
          if (!missing || !(missing in payload[0])) {
            console.error("Failed to sync student_subscriptions:", error.message);
            reportWriteFailure("student_subscriptions", error.message);
            return;
          }
          console.warn(
            `[db] colonne « ${missing} » absente de student_subscriptions : inscriptions réécrites sans elle.`,
          );
          payload = payload.map((r) => {
            const next = { ...r };
            delete next[missing];
            return next;
          });
        }
      })();
    }

    const cfg = TABLES[key as Exclude<keyof Database, "school">];
    const row = cfg.toRow(updatedFields);
    if (Object.keys(row).length === 0) return true;
    const error = await writeWithSchemaFallback(row, (patch) =>
      supabase.from(cfg.table).update(patch).eq("id", id),
    );
    if (error) {
      console.error(`Failed to update ${cfg.table}:`, error);
      reportWriteFailure(cfg.table, error);
      return false;
    }
    return true;
  },

  deleteFrom: (key, id) => {
    set((state) => ({
      [key]: (state[key] as Array<{ id: string }>).filter((x) => x.id !== id),
    }) as Partial<DataStore>);

    if (key === "school") return;

    if (AUTH_LINKED_KEYS.has(key as string)) {
      fetch(`/api/admin/users/${id}`, { method: "DELETE" }).then(async (res) => {
        if (!res.ok) console.error(`Failed to delete user ${id}:`, await res.text());
      });
      return;
    }

    const cfg = TABLES[key as Exclude<keyof Database, "school">];
    const supabase = createClient();
    supabase.from(cfg.table).delete().eq("id", id).then(({ error }) => {
      if (error) console.error(`Failed to delete from ${cfg.table}:`, error.message);
    });
  },

  cashMove: (type, amount, description, date) => {
    let isoDate = new Date().toISOString();
    if (date) {
      isoDate = date.length === 10 ? `${date}T${new Date().toISOString().substring(11)}` : new Date(date).toISOString();
    }
    const signedAmount = type === "withdraw" ? -Math.abs(amount) : Math.abs(amount);
    const item: CashTransaction = { id: uid("csh"), type, amount: signedAmount, date: isoDate, description };

    set((state) => ({ cash: [...state.cash, item] }));

    const supabase = createClient();
    supabase.from("cash_transactions").insert(cashMapper.toRow(item)).then(({ error }) => {
      if (error) console.error("Failed to insert cash transaction:", error.message);
    });
  },

  updateSchool: async (updatedFields) => {
    set((state) => ({ school: { ...state.school, ...updatedFields } }));

    const schoolId = get().school.id;
    if (!schoolId) return { ok: false, error: "école introuvable" };
    const supabase = createClient();
    const { error } = await supabase
      .from("school")
      .update(schoolMapper.toRow(updatedFields))
      .eq("id", schoolId);
    if (error) {
      console.error("Failed to update school:", error.message);
      // The optimistic state now disagrees with the database: put it back.
      await get().fetchSchool();
      return { ok: false, error: error.message };
    }
    return { ok: true };
  },

  restoreState: (dump) => set(() => ({ ...dump })),

  reset: () => {
    get().fetchAll();
  },
}));
