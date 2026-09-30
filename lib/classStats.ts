/**
 * Les chiffres d'une classe et de chacun de ses emplois du temps.
 *
 * Un « emploi du temps » est un créneau (`ScheduleSession`) : une classe, un
 * module, un groupe, un enseignant, des jours et une heure. Ses élèves sont
 * ceux qui y sont INSCRITS (un abonnement sur ce créneau).
 *
 * Tout est calculé en UNE passe sur chaque table, jamais « pour chaque classe,
 * pour chaque élève, chercher… » : l'écran Classes affiche ces chiffres sur
 * toutes les classes à la fois, et il doit rester instantané.
 *
 * Deux montants, qu'il ne faut pas confondre :
 *   · la DETTE d'un élève est globale (solde négatif + frais d'inscription
 *     dus) : on ne sait pas « sur quel module » un solde est passé en négatif.
 *     La dette d'un emploi du temps est donc la dette de SES élèves ; un élève
 *     inscrit à deux créneaux de la classe n'est compté qu'une fois au niveau
 *     de la classe.
 *   · le PAYÉ d'un emploi du temps est ce que ses séances ont réellement
 *     coûté aux élèves (le débit de chaque présence) : lui appartient bien à
 *     ce créneau.
 */

import type {
  AbsencePenalty,
  AttendanceRecord,
  ScheduleSession,
  Student,
  Subscription,
  UnpaidTeacherSession,
} from "@/lib/types";
import type { StudentDebt } from "@/lib/helpers";

/** Fenêtre des indicateurs « récents » (taux de présence, séances). */
export const RECENT_DAYS = 30;

/** Les créneaux d'une classe — une séance libre peut en couvrir plusieurs. */
export function sessionsOfClass<T extends Pick<ScheduleSession, "classId" | "classIds">>(
  sessions: T[],
  classId: string,
): T[] {
  return sessions.filter((s) => s.classId === classId || !!s.classIds?.includes(classId));
}

export interface StudentInSession {
  presences: number;
  absences: number;
  /** ISO de la dernière présence (non absente) sur ce créneau */
  lastPresence?: string;
  /** ce que ses présences sur ce créneau lui ont coûté */
  paid: number;
}

export interface SessionStat {
  sessionId: string;
  /** élèves inscrits, du plus endetté au moins endetté puis par nom */
  studentIds: string[];
  /** élèves inscrits qui doivent quelque chose */
  debtorIds: string[];
  /** somme des dettes de ses élèves */
  totalDebt: number;
  /** somme débitée aux élèves sur ses séances */
  totalPaid: number;
  /** ce qui reste dû à l'enseignant sur ce créneau */
  teacherDue: number;
  presences: number;
  absences: number;
  presencesRecent: number;
  absencesRecent: number;
  /** nombre de jours où au moins une présence a été pointée */
  seancesHeld: number;
  /** YYYY-MM-DD de la dernière séance pointée */
  lastSeanceDate?: string;
  perStudent: Map<string, StudentInSession>;
}

export interface ClassStatsInput {
  sessions: ScheduleSession[];
  subscriptions: Subscription[];
  students: Student[];
  attendance: AttendanceRecord[];
  absencePenalties: AbsencePenalty[];
  unpaidTeacher: UnpaidTeacherSession[];
  debtOf: (student: Student) => StudentDebt;
  now?: Date;
}

const dayOf = (iso: string) => iso.slice(0, 10);

function emptyStat(sessionId: string): SessionStat {
  return {
    sessionId,
    studentIds: [],
    debtorIds: [],
    totalDebt: 0,
    totalPaid: 0,
    teacherDue: 0,
    presences: 0,
    absences: 0,
    presencesRecent: 0,
    absencesRecent: 0,
    seancesHeld: 0,
    perStudent: new Map(),
  };
}

/** Les chiffres de CHAQUE créneau, en une passe par table. */
export function buildSessionStats(input: ClassStatsInput): Map<string, SessionStat> {
  const now = input.now ?? new Date();
  const recentFrom = new Date(now.getTime() - RECENT_DAYS * 24 * 3600 * 1000).toISOString();

  const stats = new Map<string, SessionStat>();
  for (const s of input.sessions) stats.set(s.id, emptyStat(s.id));

  const sessionOfSub = new Map<string, string>();
  for (const sub of input.subscriptions) sessionOfSub.set(sub.id, sub.sessionId);

  const studentById = new Map<string, Student>();
  for (const stu of input.students) studentById.set(stu.id, stu);

  // ---- Inscriptions -------------------------------------------------------------
  for (const stu of input.students) {
    const seen = new Set<string>();
    for (const subId of stu.subscriptionIds) {
      const sessionId = sessionOfSub.get(subId);
      if (!sessionId || seen.has(sessionId)) continue;
      const stat = stats.get(sessionId);
      if (!stat) continue;
      seen.add(sessionId);
      stat.studentIds.push(stu.id);
      stat.perStudent.set(stu.id, { presences: 0, absences: 0, paid: 0 });
    }
  }

  // ---- Présences ------------------------------------------------------------------
  const days = new Map<string, Set<string>>();
  for (const att of input.attendance) {
    const stat = stats.get(att.sessionId);
    if (!stat) continue;
    const absent = att.status === "absent";
    const recent = att.timestamp >= recentFrom;
    if (absent) {
      stat.absences++;
      if (recent) stat.absencesRecent++;
    } else {
      stat.presences++;
      if (recent) stat.presencesRecent++;
      let set = days.get(att.sessionId);
      if (!set) days.set(att.sessionId, (set = new Set()));
      set.add(dayOf(att.timestamp));
    }
    stat.totalPaid += att.amountDeducted || 0;

    const mine = stat.perStudent.get(att.studentId);
    if (mine) {
      mine.paid += att.amountDeducted || 0;
      if (absent) mine.absences++;
      else {
        mine.presences++;
        if (!mine.lastPresence || att.timestamp > mine.lastPresence) mine.lastPresence = att.timestamp;
      }
    }
  }
  for (const [sessionId, set] of days) {
    const stat = stats.get(sessionId);
    if (!stat) continue;
    stat.seancesHeld = set.size;
    let last = "";
    for (const d of set) if (d > last) last = d;
    stat.lastSeanceDate = last || undefined;
  }

  // ---- Absences facturées à la semaine --------------------------------------------
  for (const pen of input.absencePenalties) {
    if (!pen.sessionId) continue;
    const stat = stats.get(pen.sessionId);
    if (!stat) continue;
    stat.absences++;
    if (`${pen.periodEnd}T23:59:59` >= recentFrom) stat.absencesRecent++;
    stat.totalPaid += pen.amount || 0;
    const mine = stat.perStudent.get(pen.studentId);
    if (mine) {
      mine.absences++;
      mine.paid += pen.amount || 0;
    }
  }

  // ---- Dû à l'enseignant --------------------------------------------------------
  for (const due of input.unpaidTeacher) {
    if (due.paid) continue;
    const stat = stats.get(due.sessionId);
    if (stat) stat.teacherDue += due.amount || 0;
  }

  // ---- Dettes, et ordre d'affichage ----------------------------------------------
  const debtCache = new Map<string, StudentDebt>();
  const debtOf = (id: string) => {
    let d = debtCache.get(id);
    if (!d) {
      const stu = studentById.get(id);
      if (!stu) return undefined;
      d = input.debtOf(stu);
      debtCache.set(id, d);
    }
    return d;
  };
  for (const stat of stats.values()) {
    for (const id of stat.studentIds) {
      const debt = debtOf(id);
      if (debt?.alert) {
        stat.debtorIds.push(id);
        stat.totalDebt += debt.total;
      }
    }
    const name = (id: string) => {
      const s = studentById.get(id);
      return s ? `${s.lastName} ${s.firstName}`.toLowerCase() : "";
    };
    const owed = (id: string) => debtOf(id)?.total ?? 0;
    stat.studentIds.sort((a, b) => owed(b) - owed(a) || name(a).localeCompare(name(b)));
    stat.debtorIds.sort((a, b) => owed(b) - owed(a) || name(a).localeCompare(name(b)));
  }

  return stats;
}

export interface ClassSummary {
  sessionIds: string[];
  /** élèves inscrits à au moins un créneau de la classe (chacun une fois) */
  studentIds: string[];
  debtorIds: string[];
  totalDebt: number;
  totalPaid: number;
  teacherDue: number;
  presencesRecent: number;
  absencesRecent: number;
  moduleIds: string[];
  teacherIds: string[];
}

/** Les chiffres d'une classe : ses créneaux additionnés, ses élèves comptés
 *  UNE fois (un élève inscrit à trois modules n'a qu'une dette). */
export function summarizeClass(
  classSessions: ScheduleSession[],
  stats: Map<string, SessionStat>,
  debtOf: (studentId: string) => StudentDebt | undefined,
): ClassSummary {
  const students = new Set<string>();
  const modules = new Set<string>();
  const teachers = new Set<string>();
  let totalPaid = 0;
  let teacherDue = 0;
  let presencesRecent = 0;
  let absencesRecent = 0;
  for (const s of classSessions) {
    if (s.moduleId) modules.add(s.moduleId);
    if (s.teacherId) teachers.add(s.teacherId);
    const stat = stats.get(s.id);
    if (!stat) continue;
    for (const id of stat.studentIds) students.add(id);
    totalPaid += stat.totalPaid;
    teacherDue += stat.teacherDue;
    presencesRecent += stat.presencesRecent;
    absencesRecent += stat.absencesRecent;
  }
  const debtorIds: string[] = [];
  let totalDebt = 0;
  for (const id of students) {
    const debt = debtOf(id);
    if (debt?.alert) {
      debtorIds.push(id);
      totalDebt += debt.total;
    }
  }
  debtorIds.sort((a, b) => (debtOf(b)?.total ?? 0) - (debtOf(a)?.total ?? 0));
  return {
    sessionIds: classSessions.map((s) => s.id),
    studentIds: [...students],
    debtorIds,
    totalDebt,
    totalPaid,
    teacherDue,
    presencesRecent,
    absencesRecent,
    moduleIds: [...modules],
    teacherIds: [...teachers],
  };
}

/** Taux de présence (0-100) — `null` quand rien n'a été pointé. */
export function attendanceRate(presences: number, absences: number): number | null {
  const total = presences + absences;
  return total > 0 ? Math.round((presences / total) * 100) : null;
}
