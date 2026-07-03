"use client";

import { useState, useEffect } from "react";
import { useData, uid } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { Check, Clock, X, AlertTriangle, Calendar, UserCheck, Search, Printer, Trash2 } from "lucide-react";
import type { ScheduleSession, AttendanceRecord, AttendanceStatus } from "@/lib/types";
import { studentName } from "@/lib/helpers";
import { formatDA } from "@/lib/utils";
import { printHtmlDocument } from "@/lib/print";

export function AttendancePage() {
  const data = useData();
  const {
    sessions,
    students,
    subscriptions,
    classes,
    modules,
    teachers,
    salles,
    attendance,
    school,
    push,
    deleteFrom,
    updateItem,
  } = data;

  // Active Tab: "sheet" (Today's Sheet) or "history" (Attendance History)
  const [activeTab, setActiveTab] = useState<"sheet" | "history">("sheet");

  // Current system date and time
  const [time, setTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Filtered session selection (for Roll Call sheet)
  const [activeSessionId, setActiveSessionId] = useState<string>("");

  // Track teacher absences locally
  const [absentTeachers, setAbsentTeachers] = useState<Record<string, boolean>>({});

  // History states
  const [histStartDate, setHistStartDate] = useState(
    new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
  );
  const [histEndDate, setHistEndDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [histSearch, setHistSearch] = useState("");
  const [histStatus, setHistStatus] = useState<"all" | "present" | "late">("all");

  // Helpers
  const getDayName = (d: Date): string => {
    const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
    return days[d.getDay()];
  };

  const getDayLabel = (dayKey: string): string => {
    const labels: Record<string, string> = {
      sunday: "Dimanche",
      monday: "Lundi",
      tuesday: "Mardi",
      wednesday: "Mercredi",
      thursday: "Jeudi",
      friday: "Vendredi",
      saturday: "Samedi",
    };
    return labels[dayKey] ?? dayKey;
  };

  // Get sessions scheduled for today
  const todayDayName = getDayName(time);
  const todaysSessions = sessions.filter((s) => s.days.includes(todayDayName as any));

  // Initialize selected session if empty
  useEffect(() => {
    if (todaysSessions.length > 0 && !activeSessionId) {
      setActiveSessionId(todaysSessions[0].id);
    }
  }, [todaysSessions, activeSessionId]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // Get all students enrolled in active session
  const getSessionStudents = (sesId: string) => {
    const sub = subscriptions.find((su) => su.sessionId === sesId);
    if (!sub) return [];
    return students.filter((stu) => stu.subscriptionIds.includes(sub.id));
  };

  // Find attendance record for a student in a session today
  const getStudentTodayAttendance = (studentId: string, sesId: string) => {
    const todayStr = time.toISOString().split("T")[0];
    return attendance.find(
      (a) => a.studentId === studentId && a.sessionId === sesId && a.timestamp.startsWith(todayStr)
    );
  };

  // Toggle/Mark attendance status
  const handleMarkAttendance = (studentId: string, status: AttendanceStatus) => {
    if (!activeSession) return;
    const todayStr = time.toISOString().split("T")[0];
    const sub = subscriptions.find((su) => su.sessionId === activeSession.id);
    const cost = sub?.pricePerSession ?? 0;
    const student = students.find((st) => st.id === studentId);
    if (!student) return;

    const existingAtt = getStudentTodayAttendance(studentId, activeSession.id);

    // If marked absent, we refund/remove cost deduction, and remove attendance
    if (status === "absent") {
      if (existingAtt) {
        // Refund student balance
        if (!student.isFree && existingAtt.amountDeducted > 0) {
          updateItem("students", student.id, {
            balance: student.balance + existingAtt.amountDeducted,
          });
          // Push a refund balance transaction
          push("balanceTx", {
            id: uid("bt"),
            studentId,
            amount: existingAtt.amountDeducted,
            date: new Date().toISOString(),
            type: "topup",
            description: `Remboursement absence: ${modules.find((m) => m.id === activeSession.moduleId)?.name}`,
          });
        }

        // Delete any related unpaidTeacher record
        const unpaid = data.unpaidTeacher?.find(
          (ut) =>
            ut.studentId === studentId &&
            ut.sessionId === activeSession.id &&
            ut.date.startsWith(todayStr)
        );
        if (unpaid) {
          deleteFrom("unpaidTeacher", unpaid.id);
        }

        // Delete attendance record
        deleteFrom("attendance", existingAtt.id);
      }
    } else {
      // Mark present or late
      const actualCost = student.isFree ? 0 : cost;
      if (existingAtt) {
        // Just update status
        updateItem("attendance", existingAtt.id, { status });
      } else {
        // Deduct cost from student balance
        if (!student.isFree && actualCost > 0) {
          updateItem("students", student.id, {
            balance: student.balance - actualCost,
          });
          // Push a deduction transaction
          push("balanceTx", {
            id: uid("bt"),
            studentId,
            amount: -actualCost,
            date: new Date().toISOString(),
            type: "deduction",
            description: `Présence: ${modules.find((m) => m.id === activeSession.moduleId)?.name}`,
          });
        }

        // Add attendance record
        push("attendance", {
          id: uid("att"),
          studentId,
          sessionId: activeSession.id,
          timestamp: new Date().toISOString(),
          amountDeducted: actualCost,
          status,
        });

        // Add to teacher unpaid session if teacher is NOT absent
        if (!absentTeachers[activeSession.id]) {
          const teacher = teachers.find((t) => t.id === activeSession.teacherId);
          const teacherDue =
            teacher?.paymentType === "percentage" ? Math.round((actualCost * (teacher.percentage ?? 0)) / 100) : 0;

          push("unpaidTeacher", {
            id: uid("ut"),
            teacherId: activeSession.teacherId,
            sessionId: activeSession.id,
            studentId,
            amount: teacherDue,
            date: new Date().toISOString(),
            paid: false,
          });
        }
      }
    }
  };

  const handleToggleTeacherAbsent = () => {
    if (!activeSession) return;
    const isCurrentlyAbsent = absentTeachers[activeSession.id] || false;
    setAbsentTeachers({
      ...absentTeachers,
      [activeSession.id]: !isCurrentlyAbsent,
    });

    if (!isCurrentlyAbsent) {
      // If teacher is marked absent, create an absence entry
      const teacher = teachers.find((t) => t.id === activeSession.teacherId);
      if (teacher) {
        push("absences", {
          id: uid("ab"),
          teacherId: teacher.id,
          cost: teacher.paymentType === "monthly" ? 1000 : 0,
          description: `Absence séance ${modules.find((m) => m.id === activeSession.moduleId)?.name} du ${time.toLocaleDateString()}`,
          date: time.toISOString().split("T")[0],
        });
      }
    }
  };

  // Delete attendance record from history list (with refund + unpaidPayout removal)
  const handleDeleteHistoryAttendance = (attId: string) => {
    const att = attendance.find((a) => a.id === attId);
    if (!att) return;
    const student = students.find((s) => s.id === att.studentId);
    const session = sessions.find((s) => s.id === att.sessionId);

    // Refund student if they were charged
    if (student && !student.isFree && att.amountDeducted > 0) {
      updateItem("students", student.id, {
        balance: student.balance + att.amountDeducted,
      });
      push("balanceTx", {
        id: uid("bt"),
        studentId: student.id,
        amount: att.amountDeducted,
        date: new Date().toISOString(),
        type: "topup",
        description: `Remboursement (Annulation Présence): ${
          session ? (modules.find((m) => m.id === session.moduleId)?.name ?? "Séance") : "Séance"
        }`,
      });
    }

    // Remove any teacher unpaid session record generated on this date
    const dayStr = att.timestamp.substring(0, 10);
    const unpaid = data.unpaidTeacher?.find(
      (ut) =>
        ut.studentId === att.studentId &&
        ut.sessionId === att.sessionId &&
        ut.date.startsWith(dayStr)
    );
    if (unpaid) {
      deleteFrom("unpaidTeacher", unpaid.id);
    }

    deleteFrom("attendance", att.id);
  };

  const getClassName = (cid: string) => classes.find((c) => c.id === cid)?.name ?? "-";
  const getModuleName = (mid: string) => modules.find((m) => m.id === mid)?.name ?? "-";
  const getTeacherName = (tid: string) => {
    const t = teachers.find((te) => te.id === tid);
    return t ? `${t.firstName} ${t.lastName}` : "-";
  };

  // Get filtered attendance records for History Tab
  const getFilteredHistory = () => {
    return attendance
      .filter((a) => {
        const dateStr = a.timestamp.substring(0, 10);
        const matchesPeriod = dateStr >= histStartDate && dateStr <= histEndDate;
        if (!matchesPeriod) return false;

        const student = students.find((st) => st.id === a.studentId);
        const name = student ? `${student.firstName} ${student.lastName}`.toLowerCase() : "";
        
        const ses = sessions.find((s) => s.id === a.sessionId);
        const modName = ses ? (modules.find((m) => m.id === ses.moduleId)?.name ?? "").toLowerCase() : "";
        const clName = ses ? (classes.find((c) => c.id === ses.classId)?.name ?? "").toLowerCase() : "";

        const matchesSearch =
          name.includes(histSearch.toLowerCase()) ||
          modName.includes(histSearch.toLowerCase()) ||
          clName.includes(histSearch.toLowerCase());
        
        if (!matchesSearch) return false;

        if (histStatus !== "all" && a.status !== histStatus) return false;

        return true;
      })
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  };

  const filteredHistory = getFilteredHistory();

  // Print history report helper
  const handlePrintHistory = () => {
    const totalScans = filteredHistory.length;
    const presentsCount = filteredHistory.filter(h => h.status === "present").length;
    const latesCount = filteredHistory.filter(h => h.status === "late").length;
    const totalDeductedSum = filteredHistory.reduce((sum, h) => sum + h.amountDeducted, 0);

    const formatDate = (dateStr: string) => {
      if (!dateStr) return "";
      const d = new Date(dateStr);
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
    };

    const formatDateTime = (dateStr: string) => {
      if (!dateStr) return "";
      const d = new Date(dateStr);
      return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    };

    const logoHtml = school.logo
      ? `<img src="${school.logo}" alt="logo" class="school-logo" />`
      : `<div class="school-logo-fallback">🏫</div>`;

    const html = `
      <html>
        <head>
          <title>Registre de Présences - ${school.name}</title>
          <style>
            @media print {
              body { padding: 0; margin: 0; background: #fff; color: #000; font-size: 11px; }
              .no-print { display: none; }
              .page-break { page-break-before: always; }
            }
            * { box-sizing: border-box; }
            body { font-family: 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; padding: 25px; color: #1e1b4b; background-color: #faf9ff; }
            
            /* Letterhead Header */
            .letterhead { display: flex; justify-content: space-between; align-items: stretch; border: 1px solid #e8e6f4; background: #fff; padding: 15px; border-radius: 12px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
            .school-identity { display: flex; align-items: center; gap: 15px; }
            .school-logo, .school-logo-fallback { width: 65px; height: 65px; border-radius: 12px; object-fit: cover; }
            .school-logo-fallback { background: #f5f3ff; border: 1px solid #ddd; display: flex; align-items: center; justify-content: center; font-size: 2.2em; }
            .school-details h2 { margin: 0; font-size: 1.4em; color: #7c3aed; font-weight: 800; }
            .school-details p { margin: 2px 0; font-size: 0.85em; color: #5c567a; }
            
            .school-tax-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 10px; border-left: 2px solid #7c3aed; padding-left: 15px; align-items: center; }
            .tax-item { font-size: 0.78em; color: #5c567a; }
            .tax-item strong { color: #1e1b4b; font-family: monospace; }
            
            /* Document title banner */
            .doc-title-banner { background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%); color: #fff; padding: 15px; border-radius: 12px; margin-bottom: 20px; text-align: center; }
            .doc-title-banner h1 { margin: 0; font-size: 1.5em; font-weight: 800; text-transform: uppercase; letter-spacing: 0.5px; }
            .doc-title-banner p { margin: 5px 0 0; font-size: 0.9em; opacity: 0.9; }

            /* Summary KPIs Cards Panel */
            .kpis-container { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
            .kpi-card { background: #fff; border: 1px solid #e8e6f4; border-top: 4px solid #7c3aed; padding: 12px; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
            .kpi-card-success { border-top-color: #22c55e; }
            .kpi-card-warning { border-top-color: #eab308; }
            .kpi-card-info { border-top-color: #3b82f6; }
            .kpi-card label { display: block; font-size: 0.75em; text-transform: uppercase; color: #5c567a; font-weight: 700; margin-bottom: 4px; }
            .kpi-card strong { font-size: 1.35em; color: #1e1b4b; font-weight: 800; }

            /* Table Frame */
            .frame { border: 1px solid #e8e6f4; border-top: 4px solid #7c3aed; background: #fff; padding: 16px; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.02); }
            .frame h3 { margin: 0 0 12px; font-size: 1.05em; color: #1e1b4b; border-bottom: 1px dashed #e8e6f4; padding-bottom: 6px; }
            
            table { width: 100%; border-collapse: collapse; font-size: 0.9em; }
            th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #f1f0fb; }
            th { background-color: #fcfbff; font-weight: 700; color: #5c567a; font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.3px; }
            tr:last-child td { border-bottom: 0; }
            
            /* Badges */
            .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 0.75em; font-weight: bold; text-align: center; }
            .badge-success { background-color: #dcfce7; color: #15803d; }
            .badge-warning { background-color: #fef9c3; color: #854d0e; }
            
            /* Signatures block */
            .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 40px; }
            .signature-block { border: 1px dashed #c0b6e9; border-radius: 10px; background: #fff; padding: 15px; height: 100px; display: flex; flex-direction: column; justify-content: space-between; }
            .signature-label { font-size: 0.8em; font-weight: bold; text-transform: uppercase; color: #5c567a; text-align: center; }
            
            .meta-text { text-align: center; font-size: 0.75em; color: #999; margin-top: 30px; font-style: italic; }
          </style>
        </head>
        <body>
          <!-- School Letterhead -->
          <div class="letterhead">
            <div class="school-identity">
              ${logoHtml}
              <div class="school-details">
                <h2>${school.name}</h2>
                <p>${school.description}</p>
                <p>📍 ${school.address} | 📞 ${school.phone}</p>
                <p>✉️ ${school.email}</p>
              </div>
            </div>
            <div class="school-tax-grid">
              <div class="tax-item">NIF: <strong>${school.nif || "-"}</strong></div>
              <div class="tax-item">NIS: <strong>${school.nis || "-"}</strong></div>
              <div class="tax-item">RC: <strong>${school.registreCommerce || "-"}</strong></div>
              <div class="tax-item">Art. Fiscal: <strong>${school.articleFiscal || "-"}</strong></div>
            </div>
          </div>

          <!-- Document Title Banner -->
          <div class="doc-title-banner">
            <h1>Registre & Historique des Présences</h1>
            <p>Période du <strong>${formatDate(histStartDate)}</strong> au <strong>${formatDate(histEndDate)}</strong></p>
          </div>

          <!-- Statistics KPIs Panel -->
          <div class="kpis-container">
            <div class="kpi-card">
              <label>Total Scans</label>
              <strong>${totalScans}</strong>
            </div>
            <div class="kpi-card kpi-card-success">
              <label>Présents</label>
              <strong>${presentsCount}</strong>
            </div>
            <div class="kpi-card kpi-card-warning">
              <label>En Retard</label>
              <strong>${latesCount}</strong>
            </div>
            <div class="kpi-card kpi-card-info">
              <label>Recette Cours Déduite</label>
              <strong>${totalDeductedSum} DA</strong>
            </div>
          </div>

          <!-- Detailed attendance logs frame -->
          <div class="frame">
            <h3>Liste des Présences Validées</h3>
            <table>
              <thead>
                <tr>
                  <th>Date & Heure</th>
                  <th>Nom de l'Élève</th>
                  <th>Cours / Séance</th>
                  <th>Enseignant</th>
                  <th style="text-align:center;">Statut</th>
                  <th style="text-align:right;">Montant Déduit</th>
                </tr>
              </thead>
              <tbody>
                ${filteredHistory.length === 0
                  ? `<tr><td colspan="6" style="text-align:center; font-style:italic; color:#999; padding: 20px 0;">Aucune présence à afficher pour les filtres sélectionnés.</td></tr>`
                  : filteredHistory.map((h) => {
                      const s = students.find((st) => st.id === h.studentId);
                      const ses = sessions.find((se) => se.id === h.sessionId);
                      const cl = ses ? classes.find((c) => c.id === ses.classId) : undefined;
                      const mod = ses ? modules.find((m) => m.id === ses.moduleId) : undefined;
                      const t = ses ? teachers.find((te) => te.id === ses.teacherId) : undefined;
                      
                      return `
                        <tr>
                          <td style="font-family:monospace; font-size:0.95em;">${formatDateTime(h.timestamp)}</td>
                          <td style="font-weight:bold;">${s ? `${s.lastName} ${s.firstName}` : "Inconnu"}</td>
                          <td>${mod?.name ?? "-"} <span style="font-size:0.85em; color:#888;">(${cl?.name ?? "-"})</span></td>
                          <td>${t ? `${t.firstName} ${t.lastName}` : "-"}</td>
                          <td style="text-align:center;">
                            <span class="badge ${h.status === "present" ? "badge-success" : "badge-warning"}">
                              ${h.status === "present" ? "Présent" : "En Retard"}
                            </span>
                          </td>
                          <td style="text-align:right; font-weight:bold; color:#b91c1c;">${h.amountDeducted} DA</td>
                        </tr>
                      `;
                    }).join("")
                }
              </tbody>
            </table>
          </div>

          <!-- Signatures block -->
          <div class="signatures">
            <div class="signature-block">
              <span class="signature-label">Le Responsable Pédagogique</span>
            </div>
            <div class="signature-block">
              <span class="signature-label">Le Secrétariat / Caisse</span>
            </div>
          </div>

          <div class="meta-text">
            Registre généré automatiquement par le système centralisé de l'école ${school.name} le ${new Date().toLocaleString("fr-DZ")}
          </div>
        </body>
      </html>
    `;
    printHtmlDocument(html);
  };

  return (
    <div>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
        <PageHeader emoji="✅" title="Présences" subtitle="Suivi et historique des feuilles de présence journalières" />

        <div className="flex gap-2">
          {/* Tab Selection buttons */}
          <Button
            variant={activeTab === "sheet" ? "primary" : "outline"}
            onClick={() => setActiveTab("sheet")}
            className="text-xs"
          >
            <UserCheck className="h-4 w-4" /> Feuille du Jour
          </Button>
          <Button
            variant={activeTab === "history" ? "primary" : "outline"}
            onClick={() => setActiveTab("history")}
            className="text-xs"
          >
            <Calendar className="h-4 w-4" /> Historique & Rapports
          </Button>
        </div>
      </div>

      {activeTab === "sheet" ? (
        // Today's roll call list
        todaysSessions.length === 0 ? (
          <Card className="p-8 text-center bg-canvas/30 border border-line">
            <AlertTriangle className="h-10 w-10 text-warning mx-auto mb-2" />
            <h3 className="font-bold text-ink">Aucun cours aujourd'hui</h3>
            <p className="text-xs text-muted mt-1">
              Aucun emploi du temps n'est configuré pour le {getDayLabel(todayDayName).toLowerCase()}.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left panel: List of sessions for today */}
            <div className="space-y-3">
              <h3 className="text-sm font-bold text-ink mb-2">Séances du jour</h3>
              {todaysSessions.map((s) => {
                const isActive = activeSessionId === s.id;
                const cl = classes.find((c) => c.id === s.classId);
                const isTeacherAbs = absentTeachers[s.id] || false;

                return (
                  <button
                    key={s.id}
                    onClick={() => setActiveSessionId(s.id)}
                    className={`w-full text-start p-4 rounded-2xl border transition-all text-xs space-y-2 block ${
                      isActive
                        ? "bg-gradient-primary border-transparent text-white card-shadow"
                        : "bg-surface border-line text-ink hover:bg-primary-50"
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div>
                        <strong className="text-sm font-bold block">{getModuleName(s.moduleId)}</strong>
                        <span className={isActive ? "text-white/80" : "text-muted"}>
                          {cl?.name} ({cl?.type === "cours" ? cl.coursLevel : cl?.formationLevel})
                        </span>
                      </div>
                      {isTeacherAbs && <Badge tone="danger">Ens. Absent</Badge>}
                    </div>

                    <div className="flex justify-between items-center text-[10px] pt-1.5 border-t border-white/10">
                      <span className={isActive ? "text-white/80" : "text-muted"}>
                        Salle: {salles.find((sl) => sl.id === s.salleId)?.name}
                      </span>
                      <strong className="font-mono">{s.startTime} - {s.endTime}</strong>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Right panel: Active session presence list */}
            <div className="lg:col-span-2 space-y-4">
              {activeSession ? (
                <Card>
                  <CardBody className="space-y-4">
                    {/* Session details header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-line pb-4 gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-ink">
                          {getModuleName(activeSession.moduleId)} — {getClassName(activeSession.classId)}
                        </h3>
                        <span className="text-xs text-muted block mt-0.5">
                          Enseignant: {getTeacherName(activeSession.teacherId)} | Horaires: {activeSession.startTime} - {activeSession.endTime}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant={absentTeachers[activeSession.id] ? "danger" : "outline"}
                          onClick={handleToggleTeacherAbsent}
                          className="text-xs"
                        >
                          {absentTeachers[activeSession.id] ? "Prof marqué ABSENT" : "Signaler absence prof"}
                        </Button>
                      </div>
                    </div>

                    {absentTeachers[activeSession.id] && (
                      <div className="bg-danger/10 border border-danger/20 rounded-xl p-3 text-xs text-danger flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 shrink-0" />
                        <div>
                          <strong>Attention :</strong> L'enseignant est marqué comme absent pour cette séance.
                          Les séances validées ne seront pas ajoutées à son historique de rémunération.
                        </div>
                      </div>
                    )}

                    {/* Students table/list */}
                    <div className="space-y-3">
                      <h4 className="text-xs font-bold text-ink uppercase tracking-wide">Liste des élèves</h4>

                      {getSessionStudents(activeSession.id).length === 0 ? (
                        <p className="text-xs text-muted italic">Aucun étudiant n'est inscrit dans ce module/emploi du temps.</p>
                      ) : (
                        <div className="space-y-2">
                          {getSessionStudents(activeSession.id).map((stu) => {
                            const attToday = getStudentTodayAttendance(stu.id, activeSession.id);
                            const isFree = stu.isFree;

                            return (
                              <div
                                key={stu.id}
                                className="flex flex-col sm:flex-row sm:items-center justify-between p-3 bg-canvas/30 border border-line rounded-xl gap-3 text-xs"
                              >
                                <div>
                                  <strong className="text-ink block">
                                    {stu.firstName} {stu.lastName} {isFree && <Badge tone="success" className="text-[8px] py-0">Gratuit</Badge>}
                                  </strong>
                                  <span className="text-[10px] text-muted">
                                    Solde: {stu.balance} DA | Carte: {stu.rfid}
                                  </span>
                                </div>

                                {/* Attendance selectors */}
                                <div className="flex items-center gap-1.5 self-end sm:self-center">
                                  <button
                                    onClick={() => handleMarkAttendance(stu.id, "present")}
                                    className={`h-8 px-3 rounded-lg font-bold flex items-center gap-1 transition-all ${
                                      attToday?.status === "present"
                                        ? "bg-success text-white shadow-sm"
                                        : "bg-surface border border-line text-muted hover:text-ink"
                                    }`}
                                  >
                                    <Check className="h-3.5 w-3.5" /> Présent
                                  </button>
                                  <button
                                    onClick={() => handleMarkAttendance(stu.id, "late")}
                                    className={`h-8 px-3 rounded-lg font-bold flex items-center gap-1 transition-all ${
                                      attToday?.status === "late"
                                        ? "bg-warning text-white shadow-sm"
                                        : "bg-surface border border-line text-muted hover:text-ink"
                                    }`}
                                  >
                                    <Clock className="h-3.5 w-3.5" /> En Retard
                                  </button>
                                  <button
                                    onClick={() => handleMarkAttendance(stu.id, "absent")}
                                    className={`h-8 px-3 rounded-lg font-bold flex items-center gap-1 transition-all ${
                                      !attToday
                                        ? "bg-danger text-white shadow-sm"
                                        : "bg-surface border border-line text-muted hover:text-ink"
                                    }`}
                                  >
                                    <X className="h-3.5 w-3.5" /> Absent
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </CardBody>
                </Card>
              ) : (
                <p className="text-xs text-muted italic">Veuillez sélectionner un emploi du temps à gauche.</p>
              )}
            </div>
          </div>
        )
      ) : (
        // History tab view
        <div className="space-y-4">
          <div className="bg-surface border border-line p-4 rounded-2xl flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 grid grid-cols-1 md:grid-cols-4 gap-3">
              {/* Search input */}
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={histSearch}
                  onChange={(e) => setHistSearch(e.target.value)}
                  placeholder="Rechercher par élève, module, classe..."
                  className="pl-9 w-full"
                />
              </div>

              {/* Start Date */}
              <div>
                <label className="text-[10px] uppercase font-bold text-muted block mb-1">Date Début</label>
                <Input
                  type="date"
                  value={histStartDate}
                  onChange={(e) => setHistStartDate(e.target.value)}
                  className="w-full"
                />
              </div>

              {/* End Date */}
              <div>
                <label className="text-[10px] uppercase font-bold text-muted block mb-1">Date Fin</label>
                <Input
                  type="date"
                  value={histEndDate}
                  onChange={(e) => setHistEndDate(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>

            <div className="flex gap-2">
              {/* Status Selector */}
              <Select
                value={histStatus}
                onChange={(e) => setHistStatus(e.target.value as any)}
                className="w-32"
              >
                <option value="all">Tous statuts</option>
                <option value="present">Présent</option>
                <option value="late">En Retard</option>
              </Select>

              {/* Print report */}
              <Button onClick={handlePrintHistory} variant="secondary" className="flex items-center gap-2">
                <Printer className="h-4 w-4" /> Imprimer
              </Button>
            </div>
          </div>

          {/* Quick Statistics Row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="bg-surface p-4 border border-line">
              <span className="text-[10px] uppercase font-bold text-muted block">Total des Scans</span>
              <strong className="text-2xl text-ink font-extrabold block mt-1">{filteredHistory.length}</strong>
            </Card>
            <Card className="bg-surface p-4 border border-line">
              <span className="text-[10px] uppercase font-bold text-muted block">Présents</span>
              <strong className="text-2xl text-success font-extrabold block mt-1">
                {filteredHistory.filter((h) => h.status === "present").length}
              </strong>
            </Card>
            <Card className="bg-surface p-4 border border-line">
              <span className="text-[10px] uppercase font-bold text-muted block">En Retard</span>
              <strong className="text-2xl text-warning font-extrabold block mt-1">
                {filteredHistory.filter((h) => h.status === "late").length}
              </strong>
            </Card>
            <Card className="bg-surface p-4 border border-line">
              <span className="text-[10px] uppercase font-bold text-muted block">Montant Déduit</span>
              <strong className="text-2xl text-danger font-extrabold block mt-1">
                {formatDA(filteredHistory.reduce((sum, h) => sum + h.amountDeducted, 0))}
              </strong>
            </Card>
          </div>

          {/* History list card */}
          <Card>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-line bg-canvas/30 text-muted uppercase text-[10px] font-bold">
                      <th className="p-4">Date & Heure</th>
                      <th className="p-4">Élève</th>
                      <th className="p-4">Séance</th>
                      <th className="p-4">Statut</th>
                      <th className="p-4">Déduction</th>
                      <th className="p-4 text-center">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {filteredHistory.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-muted italic">
                          Aucun historique de présence trouvé pour cette période.
                        </td>
                      </tr>
                    ) : (
                      filteredHistory.map((h) => {
                        const stu = students.find((s) => s.id === h.studentId);
                        const ses = sessions.find((s) => s.id === h.sessionId);
                        const cl = ses ? classes.find((c) => c.id === ses.classId) : undefined;
                        const mod = ses ? modules.find((m) => m.id === ses.moduleId) : undefined;
                        const dateObj = new Date(h.timestamp);

                        return (
                          <tr key={h.id} className="hover:bg-primary-50/10">
                            <td className="p-4 font-medium text-ink">
                              <span className="block font-bold">{dateObj.toLocaleDateString()}</span>
                              <span className="text-[10px] text-muted font-mono">
                                {dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                            </td>
                            <td className="p-4">
                              <strong className="text-ink text-sm block">
                                {stu ? `${stu.firstName} ${stu.lastName}` : "Élève Inconnu"}
                              </strong>
                              <span className="text-[10px] text-muted font-mono">{stu?.rfid}</span>
                            </td>
                            <td className="p-4">
                              <strong className="text-ink block">{mod?.name ?? "-"}</strong>
                              <span className="text-[10px] text-muted block mt-0.5">
                                {cl?.name ?? "-"} | {getTeacherName(ses?.teacherId ?? "")}
                              </span>
                            </td>
                            <td className="p-4">
                              <Badge tone={h.status === "present" ? "success" : "warning"}>
                                {h.status === "present" ? "Présent" : "En Retard"}
                              </Badge>
                            </td>
                            <td className="p-4 font-bold text-danger font-mono">
                              -{formatDA(h.amountDeducted)}
                            </td>
                            <td className="p-4 text-center">
                              <button
                                onClick={() => {
                                  if (confirm("Voulez-vous vraiment annuler cette présence? Le solde de l'élève sera remboursé.")) {
                                    handleDeleteHistoryAttendance(h.id);
                                  }
                                }}
                                className="p-2 text-muted hover:text-danger hover:bg-danger/10 rounded-xl transition-colors inline-flex items-center justify-center"
                                title="Annuler et Rembourser"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  );
}
