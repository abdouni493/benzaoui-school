"use client";

/**
 * Student payments statement (printable invoice/receipt) over a selected
 * period — same flow as the teacher report: pick start/end date, generate,
 * print. School letterhead, student identity block, full payments table and
 * period totals with a signature area.
 */

import type {
  BalanceTransaction,
  Group,
  Module,
  Parent,
  ScheduleSession,
  School,
  SchoolClass,
  Student,
  Subscription,
} from "@/lib/types";
import type { Language } from "@/lib/store/settings";
import {
  bannerHtml,
  fmtDate,
  fmtDateTime,
  letterheadHtml,
  metaFooterHtml,
  printDocument,
  signaturesHtml,
} from "@/lib/printTemplates";

const LABELS = {
  fr: {
    docTitle: "Relevé des Paiements Élève",
    period: (s: string, e: string) => `Période du <strong>${s}</strong> au <strong>${e}</strong>`,
    studentInfo: "Informations de l'Élève",
    fullName: "Nom Complet :",
    card: "N° Carte / RFID :",
    phone: "Téléphone :",
    parent: "Parent / Tuteur :",
    classLevel: "Classe / Niveau :",
    enrollments: "Modules & Groupes :",
    none: "Aucune inscription",
    paymentsTitle: "Détail des Paiements & Mouvements de la Période",
    date: "Date",
    description: "Module / Désignation",
    type: "Type",
    method: "Mode",
    amount: "Montant",
    cash: "Espèces",
    typeTopup: "Versement",
    typeDeduction: "Séance",
    typeDebt: "Règl. dette",
    typeRegistration: "Inscription",
    noTx: "Aucune transaction sur cette période.",
    totalsTitle: "Totaux de la Période",
    totalPaid: "TOTAL VERSÉ SUR LA PÉRIODE :",
    totalConsumed: "Total consommé (séances & frais) :",
    txCount: "Nombre d'opérations :",
    currentBalance: "Solde actuel du compte :",
    printedOn: "Date d'impression :",
    signParent: "Signature du Parent / Élève",
    signCashier: "Cachet & Signature de l'École",
    da: "DA",
  },
  ar: {
    docTitle: "كشف مدفوعات التلميذ",
    period: (s: string, e: string) => `الفترة من <strong>${s}</strong> إلى <strong>${e}</strong>`,
    studentInfo: "معلومات التلميذ",
    fullName: "الاسم الكامل :",
    card: "رقم البطاقة / RFID :",
    phone: "الهاتف :",
    parent: "الولي :",
    classLevel: "القسم / المستوى :",
    enrollments: "المواد والأفواج :",
    none: "لا توجد تسجيلات",
    paymentsTitle: "تفاصيل مدفوعات وحركات الفترة",
    date: "التاريخ",
    description: "المادة / البيان",
    type: "النوع",
    method: "طريقة الدفع",
    amount: "المبلغ",
    cash: "نقدًا",
    typeTopup: "دفع / تعبئة",
    typeDeduction: "حصة",
    typeDebt: "تسديد دين",
    typeRegistration: "تسجيل",
    noTx: "لا توجد عمليات في هذه الفترة.",
    totalsTitle: "مجاميع الفترة",
    totalPaid: "إجمالي المدفوع خلال الفترة :",
    totalConsumed: "إجمالي المستهلك (حصص ورسوم) :",
    txCount: "عدد العمليات :",
    currentBalance: "الرصيد الحالي للحساب :",
    printedOn: "تاريخ الطباعة :",
    signParent: "إمضاء الولي / التلميذ",
    signCashier: "ختم وإمضاء المدرسة",
    da: "دج",
  },
} as const;

export interface StudentPaymentsData {
  student: Student;
  school: School;
  lang: Language;
  startDate: string;
  endDate: string;
  balanceTx: BalanceTransaction[];
  subscriptions: Subscription[];
  sessions: ScheduleSession[];
  classes: SchoolClass[];
  modules: Module[];
  groups: Group[];
  parents: Parent[];
}

export function buildStudentPaymentsReport(data: StudentPaymentsData): string {
  const { student, school, lang } = data;
  const L = LABELS[lang];

  const start = data.startDate ? new Date(`${data.startDate}T00:00:00`) : new Date(0);
  const end = data.endDate ? new Date(`${data.endDate}T23:59:59.999`) : new Date();

  const txs = data.balanceTx
    .filter((t) => {
      if (t.studentId !== student.id) return false;
      const d = new Date(t.date);
      return d >= start && d <= end;
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const totalPaid = txs.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const totalConsumed = txs.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  // Identity block: class levels + module/group labels from the enrollments.
  const enrollmentLabels: string[] = [];
  const classLabels = new Set<string>();
  for (const subId of student.subscriptionIds) {
    const sub = data.subscriptions.find((s) => s.id === subId);
    const sess = sub ? data.sessions.find((se) => se.id === sub.sessionId) : undefined;
    if (!sess) continue;
    const cls = data.classes.find((c) => c.id === sess.classId);
    const mod = data.modules.find((m) => m.id === sess.moduleId)?.name ?? "-";
    const grp = data.groups.find((g) => g.id === sess.groupId)?.name ?? "-";
    if (cls) {
      const lvl = cls.type === "cours" ? cls.coursLevel : cls.formationLevel;
      classLabels.add(lvl ? `${cls.name} (${lvl})` : cls.name);
    }
    enrollmentLabels.push(`${mod} — ${grp}`);
  }
  const parentObj = data.parents.find((p) => p.id === student.parentId);

  const typeBadge = (t: BalanceTransaction) => {
    switch (t.type) {
      case "topup":
        return `<span class="badge badge-success">${L.typeTopup}</span>`;
      case "debt_payment":
        return `<span class="badge badge-success">${L.typeDebt}</span>`;
      case "registration":
        return `<span class="badge badge-warning">${L.typeRegistration}</span>`;
      default:
        return `<span class="badge badge-primary">${L.typeDeduction}</span>`;
    }
  };

  const bodyHtml = `
    ${letterheadHtml(school)}
    ${bannerHtml(L.docTitle, L.period(fmtDate(data.startDate, lang), fmtDate(data.endDate, lang)))}

    <div class="frame frame-info" style="margin-bottom:20px;">
      <h3>${L.studentInfo}</h3>
      <table style="margin-top:0;">
        <tr>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.fullName}</td>
          <td style="width:32%; font-weight:bold; font-size:1.1em;">${student.lastName} ${student.firstName}</td>
          <td style="width:18%; font-weight:bold; color:#5c567a;">${L.card}</td>
          <td style="width:32%; font-family:monospace;">${student.rfid || "-"}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; color:#5c567a;">${L.phone}</td>
          <td style="font-family:monospace;">${student.phone || "-"}</td>
          <td style="font-weight:bold; color:#5c567a;">${L.parent}</td>
          <td>${parentObj ? `${parentObj.lastName} ${parentObj.firstName} (${parentObj.phone})` : "-"}</td>
        </tr>
        <tr>
          <td style="font-weight:bold; color:#5c567a;">${L.classLevel}</td>
          <td>${classLabels.size ? [...classLabels].join(" · ") : L.none}</td>
          <td style="font-weight:bold; color:#5c567a;">${L.enrollments}</td>
          <td>${enrollmentLabels.length ? enrollmentLabels.join("<br/>") : L.none}</td>
        </tr>
      </table>
    </div>

    <div class="frame">
      <h3>${L.paymentsTitle}</h3>
      <table>
        <thead>
          <tr>
            <th>${L.date}</th>
            <th>${L.description}</th>
            <th class="ctr">${L.type}</th>
            <th class="ctr">${L.method}</th>
            <th class="num">${L.amount}</th>
          </tr>
        </thead>
        <tbody>
          ${
            txs.length === 0
              ? `<tr><td colspan="5" style="text-align:center; font-style:italic; color:#999;">${L.noTx}</td></tr>`
              : txs
                  .map(
                    (t) => `
            <tr>
              <td>${fmtDateTime(t.date, lang)}</td>
              <td>${t.description}</td>
              <td class="ctr">${typeBadge(t)}</td>
              <td class="ctr">${t.amount > 0 ? L.cash : "—"}</td>
              <td class="num" style="color:${t.amount >= 0 ? "#15803d" : "#b91c1c"};">${t.amount >= 0 ? "+" : ""}${t.amount} ${L.da}</td>
            </tr>`,
                  )
                  .join("")
          }
        </tbody>
      </table>
    </div>

    <div class="summary-card">
      <h3>${L.totalsTitle}</h3>
      <div class="summary-line"><span>${L.txCount}</span><strong>${txs.length}</strong></div>
      <div class="summary-line" style="color:#b91c1c;"><span>${L.totalConsumed}</span><strong>-${totalConsumed} ${L.da}</strong></div>
      <div class="summary-line"><span>${L.currentBalance}</span><strong style="color:${student.balance < 0 ? "#b91c1c" : "#15803d"};">${student.balance} ${L.da}</strong></div>
      <div class="summary-line"><span>${L.printedOn}</span><strong>${fmtDateTime(new Date().toISOString(), lang)}</strong></div>
      <div class="net-pay-box">
        <span>${L.totalPaid}</span>
        <span>${totalPaid} ${L.da}</span>
      </div>
    </div>

    ${signaturesHtml(L.signParent, L.signCashier)}
    ${metaFooterHtml(school.name, lang)}
  `;

  return printDocument({
    title: `${L.docTitle} - ${student.firstName} ${student.lastName}`,
    lang,
    bodyHtml,
  });
}
