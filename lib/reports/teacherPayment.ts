"use client";

/**
 * Teacher payment report (printable) — period-scoped, WITHOUT student names.
 *
 * Sections:
 *   A. Per group assigned to the teacher: enrolled-student count + total
 *      presences over the period.
 *   B. One row per séance held in the period: date, time, group, class level,
 *      salle, number of students present, amount generated (presences × price)
 *      and the teacher's share for that séance.
 *   C. Global totals: séances, presences, gross, the teacher's payment type /
 *      percentage, paid vs UNPAID split, and the net still owed.
 *
 * Paid/unpaid comes from `unpaid_teacher_sessions.paid`: every presence writes
 * one row, and `settle_teacher_percentage()` flips them to paid atomically —
 * so a séance counted here as "unpaid" can never be paid twice.
 */

import type {
  AttendanceRecord,
  Group,
  Module,
  Salle,
  ScheduleSession,
  School,
  SchoolClass,
  Student,
  Subscription,
  Teacher,
  TeacherAbsence,
  TeacherAcompte,
  UnpaidTeacherSession,
} from "@/lib/types";
import type { Language } from "@/lib/store/settings";
import {
  bannerHtml,
  fmtDate,
  letterheadHtml,
  metaFooterHtml,
  printDocument,
  signaturesHtml,
} from "@/lib/printTemplates";

const LABELS = {
  fr: {
    docTitle: "Rapport de Paiement Enseignant",
    period: (s: string, e: string) => `Période du <strong>${s}</strong> au <strong>${e}</strong>`,
    teacherInfo: "Fiche d'Information Enseignant",
    fullName: "Nom Complet :",
    phone: "Téléphone :",
    email: "Email :",
    contract: "Contrat de Rémunération :",
    monthlyContract: (a: number) => `Fixe Mensuel (${a} DA/mois)`,
    percentContract: (p: number) => `Pourcentage (${p}% par séance)`,
    groupsTitle: "A. Synthèse par Groupe (période sélectionnée)",
    group: "Groupe",
    module: "Module",
    classLevel: "Classe / Niveau",
    enrolled: "Élèves inscrits",
    presences: "Présences (période)",
    noGroups: "Aucun groupe affecté à cet enseignant.",
    seancesTitle: "B. Détail des Séances de la Période",
    date: "Date",
    time: "Horaire",
    salle: "Salle",
    presents: "Présents",
    amount: "Montant généré",
    share: "Part enseignant",
    status: "Statut",
    paid: "Payée",
    unpaid: "Non payée",
    partial: "Partiellement payée",
    noSeances: "Aucune séance enregistrée sur cette période.",
    totalsTitle: "C. Totaux & Calcul du Paiement",
    totalSeances: "Nombre total de séances :",
    totalPresences: "Nombre total de présences :",
    gross: "Montant brut total (recettes élèves) :",
    paymentType: "Type de rémunération :",
    monthlyType: "Fixe Mensuel",
    percentType: (p: number) => `Pourcentage — ${p}% par séance`,
    formula: (p: number) => `Formule : (présences × tarif de la séance) × ${p}%`,
    shareGross: "Part enseignant brute (période) :",
    alreadyPaid: "Dont séances déjà réglées :",
    unpaidShare: "Séances NON payées (restant dû) :",
    monthlySalary: "Salaire mensuel contractuel :",
    acomptes: "Acomptes à déduire (période) :",
    absences: "Retenues d'absences (période) :",
    net: "NET À PAYER À L'ENSEIGNANT :",
    signTeacher: "Signature de l'Enseignant",
    signCashier: "Le Secrétariat / Caisse",
    da: "DA",
    all: "—",
  },
  ar: {
    docTitle: "تقرير أجور الأستاذ",
    period: (s: string, e: string) => `الفترة من <strong>${s}</strong> إلى <strong>${e}</strong>`,
    teacherInfo: "بطاقة معلومات الأستاذ",
    fullName: "الاسم الكامل :",
    phone: "الهاتف :",
    email: "البريد الإلكتروني :",
    contract: "نوع الأجر :",
    monthlyContract: (a: number) => `أجر شهري ثابت (${a} دج/شهر)`,
    percentContract: (p: number) => `نسبة مئوية (${p}٪ عن كل حصة)`,
    groupsTitle: "أ. ملخص حسب الفوج (الفترة المختارة)",
    group: "الفوج",
    module: "المادة",
    classLevel: "القسم / المستوى",
    enrolled: "التلاميذ المسجلون",
    presences: "الحضور (الفترة)",
    noGroups: "لا يوجد فوج مسند لهذا الأستاذ.",
    seancesTitle: "ب. تفاصيل حصص الفترة",
    date: "التاريخ",
    time: "التوقيت",
    salle: "القاعة",
    presents: "الحاضرون",
    amount: "المبلغ المحقق",
    share: "نصيب الأستاذ",
    status: "الحالة",
    paid: "مدفوعة",
    unpaid: "غير مدفوعة",
    partial: "مدفوعة جزئيًا",
    noSeances: "لا توجد حصص مسجلة في هذه الفترة.",
    totalsTitle: "ج. المجاميع وحساب الأجر",
    totalSeances: "إجمالي عدد الحصص :",
    totalPresences: "إجمالي عدد الحضور :",
    gross: "المبلغ الإجمالي الخام (مداخيل التلاميذ) :",
    paymentType: "نوع الأجر :",
    monthlyType: "أجر شهري ثابت",
    percentType: (p: number) => `نسبة مئوية — ${p}٪ عن كل حصة`,
    formula: (p: number) => `المعادلة: (الحضور × سعر الحصة) × ${p}٪`,
    shareGross: "نصيب الأستاذ الخام (الفترة) :",
    alreadyPaid: "منها حصص تم تسديدها :",
    unpaidShare: "الحصص غير المدفوعة (المستحق) :",
    monthlySalary: "الراتب الشهري التعاقدي :",
    acomptes: "التسبيقات المقتطعة (الفترة) :",
    absences: "اقتطاعات الغيابات (الفترة) :",
    net: "الصافي المستحق للأستاذ :",
    signTeacher: "إمضاء الأستاذ",
    signCashier: "الأمانة / الصندوق",
    da: "دج",
    all: "—",
  },
} as const;

export interface TeacherReportData {
  teacher: Teacher;
  school: School;
  lang: Language;
  /** YYYY-MM-DD, empty string = open bound */
  startDate: string;
  endDate: string;
  sessions: ScheduleSession[];
  subscriptions: Subscription[];
  students: Student[];
  attendance: AttendanceRecord[];
  unpaidTeacher: UnpaidTeacherSession[];
  acomptes: TeacherAcompte[];
  absences: TeacherAbsence[];
  modules: Module[];
  groups: Group[];
  classes: SchoolClass[];
  salles: Salle[];
}

interface SeanceInstance {
  dateKey: string; // YYYY-MM-DD (local)
  sessionId: string;
  startTime: string;
  endTime: string;
  moduleName: string;
  groupName: string;
  classLabel: string;
  salleName: string;
  presents: number;
  gross: number;
  share: number;
  paidShare: number;
  unpaidShare: number;
  hasDue: boolean;
}

export function buildTeacherPaymentReport(data: TeacherReportData): string {
  const { teacher, school, lang } = data;
  const L = LABELS[lang];

  const start = data.startDate ? new Date(`${data.startDate}T00:00:00`) : new Date(0);
  // End bound is inclusive of the whole selected day.
  const end = data.endDate ? new Date(`${data.endDate}T23:59:59.999`) : new Date();
  const inRange = (iso: string) => {
    const d = new Date(iso);
    return d >= start && d <= end;
  };

  const classLabelOf = (id: string) => {
    const c = data.classes.find((x) => x.id === id);
    if (!c) return "-";
    const lvl = c.type === "cours" ? c.coursLevel : c.formationLevel;
    return lvl ? `${c.name} (${lvl})` : c.name;
  };
  const nameOf = <T extends { id: string; name: string }>(list: T[], id: string) =>
    list.find((x) => x.id === id)?.name ?? "-";

  const teacherSessions = data.sessions.filter((s) => s.teacherId === teacher.id);
  const sessionById = new Map(teacherSessions.map((s) => [s.id, s]));

  // ---- A. Per-group summary -------------------------------------------------
  const groupRows = teacherSessions.map((s) => {
    const sub = data.subscriptions.find((su) => su.sessionId === s.id);
    const enrolled = sub
      ? data.students.filter((stu) => stu.subscriptionIds.includes(sub.id)).length
      : 0;
    const presences = data.attendance.filter(
      (a) => a.sessionId === s.id && inRange(a.timestamp),
    ).length;
    return {
      groupName: nameOf(data.groups, s.groupId),
      moduleName: nameOf(data.modules, s.moduleId),
      classLabel: classLabelOf(s.classId),
      enrolled,
      presences,
    };
  });

  // ---- B. Per-séance instances (attendance = source of truth for presence) --
  const instances = new Map<string, SeanceInstance>();
  const instanceFor = (sessionId: string, dateKey: string): SeanceInstance => {
    const key = `${dateKey}_${sessionId}`;
    let inst = instances.get(key);
    if (!inst) {
      const sess = sessionById.get(sessionId);
      inst = {
        dateKey,
        sessionId,
        startTime: sess?.startTime ?? "",
        endTime: sess?.endTime ?? "",
        moduleName: sess ? nameOf(data.modules, sess.moduleId) : "-",
        groupName: sess ? nameOf(data.groups, sess.groupId) : "-",
        classLabel: sess ? classLabelOf(sess.classId) : "-",
        salleName: sess ? nameOf(data.salles, sess.salleId) : "-",
        presents: 0,
        gross: 0,
        share: 0,
        paidShare: 0,
        unpaidShare: 0,
        hasDue: false,
      };
      instances.set(key, inst);
    }
    return inst;
  };

  data.attendance.forEach((a) => {
    if (!sessionById.has(a.sessionId) || !inRange(a.timestamp)) return;
    const dateKey = new Date(a.timestamp).toLocaleDateString("fr-CA");
    const inst = instanceFor(a.sessionId, dateKey);
    inst.presents += 1;
    inst.gross += a.amountDeducted;
  });

  data.unpaidTeacher.forEach((u) => {
    if (u.teacherId !== teacher.id || !inRange(u.date)) return;
    const dateKey = new Date(u.date).toLocaleDateString("fr-CA");
    const inst = instanceFor(u.sessionId, dateKey);
    inst.share += u.amount;
    if (u.paid) inst.paidShare += u.amount;
    else inst.unpaidShare += u.amount;
    inst.hasDue = true;
  });

  const seances = [...instances.values()].sort(
    (a, b) => a.dateKey.localeCompare(b.dateKey) || a.startTime.localeCompare(b.startTime),
  );

  // ---- C. Totals -------------------------------------------------------------
  const totalPresences = seances.reduce((s, x) => s + x.presents, 0);
  const grossTotal = seances.reduce((s, x) => s + x.gross, 0);
  const shareTotal = seances.reduce((s, x) => s + x.share, 0);
  const paidShareTotal = seances.reduce((s, x) => s + x.paidShare, 0);
  const unpaidShareTotal = seances.reduce((s, x) => s + x.unpaidShare, 0);

  const acomptesTotal = data.acomptes
    .filter((a) => a.teacherId === teacher.id && inRange(a.date))
    .reduce((s, a) => s + a.amount, 0);
  const absencesTotal = data.absences
    .filter((a) => a.teacherId === teacher.id && inRange(a.date))
    .reduce((s, a) => s + a.cost, 0);

  const isPercentage = teacher.paymentType === "percentage";
  const pct = teacher.percentage ?? 0;
  const baseOwed = isPercentage ? unpaidShareTotal : teacher.monthlyAmount ?? 0;
  const netOwed = baseOwed - acomptesTotal - absencesTotal;

  const statusBadge = (inst: SeanceInstance) => {
    if (!inst.hasDue) return `<span class="badge badge-primary">${L.all}</span>`;
    if (inst.unpaidShare > 0 && inst.paidShare > 0)
      return `<span class="badge badge-warning">${L.partial}</span>`;
    if (inst.unpaidShare > 0) return `<span class="badge badge-danger">${L.unpaid}</span>`;
    return `<span class="badge badge-success">${L.paid}</span>`;
  };

  const bodyHtml = `
    ${letterheadHtml(school)}
    ${bannerHtml(L.docTitle, L.period(fmtDate(data.startDate, lang), fmtDate(data.endDate, lang)))}

    <div class="frame frame-info" style="margin-bottom:20px;">
      <h3>${L.teacherInfo}</h3>
      <table style="margin-top:0;">
        <tr>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.fullName}</td>
          <td style="width:32%; font-weight:bold; font-size:1.1em;">${teacher.lastName} ${teacher.firstName}</td>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.phone}</td>
          <td style="width:32%; font-family:monospace;">${teacher.phone || "-"}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; color:#5c567a;">${L.email}</td>
          <td>${teacher.email || "-"}</td>
          <td style="font-weight:bold; color:#5c567a;">${L.contract}</td>
          <td>
            <span class="badge ${isPercentage ? "badge-success" : "badge-warning"}">
              ${isPercentage ? L.percentContract(pct) : L.monthlyContract(teacher.monthlyAmount ?? 0)}
            </span>
          </td>
        </tr>
      </table>
    </div>

    <div class="frames-grid">
      <div class="frame">
        <h3>${L.groupsTitle}</h3>
        <table>
          <thead>
            <tr>
              <th>${L.group}</th>
              <th>${L.module}</th>
              <th>${L.classLevel}</th>
              <th class="ctr">${L.enrolled}</th>
              <th class="ctr">${L.presences}</th>
            </tr>
          </thead>
          <tbody>
            ${
              groupRows.length === 0
                ? `<tr><td colspan="5" style="text-align:center; font-style:italic; color:#999;">${L.noGroups}</td></tr>`
                : groupRows
                    .map(
                      (g) => `
              <tr>
                <td style="font-weight:bold;">${g.groupName}</td>
                <td>${g.moduleName}</td>
                <td>${g.classLabel}</td>
                <td class="ctr"><span class="badge badge-primary">${g.enrolled}</span></td>
                <td class="ctr"><strong>${g.presences}</strong></td>
              </tr>`,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>

      <div class="frame">
        <h3>${L.seancesTitle}</h3>
        <table>
          <thead>
            <tr>
              <th>${L.date}</th>
              <th>${L.time}</th>
              <th>${L.group}</th>
              <th>${L.classLevel}</th>
              <th>${L.salle}</th>
              <th class="ctr">${L.presents}</th>
              <th class="num">${L.amount}</th>
              <th class="num">${L.share}${isPercentage ? ` (${pct}%)` : ""}</th>
              <th class="ctr">${L.status}</th>
            </tr>
          </thead>
          <tbody>
            ${
              seances.length === 0
                ? `<tr><td colspan="9" style="text-align:center; font-style:italic; color:#999;">${L.noSeances}</td></tr>`
                : seances
                    .map(
                      (x) => `
              <tr>
                <td style="font-weight:bold;">${fmtDate(x.dateKey, lang)}</td>
                <td style="font-family:monospace;">${x.startTime} - ${x.endTime}</td>
                <td>${x.groupName}<br/><span style="font-size:0.85em;color:#888;">${x.moduleName}</span></td>
                <td>${x.classLabel}</td>
                <td>${x.salleName}</td>
                <td class="ctr"><strong>${x.presents}</strong></td>
                <td class="num">${x.gross} ${L.da}</td>
                <td class="num" style="color:#7c3aed;">${isPercentage ? `${x.share} ${L.da}` : L.all}</td>
                <td class="ctr">${statusBadge(x)}</td>
              </tr>`,
                    )
                    .join("")
            }
          </tbody>
        </table>
      </div>
    </div>

    <div class="summary-card">
      <h3>${L.totalsTitle}</h3>
      <div class="summary-line"><span>${L.totalSeances}</span><strong>${seances.length}</strong></div>
      <div class="summary-line"><span>${L.totalPresences}</span><strong>${totalPresences}</strong></div>
      <div class="summary-line"><span>${L.gross}</span><strong>${grossTotal} ${L.da}</strong></div>
      <div class="summary-line">
        <span>${L.paymentType}</span>
        <strong>${isPercentage ? L.percentType(pct) : L.monthlyType}</strong>
      </div>
      ${
        isPercentage
          ? `
      <div class="summary-line" style="color:#7c3aed;"><span>${L.formula(pct)}</span><span></span></div>
      <div class="summary-line"><span>${L.shareGross}</span><strong>${shareTotal} ${L.da}</strong></div>
      <div class="summary-line" style="color:#15803d;"><span>${L.alreadyPaid}</span><strong>${paidShareTotal} ${L.da}</strong></div>
      <div class="summary-line" style="color:#b91c1c;"><span>${L.unpaidShare}</span><strong>${unpaidShareTotal} ${L.da}</strong></div>`
          : `
      <div class="summary-line"><span>${L.monthlySalary}</span><strong>${teacher.monthlyAmount ?? 0} ${L.da}</strong></div>`
      }
      <div class="summary-line" style="color:#b91c1c;"><span>${L.acomptes}</span><strong>-${acomptesTotal} ${L.da}</strong></div>
      <div class="summary-line" style="color:#b91c1c;"><span>${L.absences}</span><strong>-${absencesTotal} ${L.da}</strong></div>
      <div class="net-pay-box${netOwed < 0 ? " negative" : ""}">
        <span>${L.net}</span>
        <span>${netOwed} ${L.da}</span>
      </div>
    </div>

    ${signaturesHtml(L.signTeacher, L.signCashier)}
    ${metaFooterHtml(school.name, lang)}
  `;

  return printDocument({
    title: `${L.docTitle} - ${teacher.firstName} ${teacher.lastName}`,
    lang,
    bodyHtml,
  });
}
