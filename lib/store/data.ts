"use client";

import { create } from "zustand";
import { createClient } from "@/lib/supabase/client";
import type {
  Announcement,
  AttendanceRecord,
  BalanceTransaction,
  CashTransaction,
  Coursework,
  Expense,
  ExpenseCategory,
  Filiere,
  Group,
  IndependentSession,
  Module,
  Notification,
  Parent,
  ReceptionStaff,
  Salle,
  School,
  ScheduleSession,
  SchoolClass,
  Student,
  Subject,
  Subscription,
  Teacher,
  TeacherAbsence,
  TeacherAcompte,
  UnpaidTeacherSession,
} from "@/lib/types";

export interface Database {
  school: School;
  filieres: Filiere[];
  modules: Module[];
  groups: Group[];
  salles: Salle[];
  classes: SchoolClass[];
  teachers: Teacher[];
  reception: ReceptionStaff[];
  sessions: ScheduleSession[];
  subscriptions: Subscription[];
  students: Student[];
  balanceTx: BalanceTransaction[];
  attendance: AttendanceRecord[];
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
    },
    filieres: [],
    modules: [],
    groups: [],
    salles: [],
    classes: [],
    teachers: [],
    reception: [],
    sessions: [],
    subscriptions: [],
    students: [],
    balanceTx: [],
    attendance: [],
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
]);

const subscriptionsMapper = makeMapper<Subscription>([
  ["id", "id"],
  ["sessionId", "session_id"],
  ["pricePerSession", "price_per_session"],
  ["levelPrice", "level_price"],
  ["periodMonths", "period_months"],
]);

const balanceTxMapper = makeMapper<BalanceTransaction>([
  ["id", "id"],
  ["studentId", "student_id"],
  ["amount", "amount"],
  ["date", "date"],
  ["type", "type"],
  ["description", "description"],
  ["moduleId", "module_id"],
]);

const attendanceMapper = makeMapper<AttendanceRecord>([
  ["id", "id"],
  ["studentId", "student_id"],
  ["sessionId", "session_id"],
  ["timestamp", "occurred_at"],
  ["amountDeducted", "amount_deducted"],
  ["status", "status"],
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
]);

const absencesMapper = makeMapper<TeacherAbsence>([
  ["id", "id"],
  ["teacherId", "staff_id"],
  ["cost", "cost"],
  ["description", "description"],
  ["date", "date"],
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
]);

const TABLES: Record<Exclude<keyof Database, "school">, TableConfig> = {
  filieres: { table: "filieres", select: "*", ...filieresMapper },
  modules: { table: "modules", select: "*", ...modulesMapper },
  groups: { table: "groups", select: "*", ...groupsMapper },
  salles: { table: "salles", select: "*", ...sallesMapper },
  classes: { table: "classes", select: "*", ...classesMapper },
  teachers: { table: "teachers", select: "*", ...teachersMapper },
  reception: { table: "reception_staff", select: "*", ...receptionMapper },
  sessions: { table: "sessions", select: "*", ...sessionsMapper },
  subscriptions: { table: "subscriptions", select: "*", ...subscriptionsMapper },
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
          .filter((r: any) => r.start_date || r.expiry_date) // eslint-disable-line @typescript-eslint/no-explicit-any
          .map((r: any) => [ // eslint-disable-line @typescript-eslint/no-explicit-any
            r.subscription_id,
            { startDate: r.start_date ?? undefined, expiryDate: r.expiry_date ?? undefined },
          ]),
      ),
    }),
    toRow: studentsBaseMapper.toRow,
  },
  balanceTx: { table: "balance_tx", select: "*", ...balanceTxMapper },
  attendance: { table: "attendance", select: "*", ...attendanceMapper },
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
};

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
]);

/** These entity tables are auth-linked (id === auth.users.id): creation goes
 *  through /api/admin/users and deletion must remove the auth user too. */
const AUTH_LINKED_KEYS = new Set(["students", "teachers", "parents", "reception"]);

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
  messageKey: string;
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

interface DataActions {
  loaded: boolean;
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
  settleTeacherPercentage: (teacherId: string) => Promise<TeacherSettlement>;
  addBalance: (
    studentId: string,
    amount: number,
    description: string,
    settleRegistration?: boolean,
  ) => Promise<void>;
  payDebt: (studentId: string, amount: number) => Promise<void>;
  deleteFrom: <K extends keyof Database>(key: K, id: string) => void;
  push: <K extends keyof Database>(
    key: K,
    item: Database[K] extends Array<infer T> ? T : never,
  ) => void;
  updateItem: <K extends keyof Database>(
    key: K,
    id: string,
    updatedFields: Partial<Database[K] extends Array<infer T> ? T : never>,
  ) => void;
  cashMove: (
    type: "deposit" | "withdraw",
    amount: number,
    description: string,
    date?: string,
  ) => void;
  updateSchool: (updatedFields: Partial<School>) => void;
  restoreState: (dump: Partial<Database>) => void;
  reset: () => void;
}

export type DataStore = Database & DataActions;

export const useData = create<DataStore>((set, get) => ({
  ...emptyDatabase(),
  loaded: false,

  fetchSchool: async () => {
    const supabase = createClient();
    const { data } = await supabase.from("school").select("*").limit(1).maybeSingle();
    if (data) set({ school: schoolMapper.fromRow(data) });
  },

  fetchAll: async () => {
    const supabase = createClient();
    const keys = Object.keys(TABLES) as Array<keyof typeof TABLES>;
    const results = await Promise.all(
      keys.map(async (key) => {
        const cfg = TABLES[key];
        const { data, error } = await supabase.from(cfg.table).select(cfg.select);
        if (error || !data) return [key, []] as const;
        return [key, data.map(cfg.fromRow)] as const;
      }),
    );
    const patch: Record<string, unknown> = { loaded: true };
    for (const [key, rows] of results) patch[key] = rows;
    set(patch as Partial<DataStore>);
  },

  clear: () => set({ ...emptyDatabase(), school: get().school, loaded: false }),

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

  addBalance: async (studentId, amount, description, settleRegistration) => {
    const supabase = createClient();
    const { error } = await supabase.rpc("add_student_balance", {
      p_student_id: studentId,
      p_amount: amount,
      p_description: description,
      p_settle_registration: !!settleRegistration,
    });
    if (!error) await get().fetchAll();
  },

  payDebt: async (studentId, amount) => {
    const supabase = createClient();
    const { error } = await supabase.rpc("pay_student_debt", {
      p_student_id: studentId,
      p_amount: amount,
    });
    if (!error) await get().fetchAll();
  },

  push: (key, item) => {
    set((state) => ({
      [key]: [...(state[key] as unknown[]), item],
    }) as Partial<DataStore>);

    if (key === "school" || AUTH_LINKED_KEYS.has(key as string)) return; // auth-linked rows are created via /api/admin/users

    const cfg = TABLES[key as Exclude<keyof Database, "school">];
    const supabase = createClient();
    supabase.from(cfg.table).insert(cfg.toRow(item)).then(({ error }) => {
      if (error) console.error(`Failed to insert into ${cfg.table}:`, error.message);
    });
  },

  updateItem: (key, id, updatedFields) => {
    set((state) => ({
      [key]: (state[key] as Array<{ id: string }>).map((x) =>
        x.id === id ? { ...x, ...updatedFields } : x,
      ),
    }) as Partial<DataStore>);

    if (key === "school") return;

    const supabase = createClient();

    if (key === "students" && updatedFields && "subscriptionIds" in updatedFields) {
      const fields = updatedFields as Partial<Student>;
      const ids = fields.subscriptionIds ?? [];
      // Keep existing formation dates when the caller only changes the id list
      // (e.g. unsubscribing from one module).
      const dates =
        fields.subscriptionDates ??
        get().students.find((s) => s.id === id)?.subscriptionDates ??
        {};
      const hasDates = ids.some((sid) => dates[sid]?.startDate || dates[sid]?.expiryDate);
      supabase
        .from("student_subscriptions")
        .delete()
        .eq("student_id", id)
        .then(() => {
          if (ids.length) {
            supabase
              .from("student_subscriptions")
              .insert(
                ids.map((subscription_id) =>
                  // Only send the date columns when a date is actually set, so
                  // cours-only enrollments still work before the migration.
                  hasDates
                    ? {
                        student_id: id,
                        subscription_id,
                        start_date: dates[subscription_id]?.startDate ?? null,
                        expiry_date: dates[subscription_id]?.expiryDate ?? null,
                      }
                    : { student_id: id, subscription_id },
                ),
              )
              .then(({ error }) => {
                if (error) console.error("Failed to sync student_subscriptions:", error.message);
              });
          }
        });
    }

    const cfg = TABLES[key as Exclude<keyof Database, "school">];
    const row = cfg.toRow(updatedFields);
    if (Object.keys(row).length === 0) return;
    supabase.from(cfg.table).update(row).eq("id", id).then(({ error }) => {
      if (error) console.error(`Failed to update ${cfg.table}:`, error.message);
    });
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

  updateSchool: (updatedFields) => {
    set((state) => ({ school: { ...state.school, ...updatedFields } }));

    const schoolId = get().school.id;
    if (!schoolId) return;
    const supabase = createClient();
    supabase
      .from("school")
      .update(schoolMapper.toRow(updatedFields))
      .eq("id", schoolId)
      .then(({ error }) => {
        if (error) console.error("Failed to update school:", error.message);
      });
  },

  restoreState: (dump) => set(() => ({ ...dump })),

  reset: () => {
    get().fetchAll();
  },
}));
