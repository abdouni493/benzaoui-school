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
  Wallet,
  Calendar,
  FileText,
  DollarSign,
  Megaphone,
  User,
  AlertTriangle,
  Clock,
  Eye,
  MapPin,
  BookOpen,
  Download,
  Filter,
  Search,
  ArrowDownCircle,
  ArrowUpCircle
} from "lucide-react";
import type { Student, Subscription, ScheduleSession } from "@/lib/types";

interface PageProps {
  slug: string;
}

export function StudentPages({ slug }: PageProps) {
  const { user, login } = useSession();
  const {
    students,
    subscriptions,
    sessions,
    modules,
    classes,
    groups,
    announcements,
    balanceTx,
    subjects,
    updateItem,
  } = useData();

  const student = students.find((s) => s.id === user?.entityId);

  if (!student) {
    return (
      <div className="p-8 text-center text-xs">
        <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
        <h3 className="font-bold text-ink">Erreur de Profil</h3>
        <p className="text-muted mt-1">Impossible de charger le profil de l'étudiant. Veuillez vous reconnecter.</p>
      </div>
    );
  }

  // Active Subscriptions
  const activeSubs = subscriptions.filter((sub) => student.subscriptionIds.includes(sub.id));

  // Resolved Session Groups Helper
  const getSessionInfo = (sesId: string) => {
    const s = sessions.find((se) => se.id === sesId);
    if (!s) return null;
    const cl = classes.find((c) => c.id === s.classId)?.name ?? "";
    const mod = modules.find((m) => m.id === s.moduleId)?.name ?? "";
    const gr = groups.find((g) => g.id === s.groupId)?.name ?? "";
    return { classLabel: cl, moduleLabel: mod, groupLabel: gr, ...s };
  };

  // Main views routing based on slug
  switch (slug) {
    case "home":
      return <StudentHomeView student={student} activeSubs={activeSubs} getSessionInfo={getSessionInfo} announcements={announcements} sessions={sessions} modules={modules} classes={classes} groups={groups} />;
    case "schedule":
      return <StudentScheduleView student={student} activeSubs={activeSubs} getSessionInfo={getSessionInfo} />;
    case "subjects":
      return <StudentSubjectsView student={student} activeSubs={activeSubs} getSessionInfo={getSessionInfo} subjects={subjects} />;
    case "payments":
      return <StudentPaymentsView student={student} balanceTx={balanceTx} />;
    case "announcements":
      return <StudentAnnouncementsView announcements={announcements} />;
    case "profile":
      return <StudentProfileView student={student} updateItem={updateItem} login={login} user={user} />;
    default:
      return <div className="p-4 text-xs text-muted">Page non trouvée</div>;
  }
}

// ----------------------------------------------------
// 1. HOME VIEW
// ----------------------------------------------------
function StudentHomeView({
  student,
  activeSubs,
  getSessionInfo,
  announcements,
  sessions,
  modules,
  classes,
  groups,
}: {
  student: Student;
  activeSubs: Subscription[];
  getSessionInfo: (id: string) => any;
  announcements: any[];
  sessions: any[];
  modules: any[];
  classes: any[];
  groups: any[];
}) {
  const lowBalance = student.balance <= 500 && !student.isFree;
  const activeAnnouncements = announcements.filter(
    (ann) =>
      (ann.audience === "all" || ann.audience === "students") &&
      new Date(ann.endDate) >= new Date()
  );

  // Today's schedule
  const todayIndex = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][
    new Date().getDay()
  ];
  const todaySessions = sessions.filter(
    (s) =>
      student.subscriptionIds.some(
        (subId) => activeSubs.find((x) => x.id === subId)?.sessionId === s.id
      ) && s.days.includes(todayIndex)
  );

  return (
    <div className="space-y-6 text-xs">
      <PageHeader
        emoji="🏠"
        title={`Bienvenue, ${student.firstName}`}
        subtitle="Accédez à votre espace étudiant et vos cours"
      />

      {lowBalance && (
        <div className="p-4 bg-danger/10 border border-danger/25 rounded-2xl flex items-center gap-3 text-danger">
          <AlertTriangle className="h-5 w-5 shrink-0 animate-pulse" />
          <div>
            <strong className="block text-xs font-bold">Attention : Solde critique !</strong>
            <span className="text-[11px] opacity-90">
              Votre solde actuel est de {student.balance} DA. Veuillez recharger votre carte rapidement pour éviter le blocage d'accès.
            </span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Balance Card */}
        <Card className="bg-gradient-primary text-white border-none card-shadow h-28">
          <CardBody className="flex justify-between items-center h-full">
            <div>
              <span className="text-white/80 font-bold uppercase tracking-wider block text-[10px]">Mon Solde d'Étudiant</span>
              <strong className="text-3xl font-extrabold block mt-1">
                {student.isFree ? "Gratuit" : `${student.balance} DA`}
              </strong>
            </div>
            <div className="h-11 w-11 bg-white/10 rounded-xl flex items-center justify-center">
              <Wallet className="h-5 w-5" />
            </div>
          </CardBody>
        </Card>

        {/* Active Subscriptions Card */}
        <Card className="h-28">
          <CardBody className="flex justify-between items-center h-full">
            <div>
              <span className="text-muted font-bold uppercase tracking-wider block text-[10px]">Cours Souscrits</span>
              <strong className="text-3xl font-extrabold text-ink block mt-1">{activeSubs.length}</strong>
            </div>
            <div className="h-11 w-11 bg-primary-50 rounded-xl flex items-center justify-center text-primary">
              <Calendar className="h-5 w-5" />
            </div>
          </CardBody>
        </Card>

        {/* RFID Card Details */}
        <Card className="h-28">
          <CardBody className="flex justify-between items-center h-full">
            <div>
              <span className="text-muted font-bold uppercase tracking-wider block text-[10px]">Code Carte RFID</span>
              <strong className="text-sm font-bold text-ink block mt-1.5 font-mono bg-canvas border border-line px-3 py-1 rounded-lg">
                {student.rfid || "Aucune carte associée"}
              </strong>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Today's schedule */}
        <Card>
          <CardBody className="space-y-4">
            <h3 className="font-bold text-ink flex items-center gap-2 border-b border-line pb-3">
              <Clock className="h-5 w-5 text-primary" /> Séances d'aujourd'hui
            </h3>
            {todaySessions.length === 0 ? (
              <p className="text-xs text-muted italic p-4 text-center">Aucune séance planifiée pour aujourd'hui.</p>
            ) : (
              <div className="space-y-3">
                {todaySessions.map((s) => {
                  const info = getSessionInfo(s.id);
                  return (
                    <div key={s.id} className="flex justify-between items-center p-3 bg-canvas/30 rounded-xl border border-line">
                      <div>
                        <strong className="text-ink text-sm block">{info?.moduleLabel}</strong>
                        <span className="text-[10px] text-muted block mt-0.5">{info?.classLabel} ({info?.groupLabel})</span>
                      </div>
                      <Badge tone="primary" className="font-bold font-mono">
                        {s.startTime} - {s.endTime}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Target Announcements */}
        <Card>
          <CardBody className="space-y-4">
            <h3 className="font-bold text-ink flex items-center gap-2 border-b border-line pb-3">
              <Megaphone className="h-5 w-5 text-primary" /> Annonces Générales
            </h3>
            {activeAnnouncements.length === 0 ? (
              <p className="text-xs text-muted italic p-4 text-center">Aucune annonce active pour le moment.</p>
            ) : (
              <div className="space-y-3 max-h-56 overflow-y-auto">
                {activeAnnouncements.map((ann) => (
                  <div key={ann.id} className="p-3 bg-canvas/40 border border-line rounded-xl space-y-1">
                    <strong className="text-ink font-bold text-xs block">{ann.title}</strong>
                    <p className="text-muted text-[11px] leading-relaxed">{ann.description}</p>
                    <span className="text-[9px] text-muted block text-right">Publié le {new Date(ann.date).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 2. SCHEDULE VIEW
// ----------------------------------------------------
function StudentScheduleView({
  student,
  activeSubs,
  getSessionInfo,
}: {
  student: Student;
  activeSubs: Subscription[];
  getSessionInfo: (id: string) => any;
}) {
  const { teachers, salles } = useData();
  const daysOfWeek = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];
  const [filterSessionId, setFilterSessionId] = useState("");
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  // Fetch all sessions student is linked to
  const mySessions = activeSubs
    .map((sub) => getSessionInfo(sub.sessionId))
    .filter(Boolean) as any[];

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

  const handleOpenDetails = (ses: any) => {
    const teacherObj = teachers.find((t) => t.id === ses.teacherId);
    const salleObj = salles.find((sa) => sa.id === ses.salleId);
    setSelectedSession({
      ...ses,
      teacherName: teacherObj ? `${teacherObj.firstName} ${teacherObj.lastName}` : "Non spécifié",
      salleName: salleObj ? salleObj.name : "Salle non spécifiée",
    });
    setIsDetailsOpen(true);
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <PageHeader emoji="🗓️" title="Mon Emploi du Temps" subtitle="Votre planning de cours hebdomadaire" />
        
        {/* Quick select filter for student */}
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
                    <span className="text-[10px] text-muted italic block text-center mt-12 font-medium">Libre</span>
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
                        <div className="flex items-center gap-1 text-[9px] font-bold font-mono opacity-90 mt-1 border-t border-black/5 dark:border-white/5 pt-1">
                          <Clock className="h-3 w-3 shrink-0" />
                          <span>{s.startTime} - {s.endTime}</span>
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
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Détails du Cours" wide>
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
                <span className="text-[10px] text-muted block uppercase font-sans">Enseignant</span>
                <span className="font-semibold text-ink">{selectedSession.teacherName}</span>
              </div>
            </div>

            <div className="bg-surface border border-line p-4 rounded-xl space-y-3 max-w-md">
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
// 3. SUBJECTS VIEW
// ----------------------------------------------------
function StudentSubjectsView({
  student,
  activeSubs,
  getSessionInfo,
  subjects,
}: {
  student: Student;
  activeSubs: Subscription[];
  getSessionInfo: (id: string) => any;
  subjects: any[];
}) {
  const [selectedSubject, setSelectedSubject] = useState<any | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [sessionFilter, setSessionFilter] = useState("");

  // Filter subjects for sessions the student is active in
  const mySessionIds = new Set(activeSubs.map((sub) => sub.sessionId));
  const mySubjects = subjects.filter((sbj) => mySessionIds.has(sbj.sessionId));

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

  const filteredSubjects = mySubjects.filter((sbj) => {
    // Search keyword
    const matchesSearch =
      sbj.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sbj.description.toLowerCase().includes(searchTerm.toLowerCase());

    // Date range
    const matchesDate = filterByDateRange(sbj.date, dateFilter);

    // Active session
    const matchesSession = sessionFilter ? sbj.sessionId === sessionFilter : true;

    return matchesSearch && matchesDate && matchesSession;
  });

  const handleDownload = (subject: any) => {
    const fileContent = `Titre: ${subject.title}\nDate de publication: ${new Date(
      subject.date
    ).toLocaleDateString()}\n\nDescription:\n${subject.description}`;
    const blob = new Blob([fileContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${subject.title.toLowerCase().replace(/[^a-z0-9]+/g, "_")}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="📄" title="Documents & Fiches d'exercices" subtitle="Consulter les devoirs et supports partagés par vos profs" />

      {/* Filter toolbar */}
      <Card className="border border-line shadow-sm">
        <CardBody className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher par titre, description..."
              className="pl-9 w-full"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="w-44">
              <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-full">
                <option value="">Tous les documents</option>
                <option value="today">Aujourd'hui</option>
                <option value="last_week">Les 7 derniers jours</option>
              </Select>
            </div>

            <div className="w-48">
              <Select value={sessionFilter} onChange={(e) => setSessionFilter(e.target.value)} className="w-full">
                <option value="">Tous mes modules</option>
                {Array.from(mySessionIds).map((sId) => {
                  const info = getSessionInfo(sId);
                  return (
                    <option key={sId} value={sId}>
                      {info?.moduleLabel} ({info?.groupLabel})
                    </option>
                  );
                })}
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      {filteredSubjects.length === 0 ? (
        <Card className="p-8 text-center bg-canvas/30 border border-line">
          <FileText className="h-10 w-10 text-muted mx-auto mb-2" />
          <h3 className="font-bold text-ink">Aucun document trouvé</h3>
          <p className="text-xs text-muted mt-1 font-sans">Aucune ressource ne correspond aux filtres de recherche.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSubjects.map((sbj) => {
            const info = getSessionInfo(sbj.sessionId);

            return (
              <Card key={sbj.id} className="hover:shadow-md hover:scale-[1.01] transition-all duration-200">
                {sbj.image && (
                  <div className="h-28 w-full bg-canvas rounded-t-2xl overflow-hidden border-b border-line">
                    <img src={sbj.image} alt={sbj.title} className="w-full h-full object-cover" />
                  </div>
                )}
                <CardBody className="flex flex-col justify-between h-48">
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="text-sm font-extrabold text-ink line-clamp-1">{sbj.title}</h4>
                      <Badge tone="neutral" className="text-[9px] uppercase font-bold shrink-0">
                        {info?.moduleLabel}
                      </Badge>
                    </div>
                    <span className="text-[9px] text-muted block font-mono">
                      Publié le {new Date(sbj.date).toLocaleDateString()}
                    </span>
                    <p className="text-xs text-muted line-clamp-3 pt-1">{sbj.description}</p>
                  </div>

                  <div className="border-t border-line pt-2.5 mt-2.5 flex items-center justify-between gap-2">
                    <span className="text-[9px] text-primary font-bold">{info?.groupLabel}</span>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex items-center gap-1 text-[10px]"
                        onClick={() => setSelectedSubject(sbj)}
                      >
                        <Eye className="h-3.5 w-3.5" /> Consulter
                      </Button>
                      <Button
                        size="sm"
                        className="flex items-center gap-1 text-[10px]"
                        onClick={() => handleDownload(sbj)}
                      >
                        <Download className="h-3.5 w-3.5" /> Télécharger
                      </Button>
                    </div>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {selectedSubject && (
        <Modal open={!!selectedSubject} onClose={() => setSelectedSubject(null)} title="Consulter le Support de Cours" wide>
          <div className="space-y-5">
            <div className="flex justify-between items-center border-b border-line pb-3">
              <div>
                <h3 className="text-sm font-bold text-ink">{selectedSubject.title}</h3>
                <span className="text-[10px] text-muted block mt-0.5">
                  Publié le {new Date(selectedSubject.date).toLocaleDateString()} pour le groupe{" "}
                  <strong>{getSessionInfo(selectedSubject.sessionId)?.groupLabel}</strong>
                </span>
              </div>
              <Badge tone="primary" className="text-[10px] font-bold">
                {getSessionInfo(selectedSubject.sessionId)?.moduleLabel}
              </Badge>
            </div>

            {selectedSubject.image && (
              <div className="max-h-60 w-full rounded-xl overflow-hidden border border-line">
                <img src={selectedSubject.image} alt={selectedSubject.title} className="w-full h-full object-cover" />
              </div>
            )}

            <div className="space-y-2">
              <span className="text-[10px] text-muted uppercase font-bold block font-sans">Instructions & Contenu</span>
              <p className="text-xs text-ink bg-canvas border border-line p-4 rounded-xl whitespace-pre-wrap leading-relaxed">
                {selectedSubject.description}
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-line">
              <Button variant="outline" onClick={() => handleDownload(selectedSubject)} className="flex items-center gap-1">
                <Download className="h-4 w-4" /> Télécharger le support
              </Button>
              <Button onClick={() => setSelectedSubject(null)}>Fermer</Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ----------------------------------------------------
// 4. PAYMENTS VIEW
// ----------------------------------------------------
function StudentPaymentsView({
  student,
  balanceTx,
}: {
  student: Student;
  balanceTx: any[];
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");

  const myTx = balanceTx.filter((tx) => tx.studentId === student.id);

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

  const filteredTx = myTx.filter((tx) => {
    const matchesSearch = tx.description.toLowerCase().includes(searchTerm.toLowerCase());
    
    // Type recharge vs deduction
    let matchesType = true;
    if (typeFilter === "recharge") matchesType = tx.amount > 0;
    if (typeFilter === "deduction") matchesType = tx.amount < 0;

    const matchesDate = filterByDateRange(tx.date, dateFilter);

    return matchesSearch && matchesType && matchesDate;
  });

  // Calculate Metrics
  const totalRecharged = myTx
    .filter((tx) => tx.amount > 0)
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalDeducted = myTx
    .filter((tx) => tx.amount < 0)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="💵" title="Historique de mes paiements" subtitle="Suivi de vos recharges de cartes et déductions de cours" />

      {/* Metrics Summary Row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="bg-emerald-500/10 border border-emerald-500/20 dark:bg-emerald-950/20">
          <CardBody className="p-4 space-y-1">
            <span className="text-[10px] text-emerald-800 dark:text-emerald-300 font-bold uppercase tracking-wider block font-sans">
              Total des Recharges
            </span>
            <div className="flex justify-between items-baseline">
              <strong className="text-xl text-emerald-700 dark:text-emerald-200 font-black">
                +{totalRecharged} DA
              </strong>
              <ArrowUpCircle className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-rose-500/10 border border-rose-500/20 dark:bg-rose-950/20">
          <CardBody className="p-4 space-y-1">
            <span className="text-[10px] text-rose-800 dark:text-rose-300 font-bold uppercase tracking-wider block font-sans">
              Total Déduit (Cours)
            </span>
            <div className="flex justify-between items-baseline">
              <strong className="text-xl text-rose-700 dark:text-rose-200 font-black">
                -{totalDeducted} DA
              </strong>
              <ArrowDownCircle className="h-5 w-5 text-rose-600 dark:text-rose-400" />
            </div>
          </CardBody>
        </Card>

        <Card className="bg-primary-500/10 border border-primary-500/20 dark:bg-primary-950/20">
          <CardBody className="p-4 space-y-1">
            <span className="text-[10px] text-primary-800 dark:text-primary-300 font-bold uppercase tracking-wider block font-sans">
              Solde Actuel de Carte
            </span>
            <div className="flex justify-between items-baseline">
              <strong className="text-xl text-primary-700 dark:text-primary-200 font-black">
                {student.balance} DA
              </strong>
              <Wallet className="h-5 w-5 text-primary shrink-0" />
            </div>
          </CardBody>
        </Card>
      </div>

      {/* Filter toolbar */}
      <Card className="border border-line shadow-sm">
        <CardBody className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted" />
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Rechercher par désignation/motif..."
              className="pl-9 w-full"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="w-40">
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full">
                <option value="">Toutes opérations</option>
                <option value="recharge">Recharges (+)</option>
                <option value="deduction">Déductions (-)</option>
              </Select>
            </div>

            <div className="w-44">
              <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-full">
                <option value="">Toutes les dates</option>
                <option value="today">Aujourd'hui</option>
                <option value="last_week">Les 7 derniers jours</option>
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Card Grid Layout */}
      {filteredTx.length === 0 ? (
        <Card className="p-12 text-center bg-canvas/30 border border-line border-dashed rounded-2xl">
          <Wallet className="h-10 w-10 text-muted mx-auto mb-2" />
          <p className="text-muted text-xs italic">Aucune transaction financière ne correspond aux filtres de recherche.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredTx.reverse().map((tx) => {
            const isPos = tx.amount > 0;
            const isAbsence = !isPos && tx.description.startsWith("Absence hebdomadaire");
            return (
              <Card key={tx.id} className="relative overflow-visible hover:shadow-md transition-all duration-200">
                <CardBody className="flex flex-col justify-between h-56 relative">
                  <div>
                    {/* Header: Circle initials + Title/Subtitle */}
                    <div className="flex items-start gap-3 mb-4">
                      <div className={`h-10 w-10 rounded-full border text-xs font-bold flex items-center justify-center tracking-wider shrink-0 ${
                        isPos
                          ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600"
                          : isAbsence
                          ? "bg-amber-500/10 border-amber-500/20 text-amber-600"
                          : "bg-rose-500/10 border-rose-500/20 text-rose-600"
                      }`}>
                        {isPos ? "RC" : isAbsence ? "AB" : "DD"}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-ink truncate" title={tx.description}>
                          {tx.description}
                        </h4>
                        <span className="text-[10px] text-muted block font-mono">
                          {tx.date.substring(0, 16).replace("T", " ")}
                        </span>
                      </div>
                    </div>

                    {/* Detailed rows like StudentCard */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs bg-canvas/30 border border-line/60 rounded-xl p-2.5">
                        <div>
                          <span className="text-[10px] text-muted block uppercase font-semibold">Opération</span>
                          <span className="font-semibold text-ink">
                            {isPos ? "Recharge de Solde" : isAbsence ? "Absence hebdomadaire" : "Déduction de Cours"}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-muted block uppercase font-semibold">Type</span>
                          <span className={`font-bold ${isPos ? "text-emerald-600" : isAbsence ? "text-amber-600" : "text-rose-600"}`}>
                            {isPos ? "Crédit (+)" : isAbsence ? "Absence (débit)" : "Débit (-)"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer area like StudentCard */}
                  <div className="border-t border-line/60 pt-3 mt-4 flex items-center justify-between">
                    <span className="text-[10px] text-muted flex items-center gap-1">
                      <span className={`h-1.5 w-1.5 rounded-full ${isPos ? "bg-success" : isAbsence ? "bg-warning" : "bg-danger"}`} />
                      {isAbsence ? "Facturation automatique — absence" : "RFID Card Transaction"}
                    </span>
                    <Badge tone={isPos ? "success" : "danger"} className="font-mono font-bold text-xs px-2.5 py-0.5">
                      {isPos ? `+${tx.amount}` : tx.amount} DA
                    </Badge>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// 5. ANNOUNCEMENTS VIEW
// ----------------------------------------------------
function StudentAnnouncementsView({ announcements }: { announcements: any[] }) {
  const activeAnn = announcements.filter(
    (ann) =>
      (ann.audience === "all" || ann.audience === "students") &&
      new Date(ann.endDate) >= new Date()
  );

  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="📣" title="Annonces Administratives" subtitle="Toutes les alertes et informations scolaires actives" />

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
// 6. PROFILE VIEW
// ----------------------------------------------------
function StudentProfileView({
  student,
  updateItem,
  login,
  user,
}: {
  student: Student;
  updateItem: any;
  login: any;
  user: any;
}) {
  const [firstName, setFirstName] = useState(student.firstName);
  const [lastName, setLastName] = useState(student.lastName);
  const [phone, setPhone] = useState(student.phone);
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

      updateItem("students", student.id, { firstName, lastName, phone });

      // Also update logged-in session state
      login({ ...user, name: `${firstName} ${lastName}` });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="👤" title="Mon Profil Étudiant" subtitle="Consulter et mettre à jour vos coordonnées personnelles" />

      <div className="max-w-2xl">
        <Card>
          <CardBody className="space-y-4">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2 border-b border-line pb-3">
              <User className="h-5 w-5 text-primary" /> Informations Personnelles
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Prénom</label>
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Nom</label>
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Téléphone</label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Email / Identifiant</label>
                <Input value={student.email} disabled className="opacity-60" />
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
