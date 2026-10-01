"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/lib/store/toast";
import {
  applyRowDelta,
  hashString,
  reconcileRows,
  sameValue,
  uuidPartitions,
} from "@/lib/store/merge";
import { clearSnapshots, readSnapshot, writeSnapshot } from "@/lib/store/snapshot";
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
  return { fromRow, toRow, fields: fields as readonly (readonly [string, string])[] };
}

interface TableConfig {
  table: string;
  select: string;
  /**
   * Le champ (côté application) qui identifie une ligne — `id` pour presque
   * toutes les tables. C'est lui qui permet de fusionner une relecture ou un
   * delta avec ce qui est déjà affiché, ligne par ligne.
   */
  key?: string;
  /** Les colonnes lues : elles datent le format de la copie locale. */
  fields?: readonly (readonly [string, string])[];
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
    key: "studentId",
    ...studentCredentialsMapper,
  },
  moduleAbsenceRules: {
    table: "module_absence_rules",
    select: "*",
    orderBy: "module_id",
    key: "moduleId",
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
    fields: [
      ...studentsBaseMapper.fields,
      ["subscriptionIds", "student_subscriptions.subscription_id"],
      ["subscriptionDates", "student_subscriptions.dates"],
      ["subscriptionDiscounts", "student_subscriptions.discount"],
    ],
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
    fields: [...parentsBaseMapper.fields, ["childIds", "students.id"]],
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
//
// PAR CLÉ, ET PLUS PAR DÉCALAGE
// -----------------------------
// La page suivante commence APRÈS la dernière clé reçue (`id > dernière`), et
// non « à partir de la 500e ligne ». Un décalage bouge dès qu'une ligne est
// créée ou supprimée pendant la lecture : une présence annulée au guichet
// pendant le chargement faisait sauter une ligne voisine, perdue jusqu'au
// chargement suivant. Une clé, elle, ne bouge pas.
//
// ET EN PARALLÈLE SUR LES GROSSES TABLES
// --------------------------------------
// Les clés sont des UUID, répartis uniformément : une grosse table se découpe
// en tranches d'UUID contiguës (`0…` à `3…`, `4…` à `7…`, …) lues en même
// temps, chacune page par page. Aucune ligne ne peut tomber entre deux
// tranches, et 3 000 présences arrivent en deux allers-retours au lieu de six.

/** Taille de page. Sous le plafond de PostgREST, pour que « moins d'une page
 *  reçue » signifie toujours « fin de table » et jamais « plafond atteint ». */
const PAGE_SIZE = 500;

/** Garde-fou : une table qui dépasserait ce total signale une anomalie plutôt
 *  que de boucler indéfiniment (et de saturer la mémoire du navigateur). */
const MAX_ROWS = 200_000;

/** Tranches lues en parallèle, au plus, sur une grosse table. */
const MAX_PARTITIONS = 8;

export type FetchOutcome =
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

type PageResult = { data: unknown[] | null; error: { message: string } | null };

/** Une requête de page : ce que `fetchWholeTable` demande au constructeur de
 *  requêtes Supabase — de quoi le tester sans base. */
export interface PageQuery extends PromiseLike<PageResult> {
  gt(column: string, value: string): PageQuery;
  gte(column: string, value: string): PageQuery;
  lt(column: string, value: string): PageQuery;
  limit(count: number): PageQuery;
}

/** Le strict minimum que `fetchWholeTable` demande à un client Supabase. */
export interface PagedSource {
  from(table: string): {
    select(columns: string): {
      order(column: string, opts: { ascending: boolean }): PageQuery;
    };
  };
}

/** Lit une tranche [from, to[ de la table, page par page, dans `rows`.
 *  Rend `null` si tout est passé, sinon le message d'erreur. */
async function readKeyRange(
  supabase: PagedSource,
  cfg: Pick<TableConfig, "table" | "select">,
  orderColumn: string,
  bounds: { from?: string; to?: string },
  rows: Record<string, unknown>[],
): Promise<string | null> {
  let after: string | undefined;
  for (let read = 0; read < MAX_ROWS; read += PAGE_SIZE) {
    // Sans ce tri, deux pages peuvent se recouvrir ou s'ignorer, et la table
    // lue n'est plus la table stockée.
    let query = supabase.from(cfg.table).select(cfg.select).order(orderColumn, { ascending: true });
    if (bounds.from !== undefined) query = query.gte(orderColumn, bounds.from);
    if (bounds.to !== undefined) query = query.lt(orderColumn, bounds.to);
    if (after !== undefined) query = query.gt(orderColumn, after);

    const { data, error } = await query.limit(PAGE_SIZE);
    if (error || !data) return error?.message ?? "no data";

    const page = data as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return null;

    const last = page[page.length - 1]?.[orderColumn];
    if (typeof last !== "string" && typeof last !== "number") {
      return `clé « ${orderColumn} » absente des lignes de ${cfg.table}`;
    }
    after = String(last);
  }
  console.error(
    `[db] ${cfg.table} dépasse ${MAX_ROWS} lignes : lecture interrompue. ` +
      "Les écrans qui recoupent cette table seront désactivés plutôt que faux.",
  );
  return `plus de ${MAX_ROWS} lignes`;
}

/**
 * Toutes les lignes d'une table, page par page.
 *
 * `sizeHint` : le nombre de lignes attendu (celui de la lecture précédente).
 * Au-delà d'une page, la table est lue par tranches d'UUID en parallèle.
 *
 * Un échec de page ne rend PAS un résultat partiel : il rend `ok: false`, et
 * l'appelant conserve alors ce qu'il avait déjà. Une demi-table est pire que
 * pas de table du tout — c'est précisément elle qui faisait inventer des
 * dettes.
 */
export async function fetchWholeTable(
  supabase: PagedSource,
  cfg: Pick<TableConfig, "table" | "select" | "orderBy">,
  opts: { sizeHint?: number } = {},
): Promise<FetchOutcome> {
  // Tri sur la clé primaire — `id` pour la plupart des tables, sa vraie clé
  // pour celles qui n'en ont pas (voir `TableConfig.orderBy`).
  const orderColumn = cfg.orderBy ?? "id";
  const hint = Math.max(0, Math.floor(opts.sizeHint ?? 0));
  const partitions =
    hint > PAGE_SIZE
      ? uuidPartitions(Math.min(MAX_PARTITIONS, Math.floor(hint / PAGE_SIZE)))
      : [{}];

  const results = await Promise.all(
    partitions.map(async (bounds) => {
      const rows: Record<string, unknown>[] = [];
      const error = await readKeyRange(supabase, cfg, orderColumn, bounds, rows);
      return { rows, error };
    }),
  );

  const failed = results.find((r) => r.error !== null);
  if (failed) return { ok: false, error: failed.error as string };
  // Les tranches se suivent dans l'ordre des clés : la table sort triée.
  return { ok: true, rows: results.flatMap((r) => r.rows) };
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
  /** Un chargement COMPLET est en cours (premier chargement, filet de
   *  sécurité périodique) — de quoi afficher un indicateur discret. */
  syncing: boolean;
  fetchSchool: () => Promise<void>;
  /** Relit TOUTES les tables (en conservant les objets inchangés). */
  fetchAll: () => Promise<void>;
  /**
   * Met l'écran à jour après une écriture : seulement ce qui a changé depuis
   * la dernière synchronisation, en une requête (`sync_changes`). Sans la
   * migration 20261001, retombe sur une relecture complète.
   *
   * Une fois la promesse résolue, le store contient l'écriture qui l'a
   * précédée : c'est ce qu'attendent les écrans qui relisent une fiche juste
   * après un règlement.
   */
  refresh: () => Promise<void>;
  /** Synchronisation de fond (minuterie, retour sur l'onglet) : ne fait rien
   *  si la précédente date de moins de quelques secondes. */
  backgroundSync: () => Promise<void>;
  /** Ouvre la session de données d'un compte : copie locale si elle existe,
   *  puis delta ; sinon chargement complet. */
  start: (userId: string) => Promise<void>;
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
  /** Un tarif d'inscription vient de changer : les élèves qui doivent ENCORE
   *  l'ancien montant, en entier, passent au nouveau. Un reste partiel ou un
   *  frais réglé n'est jamais touché. */
  repriceRegistrationDues: (
    fromAmount: number,
    toAmount: number,
  ) => Promise<{ ok: boolean; count?: number; error?: string }>;
  restoreState: (dump: Partial<Database>) => void;
  reset: () => void;
}

export type DataStore = Database & DataActions;

// =============================================================================
// Synchronisation : relire seulement ce qui a changé
// =============================================================================
//
// POURQUOI
// --------
// Chaque écriture (un scan, un versement, un pointage) se terminait par
// `fetchAll()` : les 38 tables relues en entier, pour n'en garder que les deux
// ou trois lignes qui venaient de bouger. Sur une école qui a quelques mois
// d'historique, c'était plusieurs mégaoctets par clic — et le clic attendait.
//
// COMMENT
// -------
// La base date chaque ligne (`updated_at`) et garde la trace des suppressions
// (migration 20261001). `sync_changes(curseur)` rend, en UNE requête, ce qui a
// changé depuis la dernière synchronisation : le store le fusionne ligne par
// ligne, et une ligne inchangée garde son objet (rien à redessiner).
//
// Sans la migration, rien ne casse : `refresh()` retombe sur la relecture
// complète d'avant — plus rapide qu'avant (lecture parallèle, objets
// conservés), mais complète.

type TableKey = keyof typeof TABLES;
const TABLE_KEYS = Object.keys(TABLES) as TableKey[];

/** Nom de table Postgres -> clé du store (`reception_staff` -> `reception`). */
const KEY_OF_TABLE = new Map<string, TableKey>(TABLE_KEYS.map((k) => [TABLES[k].table, k]));

/** La clé d'une ligne affichée (`id`, ou la référence qui sert de clé). */
const rowKeyFns = new Map<TableKey, (row: unknown) => string>(
  TABLE_KEYS.map((k) => {
    const field = TABLES[k].key ?? "id";
    return [k, (row: unknown) => String((row as Record<string, unknown>)[field])];
  }),
);
const rowKeyOf = (key: TableKey) => rowKeyFns.get(key) as (row: unknown) => string;

/** Le curseur : l'heure du SERVEUR jusqu'à laquelle le store est à jour.
 *  `null` = inconnu (premier chargement pas fini, ou migration absente). */
let syncCursor: string | null = null;
/** La fonction `sync_changes` existe-t-elle ? `null` = pas encore su. */
let deltaSupported: boolean | null = null;
let lastProbeAt = 0;
let lastFullLoadAt = 0;
let lastSyncAt = 0;
/** Dernière écriture de la ligne `school` depuis ce poste (ms). Une lecture de
 *  l'école lancée AVANT n'a pas le droit d'écraser ce qui vient d'être saisi :
 *  elle rapporterait l'ancien tarif d'inscription. */
let schoolWrittenAt = 0;
/** Le compte dont le store contient les données. */
let ownerId: string | null = null;

let fullLoadInFlight: Promise<void> | null = null;
let deltaInFlight: Promise<void> | null = null;
let deltaQueued: Promise<void> | null = null;

// ---- Écritures en cours ------------------------------------------------------
// Une ligne ajoutée ou modifiée à l'écran n'est pas encore en base pendant
// quelques centaines de millisecondes. Une synchronisation qui tomberait dans
// cet intervalle ramènerait l'ANCIENNE version et effacerait ce que l'écran
// vient d'afficher : ces lignes-là sont donc laissées telles quelles jusqu'à
// la fin de leur écriture.
const pendingWrites = new Map<string, number>();
const pendingId = (key: TableKey, rowKey: string) => `${key}:${rowKey}`;
function markPending(key: TableKey, rowKey: string) {
  const id = pendingId(key, rowKey);
  pendingWrites.set(id, (pendingWrites.get(id) ?? 0) + 1);
}
function unmarkPending(key: TableKey, rowKey: string) {
  const id = pendingId(key, rowKey);
  const n = (pendingWrites.get(id) ?? 1) - 1;
  if (n <= 0) pendingWrites.delete(id);
  else pendingWrites.set(id, n);
}
const isPendingIn = (key: TableKey) => (rowKey: string) => pendingWrites.has(pendingId(key, rowKey));

// ---- Taille attendue des tables -------------------------------------------
// Sert à lire les grosses tables en parallèle dès le premier chargement.
const ROW_COUNTS_KEY = "benzaoui-row-counts";
function readRowCounts(): Record<string, number> {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(ROW_COUNTS_KEY) : null;
    return raw ? (JSON.parse(raw) as Record<string, number>) : {};
  } catch {
    return {};
  }
}
function writeRowCounts(counts: Record<string, number>) {
  try {
    localStorage.setItem(ROW_COUNTS_KEY, JSON.stringify(counts));
  } catch {
    /* stockage plein ou interdit : on s'en passe */
  }
}

// ---- Copie locale (IndexedDB) ----------------------------------------------
/** À incrémenter si la FORME d'une ligne change sans que ses colonnes
 *  changent (un calcul de `fromRow`) : les copies existantes sont alors
 *  ignorées et relues. */
const SNAPSHOT_SCHEMA = 1;
const SNAPSHOT_VERSION = hashString(
  JSON.stringify([
    SNAPSHOT_SCHEMA,
    TABLE_KEYS.map((k) => [
      k,
      TABLES[k].table,
      TABLES[k].select,
      TABLES[k].key ?? "id",
      (TABLES[k].fields ?? []).map((f) => `${f[0]}>${f[1]}`),
    ]),
  ]),
);
/** Au-delà, la copie est jugée trop vieille : chargement complet. */
const SNAPSHOT_MAX_AGE_MS = 5 * 24 * 3600 * 1000;
/**
 * Tables JAMAIS écrites sur le disque : les mots de passe du portail élève
 * n'ont rien à faire dans le profil du navigateur. Elles sont relues en
 * entier à chaque ouverture (quelques centaines de lignes).
 */
const SNAPSHOT_EXCLUDED = new Set<TableKey>(["studentCredentials"]);
/** Filet de sécurité : une relecture complète de fond de temps en temps. */
const FULL_RELOAD_EVERY_MS = 30 * 60 * 1000;
/** Deux synchronisations de fond ne se suivent pas à moins de ça. */
const BACKGROUND_MIN_GAP_MS = 5000;

interface StoreSnapshot {
  version: string;
  userId: string;
  cursor: string;
  savedAt: number;
  school: School;
  tables: Partial<Database>;
  complete: Partial<Record<TableKey, boolean>>;
}

let snapshotTimer: ReturnType<typeof setTimeout> | null = null;

/** Enregistre la copie locale un peu plus tard, quand le navigateur est libre. */
function scheduleSnapshotSave() {
  if (typeof window === "undefined" || !ownerId || !syncCursor) return;
  if (snapshotTimer) clearTimeout(snapshotTimer);
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    const run = () => void saveSnapshotNow();
    const idle = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    }).requestIdleCallback;
    if (idle) idle(run, { timeout: 5000 });
    else run();
  }, 2500);
}

async function saveSnapshotNow() {
  const userId = ownerId;
  const cursor = syncCursor;
  if (!userId || !cursor) return;
  // Une écriture pas encore confirmée ne doit pas être figée dans la copie.
  if (pendingWrites.size > 0) {
    scheduleSnapshotSave();
    return;
  }
  const state = useData.getState();
  if (!state.loaded) return;
  const tables: Partial<Database> = {};
  const complete: Partial<Record<TableKey, boolean>> = { ...state.complete };
  for (const key of TABLE_KEYS) {
    if (SNAPSHOT_EXCLUDED.has(key)) {
      delete complete[key];
      continue;
    }
    (tables as Record<string, unknown>)[key] = state[key];
  }
  const snapshot: StoreSnapshot = {
    version: SNAPSHOT_VERSION,
    userId,
    cursor,
    savedAt: Date.now(),
    school: state.school,
    tables,
    complete,
  };
  try {
    await writeSnapshot(userId, snapshot);
  } catch {
    /* quota, navigation privée : l'application fonctionne sans copie */
  }
}

// ---- Relecture différée ------------------------------------------------------
let refreshTimer: ReturnType<typeof setTimeout> | null = null;

/** Après une écriture directe (ajout, modification, suppression), relit la
 *  version serveur de ce qui vient d'être écrit — valeurs par défaut, dates,
 *  déclencheurs. Groupé : dix écritures d'affilée = une seule relecture. */
function scheduleRefresh() {
  // Sans delta, une relecture complète après chaque ajout coûterait plus cher
  // qu'avant : on s'abstient, comme avant.
  if (!syncCursor || deltaSupported !== true) return;
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void useData.getState().refresh();
  }, 400);
}

/** La fonction RPC n'existe pas sur cette base (migration pas encore passée). */
function isMissingFunction(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /could not find the function|does not exist/i.test(error.message ?? "")
  );
}

/** L'heure du serveur, point de départ du prochain delta — ou `null` si la
 *  base ne sait pas encore rendre de delta. */
async function probeServerCursor(): Promise<string | null> {
  if (deltaSupported === false && Date.now() - lastProbeAt < 5 * 60 * 1000) return null;
  lastProbeAt = Date.now();
  const supabase = createClient();
  const { data, error } = await supabase.rpc("sync_changes", { p_since: null });
  if (error || !data) {
    if (isMissingFunction(error)) {
      if (deltaSupported !== false) {
        console.warn(
          "[sync] sync_changes absente : chaque mise à jour relit toute la base. " +
            "Passez supabase/migrations/20261001_fast_sync_and_rls_speed.sql pour l'accélérer.",
        );
      }
      deltaSupported = false;
    }
    return null;
  }
  deltaSupported = true;
  return (data as { now?: string }).now ?? null;
}

interface SyncPayload {
  now?: string;
  tables?: Record<string, Record<string, unknown>[]>;
  deleted?: Array<{ table: string; key: string }>;
}

/** Fusionne un delta dans le store. Rend `true` si une table a changé.
 *  `requestedAt` : quand la lecture est partie — une ligne `school` lue avant
 *  une écriture faite depuis ce poste est périmée et n'est pas appliquée. */
function applySyncPayload(payload: SyncPayload, requestedAt?: number): boolean {
  const state = useData.getState();
  const deletedByTable = new Map<string, Set<string>>();
  for (const d of payload.deleted ?? []) {
    if (!d?.table || d.key === undefined || d.key === null) continue;
    let keys = deletedByTable.get(d.table);
    if (!keys) deletedByTable.set(d.table, (keys = new Set()));
    keys.add(String(d.key));
  }

  const patch: Record<string, unknown> = {};
  const tableNames = new Set<string>([
    ...Object.keys(payload.tables ?? {}),
    ...deletedByTable.keys(),
  ]);

  for (const name of tableNames) {
    const rows = payload.tables?.[name] ?? [];
    if (name === "school") {
      const row = rows[0];
      if (row && !(requestedAt !== undefined && requestedAt < schoolWrittenAt)) {
        const school = schoolMapper.fromRow(row);
        if (!sameValue(school, state.school)) patch.school = school;
      }
      continue;
    }
    const key = KEY_OF_TABLE.get(name);
    if (!key) continue;
    const cfg = TABLES[key];
    const prev = state[key] as unknown[];
    const next = applyRowDelta(
      prev,
      rows.map((r) => cfg.fromRow(r)),
      deletedByTable.get(name) ?? new Set<string>(),
      rowKeyOf(key),
      isPendingIn(key),
    );
    if (next !== prev) patch[key] = next;
  }

  if (Object.keys(patch).length === 0) return false;
  useData.setState(patch as Partial<DataStore>);
  return true;
}

/** Relit ENTIÈREMENT quelques tables — celles que la copie locale ne garde
 *  pas sur le disque (`SNAPSHOT_EXCLUDED`). */
async function loadTablesFully(keys: TableKey[]): Promise<void> {
  if (keys.length === 0) return;
  const supabase = createClient();
  const counts = readRowCounts();
  const results = await Promise.all(
    keys.map(async (key) => {
      const cfg = TABLES[key];
      const page = await fetchWholeTable(supabase, cfg, { sizeHint: counts[cfg.table] ?? 0 });
      return [key, page.ok ? page.rows.map((r) => cfg.fromRow(r)) : null] as const;
    }),
  );
  const state = useData.getState();
  const patch: Record<string, unknown> = {};
  const complete: Partial<Record<TableKey, boolean>> = { ...state.complete };
  for (const [key, rows] of results) {
    if (!rows) {
      complete[key] = false;
      continue;
    }
    complete[key] = true;
    const prev = state[key] as unknown[];
    const next = reconcileRows(prev, rows, rowKeyOf(key), isPendingIn(key));
    if (next !== prev) patch[key] = next;
  }
  if (!sameValue(complete, state.complete)) patch.complete = complete;
  if (Object.keys(patch).length > 0) useData.setState(patch as Partial<DataStore>);
}

async function runDelta(): Promise<void> {
  // Un chargement complet en cours posera un curseur neuf : on l'attend.
  if (fullLoadInFlight) await fullLoadInFlight;

  const cursor = syncCursor;
  if (!cursor) {
    await useData.getState().fetchAll();
    return;
  }

  const supabase = createClient();
  const requestedAt = Date.now();
  const { data, error } = await supabase.rpc("sync_changes", { p_since: cursor });
  if (error || !data) {
    if (isMissingFunction(error)) {
      // La fonction a disparu (base restaurée ?) : retour au mode complet.
      deltaSupported = false;
      syncCursor = null;
      await useData.getState().fetchAll();
    } else {
      // Réseau : le curseur reste où il est, la prochaine synchronisation
      // rattrapera tout ce qui a changé entre-temps.
      console.warn(`[sync] synchronisation reportée : ${error?.message ?? "réponse vide"}`);
    }
    return;
  }

  const payload = data as SyncPayload;
  const changed = applySyncPayload(payload, requestedAt);
  if (payload.now) syncCursor = payload.now;
  lastSyncAt = Date.now();
  if (changed) scheduleSnapshotSave();
}

export const useData = create<DataStore>((set, get) => ({
  ...emptyDatabase(),
  loaded: false,
  complete: {},
  syncing: false,

  fetchSchool: async () => {
    const supabase = createClient();
    const requestedAt = Date.now();
    const { data } = await supabase.from("school").select("*").limit(1).maybeSingle();
    // Une écriture de l'école partie pendant la lecture l'emporte.
    if (requestedAt < schoolWrittenAt) return;
    if (data) {
      const school = schoolMapper.fromRow(data);
      if (!sameValue(school, get().school)) set({ school });
    }
  },

  // A refetch must never DESTROY what the screen already holds. A single table
  // that answers with an error (network blip, RLS, a migration not applied yet)
  // used to be replaced by an empty array — which is what made a subscription
  // just saved "disappear again" a moment later, together with every timing.
  // A failed table now keeps the rows already loaded.
  //
  // Un seul chargement complet à la fois : un second appel attend le premier
  // au lieu d'en lancer un autre en parallèle.
  fetchAll: () => {
    if (fullLoadInFlight) return fullLoadInFlight;
    fullLoadInFlight = (async () => {
      set({ syncing: true });
      try {
        const supabase = createClient();
        // L'heure du serveur AVANT la lecture : ce qui changera pendant la
        // lecture sera repris par le prochain delta, jamais perdu.
        const cursor = await probeServerCursor();
        const counts = readRowCounts();
        const before = get();
        // La ligne `school` n'est pas une table du chargement complet : sans
        // cette relecture, un poste resté ouvert gardait pendant des jours les
        // frais d'inscription lus à son ouverture — et les facturait. Un échec
        // garde la ligne déjà là, comme pour toute autre table.
        get()
          .fetchSchool()
          .catch((err) => console.warn("[sync] école non relue :", err));

        const results = await Promise.all(
          TABLE_KEYS.map(async (key) => {
            const cfg = TABLES[key];
            const sizeHint = Math.max((before[key] as unknown[]).length, counts[cfg.table] ?? 0);
            const page = await fetchWholeTable(supabase, cfg, { sizeHint });
            if (!page.ok) {
              console.error(
                `Failed to load ${cfg.table}: ${page.error} — les lignes déjà chargées sont conservées.`,
              );
              return [key, null] as const;
            }
            return [key, page.rows.map((r) => cfg.fromRow(r))] as const;
          }),
        );

        // Relu APRÈS la lecture : une écriture a pu passer pendant ce temps.
        const state = get();
        const patch: Record<string, unknown> = { loaded: true };
        const complete: Partial<Record<TableKey, boolean>> = {};
        const nextCounts = { ...counts };
        let allOk = true;
        for (const [key, rows] of results) {
          if (!rows) {
            complete[key] = false;
            allOk = false;
            continue;
          }
          complete[key] = true;
          nextCounts[TABLES[key].table] = rows.length;
          const prev = state[key] as unknown[];
          const next = reconcileRows(prev, rows, rowKeyOf(key), isPendingIn(key));
          if (next !== prev) patch[key] = next;
        }
        if (!sameValue(complete, state.complete)) patch.complete = complete;
        writeRowCounts(nextCounts);

        // Le curseur n'avance que si TOUT a été lu : une table manquée garde
        // l'ancien curseur, et le delta suivant la rattrape.
        if (cursor && (allOk || !syncCursor)) syncCursor = cursor;
        lastFullLoadAt = Date.now();
        lastSyncAt = lastFullLoadAt;
        set(patch as Partial<DataStore>);
        scheduleSnapshotSave();
      } finally {
        fullLoadInFlight = null;
        set({ syncing: false });
      }
    })();
    return fullLoadInFlight;
  },

  // Une seule synchronisation à la fois, et au plus une en attente derrière
  // elle : dix écritures rapprochées ne lancent pas dix requêtes. Celle en
  // attente démarre APRÈS la précédente, donc après l'écriture qui l'a
  // demandée — c'est ce qui garantit que l'appelant la voit.
  refresh: () => {
    if (deltaInFlight) {
      if (!deltaQueued) {
        deltaQueued = deltaInFlight.then(() => {
          deltaQueued = null;
          return get().refresh();
        });
      }
      return deltaQueued;
    }
    deltaInFlight = runDelta()
      .catch((err) => {
        console.warn("[sync] échec de la synchronisation :", err);
      })
      .finally(() => {
        deltaInFlight = null;
      });
    return deltaInFlight;
  },

  backgroundSync: async () => {
    if (!ownerId || !get().loaded) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    // Sans delta, pas de relecture de fond : ce serait toute la base toutes
    // les 30 secondes. Les écritures, elles, continuent de rafraîchir.
    if (!syncCursor || deltaSupported !== true) return;
    if (Date.now() - lastSyncAt < BACKGROUND_MIN_GAP_MS) return;
    // Filet de sécurité : de temps en temps, une relecture complète (qui ne
    // redessine rien si rien n'a changé).
    if (Date.now() - lastFullLoadAt > FULL_RELOAD_EVERY_MS) {
      await get().fetchAll();
      return;
    }
    await get().refresh();
  },

  start: async (userId) => {
    // Même compte, données déjà là (retour sur l'onglet, remontage) : un delta.
    if (ownerId === userId && get().loaded) {
      await get().refresh();
      return;
    }
    ownerId = userId;
    syncCursor = null;

    const snapshot = await readSnapshot<StoreSnapshot>(userId);
    // L'utilisateur a pu changer pendant la lecture de la copie.
    if (ownerId !== userId) return;

    const usable =
      snapshot &&
      snapshot.version === SNAPSHOT_VERSION &&
      snapshot.userId === userId &&
      typeof snapshot.cursor === "string" &&
      Date.now() - snapshot.savedAt < SNAPSHOT_MAX_AGE_MS;

    if (usable) {
      const patch: Record<string, unknown> = { loaded: true, complete: snapshot.complete ?? {} };
      for (const key of TABLE_KEYS) {
        if (SNAPSHOT_EXCLUDED.has(key)) continue;
        const rows = snapshot.tables?.[key];
        if (Array.isArray(rows)) patch[key] = rows;
      }
      if (snapshot.school?.id && !get().school.id) patch.school = snapshot.school;
      set(patch as Partial<DataStore>);
      syncCursor = snapshot.cursor;
      deltaSupported = true;
      // Dernier chargement complet inconnu : le filet de sécurité passera
      // dans FULL_RELOAD_EVERY_MS.
      lastFullLoadAt = Date.now();
      // Ce qui a changé depuis la copie, et ce que la copie ne garde pas.
      await Promise.all([get().refresh(), loadTablesFully([...SNAPSHOT_EXCLUDED])]);
      return;
    }

    await get().fetchAll();
  },

  clear: () => {
    ownerId = null;
    syncCursor = null;
    pendingWrites.clear();
    if (snapshotTimer) {
      clearTimeout(snapshotTimer);
      snapshotTimer = null;
    }
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    // Déconnexion : aucune copie des données ne doit rester sur ce poste.
    void clearSnapshots();
    set({ ...emptyDatabase(), school: get().school, loaded: false, complete: {} });
  },

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
    if (res.ok && res.messageKey !== "scan.alreadyPresent") await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok && (res.charged ?? 0) > 0) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
    return res;
  },

  freezeOpenWorkerShifts: async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("freeze_open_worker_shifts", {});
    if (error || !data) return { ok: false };
    const res = data as { ok: boolean; frozen?: number };
    if (res.ok && (res.frozen ?? 0) > 0) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok && (res.marked ?? 0) > 0) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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
    scheduleRefresh();
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
    scheduleRefresh();
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
    await get().refresh();
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
    await get().refresh();
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
    await get().refresh();
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
    await get().refresh();
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
    await get().refresh();
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
    if (res.ok) await get().refresh();
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
    if (res.ok) await get().refresh();
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

    // auth-linked rows are created via /api/admin/users — the server row
    // already exists; the next sync brings its canonical version.
    if (key === "school" || AUTH_LINKED_KEYS.has(key as string)) {
      scheduleRefresh();
      return true;
    }

    const tableKey = key as TableKey;
    const cfg = TABLES[tableKey];
    const rowKey = rowKeyOf(tableKey)(item);
    markPending(tableKey, rowKey);
    try {
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
    } finally {
      unmarkPending(tableKey, rowKey);
      scheduleRefresh();
    }
  },

  updateItem: async (key, id, updatedFields) => {
    set((state) => ({
      [key]: (state[key] as Array<{ id: string }>).map((x) =>
        x.id === id ? { ...x, ...updatedFields } : x,
      ),
    }) as Partial<DataStore>);

    if (key === "school") return true;

    const tableKey = key as TableKey;
    // La ligne reste « en écriture » jusqu'à la fin de TOUT ce qu'elle déclenche
    // — y compris la réécriture des inscriptions, qui continue après le retour.
    markPending(tableKey, id);
    let enrollmentWrite: Promise<void> | null = null;
    const release = () => {
      unmarkPending(tableKey, id);
      scheduleRefresh();
    };

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
      enrollmentWrite = (async () => {
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

    try {
      const cfg = TABLES[tableKey];
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
    } finally {
      if (enrollmentWrite) void (enrollmentWrite as Promise<void>).finally(release);
      else release();
    }
  },

  deleteFrom: (key, id) => {
    set((state) => ({
      [key]: (state[key] as Array<{ id: string }>).filter((x) => x.id !== id),
    }) as Partial<DataStore>);

    if (key === "school") return;

    // Tant que la suppression n'est pas confirmée, une synchronisation ne doit
    // pas faire réapparaître la ligne.
    const tableKey = key as TableKey;
    markPending(tableKey, id);
    const release = () => {
      unmarkPending(tableKey, id);
      scheduleRefresh();
    };

    if (AUTH_LINKED_KEYS.has(key as string)) {
      fetch(`/api/admin/users/${id}`, { method: "DELETE" })
        .then(async (res) => {
          if (!res.ok) console.error(`Failed to delete user ${id}:`, await res.text());
        })
        .catch((err) => console.error(`Failed to delete user ${id}:`, err))
        .finally(release);
      return;
    }

    const cfg = TABLES[tableKey];
    const supabase = createClient();
    supabase
      .from(cfg.table)
      .delete()
      .eq("id", id)
      .then(({ error }) => {
        if (error) console.error(`Failed to delete from ${cfg.table}:`, error.message);
      })
      .then(release, release);
  },

  cashMove: (type, amount, description, date) => {
    let isoDate = new Date().toISOString();
    if (date) {
      isoDate = date.length === 10 ? `${date}T${new Date().toISOString().substring(11)}` : new Date(date).toISOString();
    }
    const signedAmount = type === "withdraw" ? -Math.abs(amount) : Math.abs(amount);
    const item: CashTransaction = { id: uid("csh"), type, amount: signedAmount, date: isoDate, description };

    set((state) => ({ cash: [...state.cash, item] }));

    markPending("cash", item.id);
    const release = () => {
      unmarkPending("cash", item.id);
      scheduleRefresh();
    };
    const supabase = createClient();
    supabase
      .from("cash_transactions")
      .insert(cashMapper.toRow(item))
      .then(({ error }) => {
        if (error) console.error("Failed to insert cash transaction:", error.message);
      })
      .then(release, release);
  },

  updateSchool: async (updatedFields) => {
    // Toute relecture de l'école partie AVANT cette écriture rapporterait
    // l'ancienne ligne et effacerait à l'écran ce qui vient d'être saisi.
    schoolWrittenAt = Date.now();
    set((state) => ({ school: { ...state.school, ...updatedFields } }));

    const schoolId = get().school.id;
    if (!schoolId) return { ok: false, error: "école introuvable" };
    const supabase = createClient();
    const { data, error } = await supabase
      .from("school")
      .update(schoolMapper.toRow(updatedFields))
      .eq("id", schoolId)
      .select("id");
    schoolWrittenAt = Date.now();
    // Un compte qui n'a pas le droit d'écrire ne reçoit PAS d'erreur : la
    // base répond « 0 ligne modifiée ». L'écran affichait « Enregistré », puis
    // l'ancien tarif revenait au rechargement suivant.
    const refused = !error && Array.isArray(data) && data.length === 0;
    if (error || refused) {
      const message = error
        ? error.message
        : "seul un compte administrateur peut modifier les réglages de l'école";
      console.error("Failed to update school:", message);
      // The optimistic state now disagrees with the database: put it back.
      schoolWrittenAt = 0;
      await get().fetchSchool();
      return { ok: false, error: message };
    }
    return { ok: true };
  },

  repriceRegistrationDues: async (fromAmount, toAmount) => {
    const from = Math.max(0, Math.round(fromAmount || 0));
    const to = Math.max(0, Math.round(toAmount || 0));
    if (from <= 0 || from === to) return { ok: true, count: 0 };
    const ids = get()
      .students.filter((s) => !s.isFree && (s.registrationDue ?? 0) === from)
      .map((s) => s.id);
    if (ids.length === 0) return { ok: true, count: 0 };

    set((state) => ({
      students: state.students.map((s) => (ids.includes(s.id) ? { ...s, registrationDue: to } : s)),
    }));
    ids.forEach((id) => markPending("students", id));
    try {
      const supabase = createClient();
      // La condition est relue côté base : un élève qui a réglé entre-temps
      // (son reste dû a bougé) n'est pas re-tarifé. Pas de liste d'identifiants
      // — des centaines d'élèves feraient une adresse de requête trop longue.
      const { data, error } = await supabase
        .from("students")
        .update({ registration_due: to })
        .eq("registration_due", from)
        .eq("is_free", false)
        .select("id");
      if (error) {
        console.error("Failed to reprice registration dues:", error.message);
        reportWriteFailure("students", error.message);
        // Rien n'a bougé en base : l'écran revient à ce qu'elle porte.
        set((state) => ({
          students: state.students.map((s) =>
            ids.includes(s.id) ? { ...s, registrationDue: from } : s,
          ),
        }));
        return { ok: false, error: error.message };
      }
      return { ok: true, count: Array.isArray(data) ? data.length : ids.length };
    } finally {
      ids.forEach((id) => unmarkPending("students", id));
      scheduleRefresh();
    }
  },

  restoreState: (dump) => set(() => ({ ...dump })),

  reset: () => {
    get().fetchAll();
  },
}));
