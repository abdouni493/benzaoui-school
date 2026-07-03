"use client";

import { useState } from "react";
import { useData } from "@/lib/store/data";
import { useSession } from "@/lib/store/session";
import { changeOwnPassword } from "@/lib/supabase/createUser";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { Modal } from "@/components/ui/Modal";
import {
  Briefcase,
  Calendar,
  Check,
  FileText,
  DollarSign,
  Megaphone,
  User,
  AlertTriangle,
  Clock,
  Plus,
  Trash2,
  Users,
  Upload,
  MapPin,
  BookOpen,
  Wallet,
  Search,
  ArrowUpCircle,
  ArrowDownCircle,
} from "lucide-react";
import type { Teacher, ScheduleSession, Student, AttendanceStatus } from "@/lib/types";

interface PageProps {
  slug: string;
}

export function TeacherPages({ slug }: PageProps) {
  const { user, login } = useSession();
  const {
    teachers,
    sessions,
    modules,
    classes,
    groups,
    announcements,
    unpaidTeacher,
    acomptes,
    absences,
    cash,
    students,
    attendance,
    subjects,
    push,
    deleteFrom,
    updateItem,
  } = useData();

  const teacher = teachers.find((t) => t.id === user?.entityId);

  if (!teacher) {
    return (
      <div className="p-8 text-center text-xs">
        <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
        <h3 className="font-bold text-ink">Erreur de Profil</h3>
        <p className="text-muted mt-1">Impossible de charger le profil de l'enseignant. Veuillez vous reconnecter.</p>
      </div>
    );
  }

  // Helpers
  const getSessionInfo = (s: ScheduleSession) => {
    const cl = classes.find((c) => c.id === s.classId)?.name ?? "";
    const mod = modules.find((m) => m.id === s.moduleId)?.name ?? "";
    const gr = groups.find((g) => g.id === s.groupId)?.name ?? "";
    return { classLabel: cl, moduleLabel: mod, groupLabel: gr, ...s };
  };

  const teacherSessions = sessions.filter((s) => s.teacherId === teacher.id);

  switch (slug) {
    case "dashboard":
      return (
        <TeacherDashboardView
          teacher={teacher}
          teacherSessions={teacherSessions}
          getSessionInfo={getSessionInfo}
          unpaidTeacher={unpaidTeacher}
          cash={cash}
        />
      );
    case "schedule":
      return <TeacherScheduleView teacherSessions={teacherSessions} getSessionInfo={getSessionInfo} />;
    case "attendance":
      return (
        <TeacherAttendanceView
          teacher={teacher}
          teacherSessions={teacherSessions}
          getSessionInfo={getSessionInfo}
          students={students}
          attendance={attendance}
          push={push}
          updateItem={updateItem}
        />
      );
    case "subjects":
      return (
        <TeacherSubjectsView
          teacher={teacher}
          teacherSessions={teacherSessions}
          getSessionInfo={getSessionInfo}
          subjects={subjects}
          push={push}
          deleteFrom={deleteFrom}
        />
      );
    case "salary":
      return (
        <TeacherSalaryView
          teacher={teacher}
          acomptes={acomptes}
          absences={absences}
          cash={cash}
          unpaidTeacher={unpaidTeacher}
        />
      );
    case "my-classes":
      return (
        <TeacherClassesView
          teacher={teacher}
          teacherSessions={teacherSessions}
          getSessionInfo={getSessionInfo}
          students={students}
        />
      );
    case "announcements":
      return <TeacherAnnouncementsView announcements={announcements} />;
    case "profile":
      return <TeacherProfileView teacher={teacher} updateItem={updateItem} login={login} user={user} />;
    default:
      return <div className="p-4 text-xs text-muted">Page non trouvée</div>;
  }
}

// ----------------------------------------------------
// 1. DASHBOARD VIEW
// ----------------------------------------------------
function TeacherDashboardView({
  teacher,
  teacherSessions,
  getSessionInfo,
  unpaidTeacher,
  cash,
}: {
  teacher: Teacher;
  teacherSessions: ScheduleSession[];
  getSessionInfo: (s: ScheduleSession) => any;
  unpaidTeacher: any[];
  cash: any[];
}) {
  const unpaidSessCount = unpaidTeacher.filter((u) => u.teacherId === teacher.id && !u.paid).length;
  const unpaidSessAmount = unpaidTeacher
    .filter((u) => u.teacherId === teacher.id && !u.paid)
    .reduce((sum, u) => sum + u.amount, 0);

  // Check if monthly salary is paid this month
  const currentMonthKey = `${String(new Date().getMonth() + 1).padStart(2, "0")}/${new Date().getFullYear()}`;
  const isMonthlyPaid = cash.some(
    (c) =>
      c.type === "teacher_payment" &&
      c.description.includes(teacher.lastName) &&
      c.description.includes(currentMonthKey)
  );

  return (
    <div className="space-y-6 text-xs">
      <PageHeader
        emoji="🏠"
        title={`Bonjour, Professeur ${teacher.lastName}`}
        subtitle="Suivi de vos classes, présences et rémunérations"
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-gradient-primary text-white border-none card-shadow h-28">
          <CardBody className="flex justify-between items-center h-full">
            <div>
              <span className="text-white/80 font-bold uppercase tracking-wider block text-[10px]">Rémunération Contrat</span>
              <strong className="text-2xl font-extrabold block mt-1">
                {teacher.paymentType === "monthly"
                  ? `${teacher.monthlyAmount} DA / mois`
                  : `${teacher.percentage}% par élève`}
              </strong>
            </div>
            <div className="h-11 w-11 bg-white/10 rounded-xl flex items-center justify-center">
              <DollarSign className="h-5 w-5" />
            </div>
          </CardBody>
        </Card>

        {teacher.paymentType === "percentage" ? (
          <Card className="h-28">
            <CardBody className="flex justify-between items-center h-full">
              <div>
                <span className="text-muted font-bold uppercase tracking-wider block text-[10px]">Séances impayées</span>
                <strong className="text-2xl font-extrabold text-ink block mt-1">
                  {unpaidSessCount} séances ({unpaidSessAmount} DA)
                </strong>
              </div>
            </CardBody>
          </Card>
        ) : (
          <Card className="h-28">
            <CardBody className="flex justify-between items-center h-full">
              <div>
                <span className="text-muted font-bold uppercase tracking-wider block text-[10px]">Statut Mois Actuel</span>
                <strong className="text-sm font-bold block mt-2">
                  {isMonthlyPaid ? (
                    <Badge tone="success">Salaire Versé</Badge>
                  ) : (
                    <Badge tone="warning">En attente de versement</Badge>
                  )}
                </strong>
              </div>
            </CardBody>
          </Card>
        )}

        <Card className="h-28">
          <CardBody className="flex justify-between items-center h-full">
            <div>
              <span className="text-muted font-bold uppercase tracking-wider block text-[10px]">Groupes assignés</span>
              <strong className="text-3xl font-extrabold text-ink block mt-1">{teacherSessions.length}</strong>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Week overview */}
      <Card>
        <CardBody className="space-y-4">
          <h3 className="font-bold text-ink flex items-center gap-2 border-b border-line pb-3">
            <Calendar className="h-5 w-5 text-primary" /> Synthèse de mon planning
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {teacherSessions.map((s) => {
              const info = getSessionInfo(s);
              return (
                <div key={s.id} className="p-3 bg-canvas/30 border border-line rounded-xl space-y-1">
                  <strong className="text-ink block">{info.moduleLabel}</strong>
                  <span className="text-[10px] text-muted block">{info.classLabel} ({info.groupLabel})</span>
                  <div className="flex justify-between items-center mt-2 border-t border-line/40 pt-1.5 text-[10px]">
                    <span className="capitalize font-mono text-[9px] text-primary">{s.days.join(", ")}</span>
                    <strong className="font-mono text-ink">{s.startTime} - {s.endTime}</strong>
                  </div>
                </div>
              );
            })}
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

// ----------------------------------------------------
// 2. SCHEDULE VIEW
// ----------------------------------------------------
function TeacherScheduleView({
  teacherSessions,
  getSessionInfo,
}: {
  teacherSessions: ScheduleSession[];
  getSessionInfo: (s: ScheduleSession) => any;
}) {
  const { salles, students, subscriptions } = useData();
  const daysOfWeek = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];
  const [filterSessionId, setFilterSessionId] = useState("");
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const mySessions = teacherSessions.map((s) => getSessionInfo(s));

  // Filter based on dropdown choice
  const filteredSessions = filterSessionId
    ? mySessions.filter((s) => s.id === filterSessionId)
    : mySessions;

  // Helpers for formatting days
  const frenchDays: Record<string, string> = {
    saturday: "Samedi",
    sunday: "Dimanche",
    monday: "Lundi",
    tuesday: "Mardi",
    wednesday: "Mercredi",
    thursday: "Jeudi",
    friday: "Vendredi",
  };

  // Generate consistent coloring by module name
  const getSessionColor = (name: string) => {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colors = [
      "border-l-4 border-l-blue-500 bg-blue-50/70 text-blue-900 dark:bg-blue-950/20 dark:text-blue-200 border-blue-100",
      "border-l-4 border-l-emerald-500 bg-emerald-50/70 text-emerald-900 dark:bg-emerald-950/20 dark:text-emerald-200 border-emerald-100",
      "border-l-4 border-l-amber-500 bg-amber-50/70 text-amber-900 dark:bg-amber-950/20 dark:text-amber-200 border-amber-100",
      "border-l-4 border-l-rose-500 bg-rose-50/70 text-rose-900 dark:bg-rose-950/20 dark:text-rose-200 border-rose-100",
      "border-l-4 border-l-purple-500 bg-purple-50/70 text-purple-900 dark:bg-purple-950/20 dark:text-purple-200 border-purple-100",
      "border-l-4 border-l-cyan-500 bg-cyan-50/70 text-cyan-900 dark:bg-cyan-950/20 dark:text-cyan-200 border-cyan-100",
      "border-l-4 border-l-indigo-500 bg-indigo-50/70 text-indigo-900 dark:bg-indigo-950/20 dark:text-indigo-200 border-indigo-100",
    ];
    return colors[Math.abs(hash) % colors.length];
  };

  const getSessionStudentsCount = (sessionId: string) => {
    const sub = subscriptions.find((su) => su.sessionId === sessionId);
    if (!sub) return 0;
    return students.filter((stu) => stu.subscriptionIds.includes(sub.id)).length;
  };

  const getSessionStudentsList = (sessionId: string) => {
    const sub = subscriptions.find((su) => su.sessionId === sessionId);
    if (!sub) return [];
    return students.filter((stu) => stu.subscriptionIds.includes(sub.id));
  };

  const handleOpenDetails = (ses: any) => {
    const salleObj = salles.find((sa) => sa.id === ses.salleId);
    const stuList = getSessionStudentsList(ses.id);
    setSelectedSession({
      ...ses,
      salleName: salleObj ? salleObj.name : "Salle non spécifiée",
      students: stuList,
    });
    setIsDetailsOpen(true);
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader emoji="🗓️" title="Mon Calendrier de Cours" subtitle="Consultez votre planning hebdomadaire de cours" />
        
        {/* Quick select filter for teacher */}
        <div className="w-56 self-start sm:self-center">
          <Select value={filterSessionId} onChange={(e) => setFilterSessionId(e.target.value)} className="w-full">
            <option value="">Tous mes cours</option>
            {mySessions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.moduleLabel} ({s.groupLabel})
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto pb-4">
        <div className="grid grid-cols-1 md:grid-cols-7 gap-4 min-w-[900px] md:min-w-0">
          {daysOfWeek.map((day) => {
            const daySessions = filteredSessions
              .filter((s) => s.days.includes(day))
              .sort((a, b) => a.startTime.localeCompare(b.startTime));

            return (
              <div key={day} className="flex flex-col bg-canvas/30 rounded-2xl border border-line p-3 min-h-[380px] space-y-3">
                <span className="font-extrabold text-ink uppercase text-[10px] block border-b border-line pb-2 text-center capitalize">
                  {frenchDays[day] || day}
                </span>
                
                <div className="flex-1 space-y-2.5 overflow-y-auto max-h-[400px]">
                  {daySessions.length === 0 ? (
                    <span className="text-[10px] text-muted italic block text-center mt-12 font-medium">Aucun cours</span>
                  ) : (
                    daySessions.map((s) => (
                      <div
                        key={s.id}
                        onClick={() => handleOpenDetails(s)}
                        className={`p-2.5 rounded-xl border cursor-pointer hover:scale-[1.02] hover:shadow-sm transition-all duration-200 space-y-1.5 ${getSessionColor(
                          s.moduleLabel
                        )}`}
                      >
                        <strong className="text-ink block text-[11px] font-black leading-tight truncate">{s.moduleLabel}</strong>
                        <span className="text-[9px] text-muted block truncate font-bold">{s.groupLabel}</span>
                        <div className="flex items-center justify-between text-[9px] font-bold opacity-90 mt-1 border-t border-black/5 dark:border-white/5 pt-1">
                          <span className="flex items-center gap-1 font-mono">
                            <Clock className="h-3 w-3 shrink-0" />
                            {s.startTime} - {s.endTime}
                          </span>
                          <Badge tone="neutral" className="text-[8px] px-1 py-0 font-bold">
                            {getSessionStudentsCount(s.id)} él.
                          </Badge>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Details Modal */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Détails du Cours Enseigné" wide>
        {selectedSession && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-primary-50/50 rounded-xl p-4 border border-line">
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Matière</span>
                <span className="font-bold text-ink">{selectedSession.moduleLabel}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Niveau / Classe</span>
                <span className="font-semibold text-ink">{selectedSession.classLabel}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Groupe / Salle</span>
                <span className="font-semibold text-ink">
                  {selectedSession.groupLabel} - {selectedSession.salleName}
                </span>
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase font-sans">Effectif Total</span>
                <span className="font-semibold text-ink">{selectedSession.students?.length || 0} élève(s)</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-surface border border-line p-4 rounded-xl space-y-3">
                <h4 className="font-bold text-ink flex items-center gap-1.5">
                  <Clock className="h-4 w-4 text-primary" /> Jours & Horaires
                </h4>
                <div className="flex justify-between items-center text-xs border-b border-line pb-2">
                  <span className="text-muted">Heure de début:</span>
                  <strong className="text-primary font-bold">{selectedSession.startTime}</strong>
                </div>
                <div className="flex justify-between items-center text-xs border-b border-line pb-2">
                  <span className="text-muted">Heure de fin:</span>
                  <strong className="text-primary font-bold">{selectedSession.endTime}</strong>
                </div>
                <div>
                  <span className="text-[10px] text-muted block mb-1.5 font-sans">Jours programmés:</span>
                  <div className="flex flex-wrap gap-1">
                    {selectedSession.days.map((d: string) => (
                      <Badge key={d} tone="primary" className="uppercase text-[9px] font-bold">
                        {frenchDays[d] || d}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-ink mb-2.5 flex items-center gap-1.5">
                  <Users className="h-4 w-4 text-primary" /> Liste des Élèves du Groupe ({selectedSession.students?.length || 0})
                </h4>
                <div className="bg-surface border border-line p-3 rounded-xl max-h-48 overflow-y-auto space-y-2">
                  {(!selectedSession.students || selectedSession.students.length === 0) ? (
                    <p className="text-xs text-muted italic p-4 text-center">Aucun élève inscrit à ce groupe.</p>
                  ) : (
                    selectedSession.students.map((stu: any) => (
                      <div key={stu.id} className="flex justify-between items-center text-xs bg-canvas/30 p-2.5 rounded-lg border border-line/50">
                        <div>
                          <span className="font-bold text-ink block">{stu.firstName} {stu.lastName}</span>
                          <span className="text-[10px] text-muted">{stu.phone}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-line">
              <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ----------------------------------------------------
// 3. ATTENDANCE VIEW
// ----------------------------------------------------
function TeacherAttendanceView({
  teacher,
  teacherSessions,
  getSessionInfo,
  students,
  attendance,
  push,
  updateItem,
}: {
  teacher: Teacher;
  teacherSessions: ScheduleSession[];
  getSessionInfo: (s: ScheduleSession) => any;
  students: Student[];
  attendance: any[];
  push: any;
  updateItem: any;
}) {
  const [activeSession, setActiveSession] = useState<ScheduleSession | null>(null);

  // Enrolled students for selected session group
  const getEnrolledStudents = (s: ScheduleSession) => {
    return students.filter((st) =>
      st.subscriptionIds.some((subId) => {
        const sub = useData.getState().subscriptions.find((x) => x.id === subId);
        return sub?.sessionId === s.id;
      })
    );
  };

  const getStudentStatusForSessionToday = (sid: string, sesId: string) => {
    const todayStr = new Date().toISOString().split("T")[0];
    const record = attendance.find(
      (a) => a.studentId === sid && a.sessionId === sesId && a.timestamp.startsWith(todayStr)
    );
    return record?.status || null;
  };

  const handleToggleAttendance = (student: Student, session: ScheduleSession, status: AttendanceStatus) => {
    const todayStr = new Date().toISOString().split("T")[0];
    const existing = attendance.find(
      (a) => a.studentId === student.id && a.sessionId === session.id && a.timestamp.startsWith(todayStr)
    );

    const sub = useData.getState().subscriptions.find((s) => s.sessionId === session.id);
    const cost = sub?.pricePerSession ?? 0;

    if (existing) {
      if (existing.status === status) return; // already has this status

      // Refund old and deduct new
      const oldCost = existing.amountDeducted;
      const newCost = student.isFree ? 0 : status === "absent" ? 0 : cost;

      updateItem("attendance", existing.id, {
        status,
        amountDeducted: newCost,
      });

      // Adjust student balance
      updateItem("students", student.id, {
        balance: student.balance + oldCost - newCost,
      });
    } else {
      // Create new attendance record
      const finalCost = student.isFree ? 0 : status === "absent" ? 0 : cost;
      const attId = `att-${Math.random()}`;

      push("attendance", {
        id: attId,
        studentId: student.id,
        sessionId: session.id,
        timestamp: new Date().toISOString(),
        amountDeducted: finalCost,
        status,
      });

      // Deduct balance
      updateItem("students", student.id, {
        balance: student.balance - finalCost,
      });

      // Log teacher payment session if percentage
      if (teacher.paymentType === "percentage" && status !== "absent") {
        const teacherDue = Math.round((finalCost * (teacher.percentage ?? 50)) / 100);
        push("unpaidTeacher", {
          id: `ut-${Math.random()}`,
          teacherId: teacher.id,
          sessionId: session.id,
          studentId: student.id,
          amount: teacherDue,
          date: new Date().toISOString(),
          paid: false,
        });
      }
    }
  };

  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="✅" title="Appel & Présences" subtitle="Validez la présence des élèves de vos groupes aujourd'hui" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Sessions list */}
        <div className="space-y-3">
          <span className="font-bold text-ink uppercase tracking-wider block text-[10px]">Sélectionner un Groupe</span>
          {teacherSessions.map((s) => {
            const info = getSessionInfo(s);
            const isSel = activeSession?.id === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActiveSession(s)}
                className={`w-full text-start p-3 rounded-2xl border transition-all ${
                  isSel ? "border-primary bg-primary-50/15" : "border-line bg-surface hover:bg-primary-50/20"
                }`}
              >
                <strong className="text-ink block">{info.moduleLabel}</strong>
                <span className="text-[10px] text-muted block mt-0.5">{info.classLabel} ({info.groupLabel})</span>
                <span className="text-primary block font-mono font-bold mt-1 text-[9px]">{s.startTime} - {s.endTime}</span>
              </button>
            );
          })}
        </div>

        {/* Student list checkoff */}
        <div className="md:col-span-2 space-y-3">
          {activeSession ? (
            <Card>
              <CardBody className="space-y-4">
                <h3 className="font-bold text-ink border-b border-line pb-3">
                  Appel : {getSessionInfo(activeSession).moduleLabel} ({getSessionInfo(activeSession).groupLabel})
                </h3>

                <div className="space-y-2">
                  {getEnrolledStudents(activeSession).length === 0 ? (
                    <p className="text-xs text-muted italic p-4 text-center">Aucun étudiant inscrit dans ce groupe.</p>
                  ) : (
                    getEnrolledStudents(activeSession).map((st) => {
                      const status = getStudentStatusForSessionToday(st.id, activeSession.id);
                      return (
                        <div key={st.id} className="flex justify-between items-center p-3 bg-canvas/30 rounded-xl border border-line">
                          <div>
                            <strong className="text-ink text-xs block">{st.firstName} {st.lastName}</strong>
                            <span className="text-[9px] text-muted font-mono block">RFID: {st.rfid}</span>
                          </div>

                          <div className="flex gap-1.5">
                            <Button
                              size="sm"
                              variant={status === "present" ? "primary" : "outline"}
                              onClick={() => handleToggleAttendance(st, activeSession, "present")}
                            >
                              Présent
                            </Button>
                            <Button
                              size="sm"
                              variant={status === "late" ? "secondary" : "outline"}
                              onClick={() => handleToggleAttendance(st, activeSession, "late")}
                            >
                              En Retard
                            </Button>
                            <Button
                              size="sm"
                              variant={status === "absent" ? "danger" : "outline"}
                              onClick={() => handleToggleAttendance(st, activeSession, "absent")}
                              className={status === "absent" ? "bg-danger text-white hover:bg-danger/90" : ""}
                            >
                              Absent
                            </Button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardBody>
            </Card>
          ) : (
            <div className="bg-canvas border border-line border-dashed p-8 rounded-2xl text-center text-muted">
              Veuillez sélectionner un groupe dans la colonne de gauche pour faire l'appel.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 4. SUBJECTS VIEW
// ----------------------------------------------------
function TeacherSubjectsView({
  teacher,
  teacherSessions,
  getSessionInfo,
  subjects,
  push,
  deleteFrom,
}: {
  teacher: Teacher;
  teacherSessions: ScheduleSession[];
  getSessionInfo: (s: ScheduleSession) => any;
  subjects: any[];
  push: any;
  deleteFrom: any;
}) {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [image, setImage] = useState("https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=300&auto=format&fit=crop&q=60");

  const mySubjects = subjects.filter((s) =>
    teacherSessions.some((ts) => ts.id === s.sessionId)
  );

  const handlePublish = () => {
    if (!title || !sessionId) return;
    push("subjects", {
      id: `sbj-${Math.random()}`,
      title,
      description,
      sessionId,
      image: image || "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=300&auto=format&fit=crop&q=60",
      date: new Date().toISOString(),
    });
    setIsAddOpen(false);
    setTitle("");
    setDescription("");
    setSessionId("");
    setImage("https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?w=300&auto=format&fit=crop&q=60");
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="flex items-center justify-between">
        <PageHeader emoji="📄" title="Mes Devoirs & Fiches" subtitle="Publier des ressources de révision et exercices" />
        <Button onClick={() => setIsAddOpen(true)} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nouveau document
        </Button>
      </div>

      {mySubjects.length === 0 ? (
        <Card className="p-8 text-center bg-canvas/30 border border-line">
          <FileText className="h-10 w-10 text-muted mx-auto mb-2" />
          <h3 className="font-bold text-ink">Aucun document partagé</h3>
          <p className="text-xs text-muted mt-1 font-sans">Créez votre première fiche d'exercice.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {mySubjects.map((sbj) => {
            const info = getSessionInfo(teacherSessions.find((x) => x.id === sbj.sessionId)!);
            return (
              <Card key={sbj.id} className="overflow-hidden border border-line">
                {sbj.image && (
                  <div className="h-28 w-full bg-canvas border-b border-line overflow-hidden">
                    <img src={sbj.image} alt={sbj.title} className="w-full h-full object-cover" />
                  </div>
                )}
                <CardBody className="flex flex-col justify-between h-44">
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-ink line-clamp-1">{sbj.title}</h4>
                        <span className="text-[9px] text-muted block mt-0.5">Publié le {sbj.date.substring(0, 10)}</span>
                      </div>
                      <button onClick={() => deleteFrom("subjects", sbj.id)} className="p-1 rounded hover:bg-danger/10 text-danger shrink-0 animate-colors">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <p className="text-xs text-muted mt-2 line-clamp-2">{sbj.description}</p>
                  </div>
                  <div className="border-t border-line pt-2.5 mt-2.5 flex items-center justify-between">
                    <Badge tone="neutral" className="text-[9px] truncate max-w-[150px]">
                      {info?.moduleLabel} - {info?.groupLabel}
                    </Badge>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add Document Modal */}
      <Modal open={isAddOpen} onClose={() => setIsAddOpen(false)} title="Créer un sujet / exercice">
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Titre de la fiche *</label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex: Devoir blanc Math" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Groupe ciblé *</label>
            <Select value={sessionId} onChange={(e) => setSessionId(e.target.value)} className="w-full">
              <option value="">Sélectionner...</option>
              {teacherSessions.map((s) => {
                const info = getSessionInfo(s);
                return (
                  <option key={s.id} value={s.id}>
                    {info.moduleLabel} - {info.groupLabel}
                  </option>
                );
              })}
            </Select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-2">Image d'illustration / Exercice</label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Device upload zone */}
              <div className="border-2 border-dashed border-line rounded-2xl p-4 bg-canvas/30 hover:bg-canvas/50 transition-colors flex flex-col items-center justify-center text-center cursor-pointer relative group">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onloadend = () => {
                        if (typeof reader.result === "string") {
                          setImage(reader.result);
                        }
                      };
                      reader.readAsDataURL(file);
                    }
                  }}
                  className="absolute inset-0 opacity-0 cursor-pointer z-10"
                />
                <div className="space-y-1.5 pointer-events-none">
                  <div className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
                    <Upload className="h-4 w-4" />
                  </div>
                  <span className="text-xs font-bold text-ink block">Téléverser depuis l'appareil</span>
                  <span className="text-[10px] text-muted block">Sélectionner une photo</span>
                </div>
              </div>

              {/* URL Input & Preview zone */}
              <div className="border border-line rounded-2xl p-3 bg-surface flex flex-col justify-between gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-muted uppercase mb-1">Ou saisir l'adresse URL</label>
                  <Input
                    value={image}
                    onChange={(e) => setImage(e.target.value)}
                    placeholder="https://images.unsplash.com/..."
                  />
                </div>
                
                {image && (
                  <div className="h-16 w-full rounded-xl overflow-hidden relative bg-canvas border border-line flex items-center justify-center">
                    <img src={image} alt="Aperçu" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setImage("")}
                      className="absolute top-1 right-1 p-1 rounded-md bg-danger text-white hover:bg-danger/90 text-[10px] font-bold z-20"
                    >
                      Supprimer
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Description / Enoncé</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-line bg-surface p-3 text-sm text-ink outline-none focus:border-primary"
            />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handlePublish}>Publier</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ----------------------------------------------------
// 5. SALARY VIEW
// ----------------------------------------------------
function TeacherSalaryView({
  teacher,
  acomptes,
  absences,
  cash,
  unpaidTeacher,
}: {
  teacher: Teacher;
  acomptes: any[];
  absences: any[];
  cash: any[];
  unpaidTeacher: any[];
}) {
  const [activeTab, setActiveTab] = useState<"sessions" | "payments" | "penalties">("sessions");
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const myAcomptes = acomptes.filter((a) => a.teacherId === teacher.id);
  const myAbsences = absences.filter((ab) => ab.teacherId === teacher.id);

  // Filter payments inside cash register
  const myPayments = cash.filter(
    (c) =>
      c.type === "teacher_payment" &&
      c.description.toLowerCase().includes(teacher.lastName.toLowerCase())
  );

  const mySessions = unpaidTeacher.filter((u) => u.teacherId === teacher.id);

  // Date filtering helper
  const filterByDateRange = (dateStr: string, filter: string) => {
    if (!filter) return true;
    const itemDate = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const compareDate = new Date(itemDate);
    compareDate.setHours(0, 0, 0, 0);

    const diffTime = today.getTime() - compareDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (filter === "today") {
      return diffDays === 0;
    }
    if (filter === "last_week") {
      return diffDays >= 0 && diffDays <= 7;
    }
    return true;
  };

  // Calculations for dashboard
  const totalEarnedSessions = mySessions.reduce((sum, s) => sum + s.amount, 0);
  const pendingSessions = mySessions.filter((s) => !s.paid).reduce((sum, s) => sum + s.amount, 0);
  const settledSessions = mySessions.filter((s) => s.paid).reduce((sum, s) => sum + s.amount, 0);
  
  const totalSalaryPaid = myPayments.reduce((sum, p) => sum + Math.abs(p.amount), 0);
  const totalAcomptes = myAcomptes.reduce((sum, a) => sum + a.amount, 0);
  const totalPenalties = myAbsences.reduce((sum, ab) => sum + ab.cost, 0);

  // Consolidated Net Balance
  const netDueBalance = pendingSessions - totalAcomptes - totalPenalties;

  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="💵" title="Historique de mes Paiements & Retenues" subtitle="Bilan comptable de vos acomptes et règlements" />

      {/* Stats Cards Section */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Earnings Card */}
        <Card className="bg-primary-500/10 border border-primary-500/20 dark:bg-primary-950/20">
          <CardBody className="p-4 space-y-1">
            <span className="text-[10px] text-primary-800 dark:text-primary-300 font-bold uppercase tracking-wider block font-sans">
              Gains Totaux Validés
            </span>
            <div className="flex justify-between items-baseline">
              <strong className="text-lg text-primary-700 dark:text-primary-200 font-black">
                {totalEarnedSessions} DA
              </strong>
              <DollarSign className="h-4.5 w-4.5 text-primary shrink-0" />
            </div>
            <div className="text-[9px] text-muted pt-1 flex justify-between">
              <span>Payé: {settledSessions} DA</span>
              <span>Attente: {pendingSessions} DA</span>
            </div>
          </CardBody>
        </Card>

        {/* Advances / Acomptes Card */}
        <Card className="bg-amber-500/10 border border-amber-500/20 dark:bg-amber-950/20">
          <CardBody className="p-4 space-y-1">
            <span className="text-[10px] text-amber-800 dark:text-amber-300 font-bold uppercase tracking-wider block font-sans">
              Acomptes perçus
            </span>
            <div className="flex justify-between items-baseline">
              <strong className="text-lg text-amber-700 dark:text-amber-200 font-black">
                {totalAcomptes} DA
              </strong>
              <Wallet className="h-4.5 w-4.5 text-amber-600 dark:text-amber-400 shrink-0" />
            </div>
            <div className="text-[9px] text-muted pt-1">
              Versé en avance sur salaire
            </div>
          </CardBody>
        </Card>

        {/* Penalties Card */}
        <Card className="bg-rose-500/10 border border-rose-500/20 dark:bg-rose-950/20">
          <CardBody className="p-4 space-y-1">
            <span className="text-[10px] text-rose-800 dark:text-rose-300 font-bold uppercase tracking-wider block font-sans">
              Retenues / Pénalités
            </span>
            <div className="flex justify-between items-baseline">
              <strong className="text-lg text-rose-700 dark:text-rose-200 font-black">
                {totalPenalties} DA
              </strong>
              <AlertTriangle className="h-4.5 w-4.5 text-rose-600 dark:text-rose-400 shrink-0" />
            </div>
            <div className="text-[9px] text-muted pt-1">
              Absences ou retards signalés
            </div>
          </CardBody>
        </Card>

        {/* Estimated Due Card */}
        <Card className={`${netDueBalance >= 0 ? "bg-emerald-500/10 border border-emerald-500/20 dark:bg-emerald-950/20" : "bg-rose-500/10 border border-rose-500/20 dark:bg-rose-950/20"}`}>
          <CardBody className="p-4 space-y-1">
            <span className="text-[10px] uppercase tracking-wider block font-bold font-sans">
              Solde Net Dû Estimé
            </span>
            <div className="flex justify-between items-baseline">
              <strong className="text-lg font-black font-sans">
                {netDueBalance} DA
              </strong>
              {netDueBalance >= 0 ? (
                <ArrowUpCircle className="h-4.5 w-4.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <ArrowDownCircle className="h-4.5 w-4.5 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
            </div>
            <div className="text-[9px] text-muted pt-1 font-sans">
              Gains restants après avances & retenues
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Tabs and filters toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Navigation Tabs */}
        <div className="bg-canvas border border-line p-1 rounded-xl flex gap-1 self-start">
          <button
            onClick={() => { setActiveTab("sessions"); setSearchTerm(""); }}
            className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase transition-all ${
              activeTab === "sessions"
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-ink hover:bg-canvas/50"
            }`}
          >
            Séances validées ({mySessions.length})
          </button>
          <button
            onClick={() => { setActiveTab("payments"); setSearchTerm(""); }}
            className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase transition-all ${
              activeTab === "payments"
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-ink hover:bg-canvas/50"
            }`}
          >
            Salaires & Acomptes ({myPayments.length + myAcomptes.length})
          </button>
          <button
            onClick={() => { setActiveTab("penalties"); setSearchTerm(""); }}
            className={`px-4 py-2 rounded-lg text-[10px] font-bold uppercase transition-all ${
              activeTab === "penalties"
                ? "bg-primary text-white shadow-sm"
                : "text-muted hover:text-ink hover:bg-canvas/50"
            }`}
          >
            Pénalités ({myAbsences.length})
          </button>
        </div>

        {/* Inline Search and Date Filtering */}
        <Card className="border border-line shadow-sm flex-1 md:max-w-md">
          <CardBody className="p-2 flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted" />
              <Input
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Rechercher..."
                className="pl-8 py-1.5 w-full text-xs"
              />
            </div>
            <div className="w-32 shrink-0">
              <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-full py-1.5 text-xs">
                <option value="">Toutes dates</option>
                <option value="today">Aujourd'hui</option>
                <option value="last_week">7 derniers jours</option>
              </Select>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Tab Contents */}
      <div>
        {activeTab === "sessions" && (
          <div className="space-y-4">
            <h3 className="font-extrabold text-ink text-xs uppercase tracking-wide flex items-center gap-1.5 font-sans">
              📁 Détails des Séances Validées
            </h3>
            {mySessions.length === 0 ? (
              <Card className="p-8 text-center bg-canvas/30 border border-line border-dashed rounded-xl">
                <p className="text-muted italic">Aucune séance validée à votre actif.</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {mySessions
                  .filter((s) => {
                    const matchesDate = filterByDateRange(s.date, dateFilter);
                    const matchesSearch = s.id.toLowerCase().includes(searchTerm.toLowerCase()) || s.date.includes(searchTerm);
                    return matchesDate && matchesSearch;
                  })
                  .reverse()
                  .map((s) => (
                    <Card key={s.id} className="relative overflow-visible hover:shadow-md transition-all duration-200">
                      <CardBody className="flex flex-col justify-between h-56 relative">
                        <div>
                          {/* Header: Circle + Title/Subtitle */}
                          <div className="flex items-start gap-3 mb-4">
                            <div className="h-10 w-10 rounded-full border border-primary/20 bg-primary/10 text-primary text-xs font-bold flex items-center justify-center tracking-wider shrink-0">
                              SE
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-sm font-bold text-ink truncate">
                                Séance d'enseignement
                              </h4>
                              <span className="text-[10px] text-muted block font-mono">
                                {s.date.substring(0, 16).replace("T", " ")}
                              </span>
                            </div>
                          </div>

                          {/* Details box */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs bg-canvas/30 border border-line/60 rounded-xl p-2.5">
                              <div>
                                <span className="text-[10px] text-muted block uppercase font-semibold">Statut</span>
                                <span className={`font-semibold ${s.paid ? "text-emerald-600" : "text-amber-600"}`}>
                                  {s.paid ? "Réglé" : "En attente"}
                                </span>
                              </div>
                              <div className="text-right">
                                <span className="text-[10px] text-muted block uppercase font-semibold">Code séance</span>
                                <span className="font-mono text-ink text-[11px] block truncate max-w-[120px]">
                                  {s.sessionId || "Manuel"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Footer */}
                        <div className="border-t border-line/60 pt-3 mt-4 flex items-center justify-between">
                          <span className="text-[10px] text-muted flex items-center gap-1">
                            <span className={`h-1.5 w-1.5 rounded-full ${s.paid ? "bg-success" : "bg-warning"}`} />
                            Crédit de cours
                          </span>
                          <Badge tone={s.paid ? "success" : "warning"} className="font-mono font-bold text-xs px-2.5 py-0.5">
                            +{s.amount} DA
                          </Badge>
                        </div>
                      </CardBody>
                    </Card>
                  ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "payments" && (
          <div className="space-y-4">
            <h3 className="font-extrabold text-ink text-xs uppercase tracking-wide flex items-center gap-1.5 font-sans">
              💳 Versements de Salaires & Acomptes
            </h3>
            
            {/* Merge and sort payments & acomptes chronologically */}
            {(() => {
              const combinedList = [
                ...myPayments.map((p) => ({ ...p, isAcompte: false })),
                ...myAcomptes.map((a) => ({ ...a, isAcompte: true })),
              ].sort((a, b) => b.date.localeCompare(a.date));

              const filteredList = combinedList.filter((item) => {
                const matchesDate = filterByDateRange(item.date, dateFilter);
                const desc = item.description || (item.isAcompte ? "Acompte exceptionnel" : "Règlement de salaire");
                const matchesSearch = desc.toLowerCase().includes(searchTerm.toLowerCase());
                return matchesDate && matchesSearch;
              });

              if (filteredList.length === 0) {
                return (
                  <Card className="p-8 text-center bg-canvas/30 border border-line border-dashed rounded-xl">
                    <p className="text-muted italic">Aucun acompte ou règlement de salaire enregistré.</p>
                  </Card>
                );
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredList.map((item) => {
                    const desc = item.description || (item.isAcompte ? "Acompte exceptionnel" : "Versement de salaire");
                    return (
                      <Card key={item.id} className="relative overflow-visible hover:shadow-md transition-all duration-200">
                        <CardBody className="flex flex-col justify-between h-56 relative">
                          <div>
                            {/* Header: Circle + Title/Subtitle */}
                            <div className="flex items-start gap-3 mb-4">
                              <div className={`h-10 w-10 rounded-full border text-xs font-bold flex items-center justify-center tracking-wider shrink-0 ${
                                item.isAcompte
                                  ? "bg-amber-500/10 border-amber-500/20 text-amber-600"
                                  : "bg-emerald-500/10 border-emerald-500/20 text-emerald-600"
                              }`}>
                                {item.isAcompte ? "AC" : "SL"}
                              </div>
                              <div className="min-w-0">
                                <h4 className="text-sm font-bold text-ink truncate" title={desc}>
                                  {desc}
                                </h4>
                                <span className="text-[10px] text-muted block font-mono">
                                  {item.date.substring(0, 10)}
                                </span>
                              </div>
                            </div>

                            {/* Details box */}
                            <div className="space-y-2">
                              <div className="flex items-center justify-between text-xs bg-canvas/30 border border-line/60 rounded-xl p-2.5">
                                <div>
                                  <span className="text-[10px] text-muted block uppercase font-semibold">Catégorie</span>
                                  <span className="font-semibold text-ink">
                                    {item.isAcompte ? "Acompte" : "Règlement"}
                                  </span>
                                </div>
                                <div className="text-right">
                                  <span className="text-[10px] text-muted block uppercase font-semibold">Mode</span>
                                  <span className="font-bold text-primary">
                                    Caisse
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Footer */}
                          <div className="border-t border-line/60 pt-3 mt-4 flex items-center justify-between">
                            <span className="text-[10px] text-muted flex items-center gap-1">
                              <span className="h-1.5 w-1.5 rounded-full bg-success" />
                              Paiement caisse
                            </span>
                            <Badge tone={item.isAcompte ? "warning" : "success"} className="font-mono font-bold text-xs px-2.5 py-0.5">
                              +{Math.abs(item.amount)} DA
                            </Badge>
                          </div>
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>
              );
            })()}
          </div>
        )}

        {activeTab === "penalties" && (
          <div className="space-y-4">
            <h3 className="font-extrabold text-ink text-xs uppercase tracking-wide flex items-center gap-1.5 font-sans">
              ❌ Retenues, Absences & Pénalités
            </h3>
            {myAbsences.length === 0 ? (
              <Card className="p-8 text-center bg-canvas/30 border border-line border-dashed rounded-xl">
                <p className="text-muted italic font-sans">Aucune pénalité enregistrée. Félicitations pour votre assiduité !</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {myAbsences
                  .filter((ab) => {
                    const matchesDate = filterByDateRange(ab.date, dateFilter);
                    const matchesSearch = ab.description.toLowerCase().includes(searchTerm.toLowerCase());
                    return matchesDate && matchesSearch;
                  })
                  .reverse()
                  .map((ab) => (
                    <Card key={ab.id} className="relative overflow-visible hover:shadow-md transition-all duration-200">
                      <CardBody className="flex flex-col justify-between h-56 relative">
                        <div>
                          {/* Header: Circle + Title/Subtitle */}
                          <div className="flex items-start gap-3 mb-4">
                            <div className="h-10 w-10 rounded-full border border-rose-500/20 bg-rose-500/10 text-rose-600 text-xs font-bold flex items-center justify-center tracking-wider shrink-0">
                              PN
                            </div>
                            <div className="min-w-0">
                              <h4 className="text-sm font-bold text-ink truncate" title={ab.description}>
                                {ab.description || "Retenue sur absence"}
                              </h4>
                              <span className="text-[10px] text-muted block font-mono">
                                {ab.date}
                              </span>
                            </div>
                          </div>

                          {/* Details box */}
                          <div className="space-y-2">
                            <div className="flex items-center justify-between text-xs bg-canvas/30 border border-line/60 rounded-xl p-2.5">
                              <div>
                                <span className="text-[10px] text-muted block uppercase font-semibold">Motif</span>
                                <span className="font-semibold text-ink">
                                  Absence / Retard
                                </span>
                              </div>
                              <div className="text-right">
                                <span className="text-[10px] text-muted block uppercase font-semibold">Type</span>
                                <span className="font-bold text-danger">
                                  Déduction
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Footer */}
                        <div className="border-t border-line/60 pt-3 mt-4 flex items-center justify-between">
                          <span className="text-[10px] text-muted flex items-center gap-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-danger" />
                            Retenue sur salaire
                          </span>
                          <Badge tone="danger" className="font-mono font-bold text-xs px-2.5 py-0.5">
                            -{ab.cost} DA
                          </Badge>
                        </div>
                      </CardBody>
                    </Card>
                  ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 6. MY CLASSES VIEW
// ----------------------------------------------------
function TeacherClassesView({
  teacher,
  teacherSessions,
  getSessionInfo,
  students,
}: {
  teacher: Teacher;
  teacherSessions: ScheduleSession[];
  getSessionInfo: (s: ScheduleSession) => any;
  students: Student[];
}) {
  const [activeSession, setActiveSession] = useState<ScheduleSession | null>(null);

  const getEnrolledStudents = (s: ScheduleSession) => {
    return students.filter((st) =>
      st.subscriptionIds.some((subId) => {
        const sub = useData.getState().subscriptions.find((x) => x.id === subId);
        return sub?.sessionId === s.id;
      })
    );
  };

  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="👥" title="Mes Classes & Groupes" subtitle="Consulter les listes d'étudiants inscrits à vos cours" />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Classes list */}
        <div className="space-y-3">
          <span className="font-bold text-ink uppercase tracking-wider block text-[10px]">Groupes assignés</span>
          {teacherSessions.map((s) => {
            const info = getSessionInfo(s);
            const isSel = activeSession?.id === s.id;
            return (
              <button
                key={s.id}
                onClick={() => setActiveSession(s)}
                className={`w-full text-start p-3 rounded-2xl border transition-all ${
                  isSel ? "border-primary bg-primary-50/15" : "border-line bg-surface hover:bg-primary-50/20"
                }`}
              >
                <strong className="text-ink block">{info.moduleLabel}</strong>
                <span className="text-[10px] text-muted block mt-0.5">{info.classLabel} ({info.groupLabel})</span>
                <span className="text-muted block text-[9px] font-mono font-bold mt-1">
                  Élèves: {getEnrolledStudents(s).length}
                </span>
              </button>
            );
          })}
        </div>

        {/* Student listing */}
        <div className="md:col-span-2 space-y-3">
          {activeSession ? (
            <Card>
              <CardBody className="space-y-4">
                <h3 className="font-bold text-ink border-b border-line pb-3">
                  Liste d'élèves : {getSessionInfo(activeSession).moduleLabel} ({getSessionInfo(activeSession).groupLabel})
                </h3>

                <div className="space-y-2">
                  {getEnrolledStudents(activeSession).length === 0 ? (
                    <p className="text-xs text-muted italic p-4 text-center">Aucun élève inscrit dans ce groupe.</p>
                  ) : (
                    getEnrolledStudents(activeSession).map((st) => (
                      <div key={st.id} className="flex justify-between items-center p-3 bg-canvas/30 rounded-xl border border-line">
                        <div>
                          <strong className="text-ink text-xs block">{st.firstName} {st.lastName}</strong>
                          <span className="text-[9px] text-muted font-mono block">RFID: {st.rfid}</span>
                        </div>
                        <span className="text-[10px] text-muted">{st.phone}</span>
                      </div>
                    ))
                  )}
                </div>
              </CardBody>
            </Card>
          ) : (
            <div className="bg-canvas border border-line border-dashed p-8 rounded-2xl text-center text-muted">
              Sélectionnez un groupe à gauche pour voir la liste complète des étudiants inscrits.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 7. ANNOUNCEMENTS VIEW
// ----------------------------------------------------
function TeacherAnnouncementsView({ announcements }: { announcements: any[] }) {
  const activeAnn = announcements.filter(
    (ann) =>
      (ann.audience === "all" || ann.audience === "teachers") &&
      new Date(ann.endDate) >= new Date()
  );

  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="📣" title="Annonces pour le corps Enseignant" subtitle="Informations scolaires importantes" />

      {activeAnn.length === 0 ? (
        <Card className="p-8 text-center bg-canvas/30 border border-line">
          <Megaphone className="h-10 w-10 text-muted mx-auto mb-2" />
          <h3 className="font-bold text-ink">Aucune annonce</h3>
          <p className="text-xs text-muted mt-1">Aucune information importante n'est actuellement diffusée.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {activeAnn.map((ann) => (
            <Card key={ann.id}>
              <CardBody className="space-y-3">
                <div className="flex items-center gap-2 border-b border-line pb-2">
                  <Megaphone className="h-4.5 w-4.5 text-primary shrink-0" />
                  <strong className="text-ink text-sm font-bold">{ann.title}</strong>
                </div>
                <p className="text-muted text-xs leading-relaxed whitespace-pre-line">{ann.description}</p>
                <div className="border-t border-line/60 pt-2 flex justify-between text-[10px] text-muted">
                  <span>Publié le: {new Date(ann.date).toLocaleDateString()}</span>
                  <span>Date limite: {ann.endDate}</span>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// 8. PROFILE VIEW
// ----------------------------------------------------
function TeacherProfileView({
  teacher,
  updateItem,
  login,
  user,
}: {
  teacher: Teacher;
  updateItem: any;
  login: any;
  user: any;
}) {
  const [firstName, setFirstName] = useState(teacher.firstName);
  const [lastName, setLastName] = useState(teacher.lastName);
  const [phone, setPhone] = useState(teacher.phone);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      if (password) {
        if (password.length < 6) {
          alert("Le mot de passe doit contenir au moins 6 caractères.");
          setSaving(false);
          return;
        }
        await changeOwnPassword(password);
        setPassword("");
      }

      updateItem("teachers", teacher.id, { firstName, lastName, phone });

      login({ ...user, name: `${firstName} ${lastName}` });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="👤" title="Mon Profil Enseignant" subtitle="Gérer vos identifiants d'accès et contacts" />

      <div className="max-w-2xl">
        <Card>
          <CardBody className="space-y-4">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2 border-b border-line pb-3">
              <User className="h-5 w-5 text-primary" /> Informations Personnelles
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Prénom</label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Nom</label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Téléphone</label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Email (Identifiant)</label>
                <Input value={teacher.email} disabled className="opacity-60" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-semibold text-muted mb-1">Nouveau mot de passe</label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Laisser vide pour ne pas changer"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-line flex justify-end">
              <Button onClick={handleSaveProfile} disabled={saving}>
                {saving ? "..." : "Enregistrer les Modifications"}
              </Button>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
