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
  Users,
  Calendar,
  FileText,
  DollarSign,
  Megaphone,
  User,
  AlertTriangle,
  Clock,
  Eye,
  Bell,
  MapPin,
  BookOpen,
  Search,
  Download,
  ArrowUpCircle,
  ArrowDownCircle,
  Wallet
} from "lucide-react";
import type { Parent, Student, Subscription, ScheduleSession } from "@/lib/types";

interface PageProps {
  slug: string;
}

export function ParentPages({ slug }: PageProps) {
  const { user, login } = useSession();
  const {
    parents,
    students,
    subscriptions,
    sessions,
    modules,
    classes,
    groups,
    announcements,
    balanceTx,
    subjects,
    notifications,
    updateItem,
  } = useData();

  const parent = parents.find((p) => p.id === user?.entityId);

  if (!parent) {
    return (
      <div className="p-8 text-center text-xs">
        <AlertTriangle className="h-8 w-8 text-danger mx-auto mb-2" />
        <h3 className="font-bold text-ink">Erreur de Profil</h3>
        <p className="text-muted mt-1">Impossible de charger le profil parent. Veuillez vous reconnecter.</p>
      </div>
    );
  }

  // Children list
  const myChildren = students.filter((s) => parent.childIds.includes(s.id));

  // Helpers
  const getSessionInfo = (sesId: string) => {
    const s = sessions.find((se) => se.id === sesId);
    if (!s) return null;
    const cl = classes.find((c) => c.id === s.classId)?.name ?? "";
    const mod = modules.find((m) => m.id === s.moduleId)?.name ?? "";
    const gr = groups.find((g) => g.id === s.groupId)?.name ?? "";
    return { classLabel: cl, moduleLabel: mod, groupLabel: gr, ...s };
  };

  switch (slug) {
    case "home":
      return (
        <ParentHomeView
          parent={parent}
          myChildren={myChildren}
          getSessionInfo={getSessionInfo}
          announcements={announcements}
          notifications={notifications}
        />
      );
    case "my-children":
      return <ParentChildrenView myChildren={myChildren} getSessionInfo={getSessionInfo} subscriptions={subscriptions} />;
    case "schedule":
      return <ParentScheduleView myChildren={myChildren} getSessionInfo={getSessionInfo} subscriptions={subscriptions} />;
    case "subjects":
      return <ParentSubjectsView myChildren={myChildren} getSessionInfo={getSessionInfo} subjects={subjects} subscriptions={subscriptions} />;
    case "payments":
      return <ParentPaymentsView myChildren={myChildren} balanceTx={balanceTx} />;
    case "notifications":
      return <ParentNotificationsView parent={parent} notifications={notifications} myChildren={myChildren} />;
    case "announcements":
      return <ParentAnnouncementsView announcements={announcements} />;
    case "account":
      return <ParentProfileView parent={parent} updateItem={updateItem} login={login} user={user} />;
    default:
      return <div className="p-4 text-xs text-muted">Page non trouvée</div>;
  }
}

// ----------------------------------------------------
// 1. HOME VIEW
// ----------------------------------------------------
function ParentHomeView({
  parent,
  myChildren,
  getSessionInfo,
  announcements,
  notifications,
}: {
  parent: Parent;
  myChildren: Student[];
  getSessionInfo: (id: string) => any;
  announcements: any[];
  notifications: any[];
}) {
  // Low balance alert trigger if any child has balance <= 500
  const lowBalanceChildren = myChildren.filter((c) => c.balance <= 500 && !c.isFree);
  const parentAlerts = notifications.filter((n) => n.parentId === parent.id);
  const activeAnn = announcements.filter(
    (ann) =>
      (ann.audience === "all" || ann.audience === "parents") &&
      new Date(ann.endDate) >= new Date()
  );

  return (
    <div className="space-y-6 text-xs">
      <PageHeader
        emoji="🏠"
        title={`Espace Tuteur : ${parent.firstName} ${parent.lastName}`}
        subtitle="Suivi de la scolarité et de la trésorerie de vos enfants"
      />

      {lowBalanceChildren.length > 0 && (
        <div className="p-4 bg-danger/10 border border-danger/25 rounded-2xl space-y-2 text-danger">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 shrink-0 animate-pulse" />
            <strong className="text-xs font-bold">Alerte : Solde critique détecté !</strong>
          </div>
          <p className="text-[11px] opacity-90 leading-relaxed">
            Les enfants suivants possèdent un solde insuffisant (seuil &lt; 500 DA). Veuillez effectuer une recharge en réception :
          </p>
          <ul className="list-disc pl-5 font-bold">
            {lowBalanceChildren.map((c) => (
              <li key={c.id}>
                {c.firstName} {c.lastName} ({c.balance} DA)
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Children stats grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {myChildren.map((child) => (
          <Card key={child.id}>
            <CardBody className="flex justify-between items-center h-28">
              <div>
                <span className="text-muted font-bold block text-[10px] uppercase">Solde : {child.firstName}</span>
                <strong className={`text-2xl font-extrabold block mt-1 ${child.balance < 0 ? "text-danger" : "text-primary"}`}>
                  {child.isFree ? "Gratuit" : `${child.balance} DA`}
                </strong>
                <span className="text-[9px] text-muted block mt-1 font-mono">Carte RFID: {child.rfid}</span>
              </div>
              <div className="h-10 w-10 bg-primary-50 rounded-xl flex items-center justify-center text-primary font-bold">
                {child.firstName[0]}{child.lastName[0]}
              </div>
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Messages / Notifications */}
        <Card>
          <CardBody className="space-y-4">
            <h3 className="font-bold text-ink flex items-center gap-2 border-b border-line pb-3">
              <Bell className="h-5 w-5 text-primary" /> Messages Administratifs
            </h3>
            {parentAlerts.length === 0 ? (
              <p className="text-xs text-muted italic p-4 text-center">Aucun message de la direction.</p>
            ) : (
              <div className="space-y-3 max-h-56 overflow-y-auto">
                {parentAlerts.reverse().map((n) => (
                  <div key={n.id} className="p-3 bg-canvas/40 border border-line rounded-xl space-y-1">
                    <strong className="text-ink font-bold text-xs block">{n.title}</strong>
                    <p className="text-muted text-[11px] leading-relaxed">{n.description}</p>
                    <span className="text-[9px] text-muted block text-right">Reçu le {new Date(n.date).toLocaleDateString()}</span>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* School Announcements */}
        <Card>
          <CardBody className="space-y-4">
            <h3 className="font-bold text-ink flex items-center gap-2 border-b border-line pb-3">
              <Megaphone className="h-5 w-5 text-primary" /> Annonces Générales
            </h3>
            {activeAnn.length === 0 ? (
              <p className="text-xs text-muted italic p-4 text-center">Aucune annonce active.</p>
            ) : (
              <div className="space-y-3 max-h-56 overflow-y-auto">
                {activeAnn.map((ann) => (
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
// 2. CHILDREN LIST VIEW
// ----------------------------------------------------
function ParentChildrenView({
  myChildren,
  getSessionInfo,
  subscriptions,
}: {
  myChildren: Student[];
  getSessionInfo: (id: string) => any;
  subscriptions: Subscription[];
}) {
  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="👦" title="Mes Enfants" subtitle="Liste des profils et détails de vos enfants rattachés" />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {myChildren.map((c) => {
          const childSubs = subscriptions.filter((sub) => c.subscriptionIds.includes(sub.id));

          return (
            <Card key={c.id}>
              <CardBody className="space-y-4">
                <div className="flex justify-between items-start border-b border-line pb-3">
                  <div>
                    <h3 className="font-bold text-sm text-ink">{c.firstName} {c.lastName}</h3>
                    <span className="text-[10px] text-muted font-mono block">RFID: {c.rfid}</span>
                  </div>
                  <Badge tone={c.balance < 0 ? "danger" : "primary"}>
                    {c.balance} DA
                  </Badge>
                </div>

                <div className="space-y-2">
                  <span className="font-bold text-ink text-[10px] block uppercase">Cours & Groupes :</span>
                  {childSubs.length === 0 ? (
                    <p className="text-[10px] text-muted italic">Aucun abonnement de groupe actif.</p>
                  ) : (
                    childSubs.map((sub) => {
                      const info = getSessionInfo(sub.sessionId);
                      return (
                        <div key={sub.id} className="p-2.5 bg-canvas/30 rounded-lg border border-line flex justify-between items-center text-[10px]">
                          <div>
                            <strong className="text-ink block">{info?.moduleLabel}</strong>
                            <span className="text-muted block">{info?.classLabel} ({info?.groupLabel})</span>
                          </div>
                          <span className="font-mono text-primary font-bold">{info?.startTime} - {info?.endTime}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ----------------------------------------------------
// 3. SCHEDULE VIEW WITH SELECT FILTER
// ----------------------------------------------------
function ParentScheduleView({
  myChildren,
  getSessionInfo,
  subscriptions,
}: {
  myChildren: Student[];
  getSessionInfo: (id: string) => any;
  subscriptions: Subscription[];
}) {
  const { teachers, salles } = useData();
  const [selectedChildId, setSelectedChildId] = useState(myChildren[0]?.id || "");
  const [filterSessionId, setFilterSessionId] = useState("");
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const daysOfWeek = ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"];

  const currentChild = myChildren.find((c) => c.id === selectedChildId);
  const childSubs = currentChild ? subscriptions.filter((sub) => currentChild.subscriptionIds.includes(sub.id)) : [];
  const childSessions = childSubs.map((sub) => getSessionInfo(sub.sessionId)).filter(Boolean) as any[];

  // Filter based on session choice
  const filteredSessions = filterSessionId
    ? childSessions.filter((s) => s.id === filterSessionId)
    : childSessions;

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

  // Reset session filter when switching child
  const handleChildChange = (cid: string) => {
    setSelectedChildId(cid);
    setFilterSessionId("");
  };

  return (
    <div className="space-y-6 text-xs">
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <PageHeader emoji="🗓️" title="Planning des Cours" subtitle="Emploi du temps hebdomadaire par enfant" />

        <div className="flex flex-wrap items-center gap-3">
          {/* Child Select */}
          {myChildren.length > 1 && (
            <div className="w-52">
              <Select value={selectedChildId} onChange={(e) => handleChildChange(e.target.value)} className="w-full">
                {myChildren.map((c) => (
                  <option key={c.id} value={c.id}>
                    Enfant : {c.firstName} {c.lastName}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {/* Course filter select */}
          {childSessions.length > 0 && (
            <div className="w-52">
              <Select value={filterSessionId} onChange={(e) => setFilterSessionId(e.target.value)} className="w-full">
                <option value="">Tous les cours</option>
                {childSessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.moduleLabel} ({s.groupLabel})
                  </option>
                ))}
              </Select>
            </div>
          )}
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
// 4. SUBJECTS VIEW
// ----------------------------------------------------
function ParentSubjectsView({
  myChildren,
  getSessionInfo,
  subjects,
  subscriptions,
}: {
  myChildren: Student[];
  getSessionInfo: (id: string) => any;
  subjects: any[];
  subscriptions: Subscription[];
}) {
  const [selectedSubject, setSelectedSubject] = useState<any | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [childFilter, setChildFilter] = useState("");

  // Get active session IDs based on child filter
  const getFilteredSessionIds = () => {
    if (childFilter) {
      const kid = myChildren.find((c) => c.id === childFilter);
      if (!kid) return new Set<string>();
      return new Set(
        subscriptions.filter((sub) => kid.subscriptionIds.includes(sub.id)).map((sub) => sub.sessionId)
      );
    }
    // Consolidate across all kids
    return new Set(
      myChildren.flatMap((c) =>
        subscriptions.filter((sub) => c.subscriptionIds.includes(sub.id)).map((sub) => sub.sessionId)
      )
    );
  };

  const activeSessionIds = getFilteredSessionIds();
  const matchedSubjects = subjects.filter((sbj) => activeSessionIds.has(sbj.sessionId));

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

  const filteredSubjects = matchedSubjects.filter((sbj) => {
    const matchesSearch =
      sbj.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      sbj.description.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesDate = filterByDateRange(sbj.date, dateFilter);

    return matchesSearch && matchesDate;
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
      <PageHeader emoji="📄" title="Fiches & Exercices des Enfants" subtitle="Ressources de cours partagées pour vos enfants" />

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
            {myChildren.length > 1 && (
              <div className="w-48">
                <Select value={childFilter} onChange={(e) => setChildFilter(e.target.value)} className="w-full">
                  <option value="">Tous les enfants</option>
                  {myChildren.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="w-44">
              <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-full">
                <option value="">Tous les documents</option>
                <option value="today">Aujourd'hui</option>
                <option value="last_week">Les 7 derniers jours</option>
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      {filteredSubjects.length === 0 ? (
        <Card className="p-8 text-center bg-canvas/30 border border-line">
          <FileText className="h-10 w-10 text-muted mx-auto mb-2" />
          <h3 className="font-bold text-ink">Aucun document trouvé</h3>
          <p className="text-xs text-muted mt-1 font-sans">Aucun support de cours ne correspond aux filtres actuels.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSubjects.map((sbj) => {
            const info = getSessionInfo(sbj.sessionId);
            return (
              <Card key={sbj.id} className="hover:shadow-md hover:scale-[1.01] transition-all duration-200">
                <CardBody className="flex flex-col justify-between h-48">
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="text-sm font-bold text-ink line-clamp-1">{sbj.title}</h4>
                      <Badge tone="neutral" className="text-[9px] uppercase font-bold shrink-0">
                        {info?.moduleLabel}
                      </Badge>
                    </div>
                    <span className="text-[9px] text-muted block font-mono">Date: {sbj.date.substring(0, 10)}</span>
                    <p className="text-xs text-muted line-clamp-3 pt-1">{sbj.description}</p>
                  </div>
                  <div className="border-t border-line pt-2.5 mt-2.5 flex justify-between items-center">
                    <span className="text-[9px] text-primary font-bold">{info?.groupLabel}</span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="flex items-center gap-1 text-[10px]" onClick={() => setSelectedSubject(sbj)}>
                        <Eye className="h-3.5 w-3.5" /> Consulter
                      </Button>
                      <Button size="sm" className="flex items-center gap-1 text-[10px]" onClick={() => handleDownload(sbj)}>
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
        <Modal open={!!selectedSubject} onClose={() => setSelectedSubject(null)} title="Consulter le Support" wide>
          <div className="space-y-5">
            <div className="flex justify-between items-center border-b border-line pb-3">
              <div>
                <h3 className="text-sm font-bold text-ink">{selectedSubject.title}</h3>
                <span className="text-[10px] text-muted block mt-0.5 font-sans">
                  Date de publication: {new Date(selectedSubject.date).toLocaleDateString()} pour le groupe{" "}
                  <strong>{getSessionInfo(selectedSubject.sessionId)?.groupLabel}</strong>
                </span>
              </div>
              <Badge tone="primary" className="text-[10px] font-bold">
                {getSessionInfo(selectedSubject.sessionId)?.moduleLabel}
              </Badge>
            </div>

            <div className="space-y-2">
              <span className="text-[10px] text-muted uppercase font-bold block font-sans">Contenu du cours / Devoir</span>
              <p className="text-xs text-ink bg-canvas border border-line p-4 rounded-xl whitespace-pre-wrap leading-relaxed">
                {selectedSubject.description}
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-2 border-t border-line">
              <Button variant="outline" onClick={() => handleDownload(selectedSubject)} className="flex items-center gap-1">
                <Download className="h-4 w-4" /> Télécharger le fichier
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
// 5. PAYMENTS HISTORY VIEW
// ----------------------------------------------------
function ParentPaymentsView({
  myChildren,
  balanceTx,
}: {
  myChildren: Student[];
  balanceTx: any[];
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [dateFilter, setDateFilter] = useState("");
  const [childFilter, setChildFilter] = useState("");

  const childIds = new Set(myChildren.map((c) => c.id));
  
  // Filter transactions based on active filters
  const filteredTx = balanceTx.filter((tx) => {
    // Is it for one of my children?
    if (!childIds.has(tx.studentId)) return false;

    // Child filter
    if (childFilter && tx.studentId !== childFilter) return false;

    // Search description
    if (searchTerm && !tx.description.toLowerCase().includes(searchTerm.toLowerCase())) return false;

    // Transaction type
    if (typeFilter === "recharge" && tx.amount <= 0) return false;
    if (typeFilter === "deduction" && tx.amount >= 0) return false;

    // Date range helper
    if (dateFilter) {
      const itemDate = new Date(tx.date);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const compareDate = new Date(itemDate);
      compareDate.setHours(0, 0, 0, 0);

      const diffTime = today.getTime() - compareDate.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      if (dateFilter === "today" && diffDays !== 0) return false;
      if (dateFilter === "last_week" && (diffDays < 0 || diffDays > 7)) return false;
    }

    return true;
  });

  const getChildName = (sid: string) => {
    const c = myChildren.find((kid) => kid.id === sid);
    return c ? `${c.firstName} ${c.lastName}` : "Élève inconnu";
  };

  // Metrics (based on child filter or all kids)
  const activeTx = balanceTx.filter((tx) => {
    if (!childIds.has(tx.studentId)) return false;
    if (childFilter && tx.studentId !== childFilter) return false;
    return true;
  });

  const totalRecharged = activeTx
    .filter((tx) => tx.amount > 0)
    .reduce((sum, tx) => sum + tx.amount, 0);

  const totalDeducted = activeTx
    .filter((tx) => tx.amount < 0)
    .reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  const currentBalance = childFilter
    ? myChildren.find((c) => c.id === childFilter)?.balance || 0
    : myChildren.reduce((sum, c) => sum + c.balance, 0);

  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="💵" title="Historique Financier" subtitle="Recharges et déductions de cours consolidées" />

      {/* Metrics Summary cards */}
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
              {childFilter ? "Solde de l'Élève" : "Solde Consolidé"}
            </span>
            <div className="flex justify-between items-baseline">
              <strong className="text-xl text-primary-700 dark:text-primary-200 font-black">
                {currentBalance} DA
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
              placeholder="Rechercher par motif, description..."
              className="pl-9 w-full"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {myChildren.length > 1 && (
              <div className="w-48">
                <Select value={childFilter} onChange={(e) => setChildFilter(e.target.value)} className="w-full">
                  <option value="">Tous les enfants</option>
                  {myChildren.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="w-40">
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full">
                <option value="">Toutes opérations</option>
                <option value="recharge">Recharges (+)</option>
                <option value="deduction">Déductions (-)</option>
              </Select>
            </div>

            <div className="w-40">
              <Select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)} className="w-full">
                <option value="">Toutes les dates</option>
                <option value="today">Aujourd'hui</option>
                <option value="last_week">Les 7 derniers jours</option>
              </Select>
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Cards list */}
      {filteredTx.length === 0 ? (
        <Card className="p-12 text-center bg-canvas/30 border border-line border-dashed rounded-2xl">
          <Wallet className="h-10 w-10 text-muted mx-auto mb-2" />
          <p className="text-muted text-xs italic">Aucune transaction de paiement trouvée avec ces filtres.</p>
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

                    {/* Detailed rows like Student/Teacher card */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs bg-canvas/30 border border-line/60 rounded-xl p-2.5">
                        <div>
                          <span className="text-[10px] text-muted block uppercase font-semibold">Opération</span>
                          <span className="font-semibold text-ink">
                            {isPos ? "Recharge" : isAbsence ? "Absence hebdo." : "Déduction"}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-muted block uppercase font-semibold">Élève</span>
                          <span className="font-bold text-primary truncate max-w-[120px] block">
                            {getChildName(tx.studentId)}
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
// 6. NOTIFICATIONS VIEW
// ----------------------------------------------------
function ParentNotificationsView({
  parent,
  notifications,
  myChildren,
}: {
  parent: Parent;
  notifications: any[];
  myChildren: Student[];
}) {
  const alerts = notifications.filter((n) => n.parentId === parent.id);

  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="🔔" title="Notifications & Alertes" subtitle="Toutes les alertes et messages administratifs reçus" />

      {alerts.length === 0 ? (
        <Card className="p-8 text-center bg-canvas/30 border border-line">
          <Bell className="h-10 w-10 text-muted mx-auto mb-2 animate-pulse" />
          <h3 className="font-bold text-ink font-sans">Aucune notification</h3>
          <p className="text-xs text-muted mt-1">Vous n'avez reçu aucun message d'alerte pour le moment.</p>
        </Card>
      ) : (
        <div className="space-y-4 max-w-3xl">
          {alerts.reverse().map((n) => (
            <Card key={n.id} className={n.auto ? "border-l-4 border-l-warning" : "border-l-4 border-l-primary"}>
              <CardBody className="space-y-1.5">
                <div className="flex justify-between items-center">
                  <strong className="text-ink text-sm font-bold">{n.title}</strong>
                  <span className="text-[9px] text-muted font-mono">{n.date.substring(0, 16).replace("T", " ")}</span>
                </div>
                <p className="text-muted text-xs leading-relaxed">{n.description}</p>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ----------------------------------------------------
// 7. ANNOUNCEMENTS VIEW
// ----------------------------------------------------
function ParentAnnouncementsView({ announcements }: { announcements: any[] }) {
  const activeAnn = announcements.filter(
    (ann) =>
      (ann.audience === "all" || ann.audience === "parents") &&
      new Date(ann.endDate) >= new Date()
  );

  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="📣" title="Annonces Administratives" subtitle="Toutes les alertes scolaires et évènements" />

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
                  <span>Expire le: {ann.endDate}</span>
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
function ParentProfileView({
  parent,
  updateItem,
  login,
  user,
}: {
  parent: Parent;
  updateItem: any;
  login: any;
  user: any;
}) {
  const [firstName, setFirstName] = useState(parent.firstName);
  const [lastName, setLastName] = useState(parent.lastName);
  const [phone, setPhone] = useState(parent.phone);
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

      updateItem("parents", parent.id, { firstName, lastName, phone });

      login({ ...user, name: `${firstName} ${lastName}` });
    } catch (err) {
      alert(err instanceof Error ? err.message : "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 text-xs">
      <PageHeader emoji="👤" title="Mon Profil Parent" subtitle="Gérer vos identifiants d'accès et vos contacts" />

      <div className="max-w-2xl">
        <Card>
          <CardBody className="space-y-4">
            <h3 className="text-sm font-bold text-ink flex items-center gap-2 border-b border-line pb-3">
              <User className="h-5 w-5 text-primary" /> Coordonnées du Tuteur
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
                <label className="block text-xs font-semibold text-muted mb-1">Email / Identifiant</label>
                <Input value={parent.email} disabled className="opacity-60" />
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
