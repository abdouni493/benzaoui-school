"use client";

import { useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Trash2,
  Edit,
  Eye,
  Plus,
  Calendar,
  Search,
  MoreVertical,
  Printer,
  X,
  Check,
  Clock,
  Filter,
  LayoutGrid,
  Table as TableIcon,
  User,
  MapPin,
  Users,
} from "lucide-react";
import type { IndependentSession, Student } from "@/lib/types";
import { printHtmlDocument } from "@/lib/print";
import { fmtDate, fmtDateTime, printDocument } from "@/lib/printTemplates";
import { formatDateFr } from "@/lib/helpers";
import { useSettings } from "@/lib/store/settings";

/** Everything the séance libre receipt needs, captured at creation time. */
interface CasualReceiptData {
  personName: string;
  isRegisteredStudent: boolean;
  /** neither a known student nor a typed name: an anonymous passager */
  isAnonymous?: boolean;
  itemLabel: string;
  teacherName?: string;
  classLabel?: string;
  timeLabel?: string;
  daysLabel?: string;
  price: number;
  /** séance offerte: nothing was cashed, this is what it would have cost */
  isFree?: boolean;
  waived?: number;
  date: string;
  createdAt: string;
}

/** One searchable item the reception can attach a séance libre to: either a
 *  regular course module, or a "séance libre" timing created in the planner. */
interface SeanceOption {
  key: string;
  kind: "cours" | "timing";
  label: string;
  price: number;
  sessionId: string;
  moduleName: string;
  classLabel: string;
  groupLabel: string;
  salleLabel: string;
  teacherName: string;
  teacherIsPassager: boolean;
  daysLabel: string;
  timeLabel: string;
  periodLabel?: string;
}

const RECEIPT_LABELS = {
  fr: {
    docTitle: "REÇU — SÉANCE LIBRE",
    receiptNo: "N°",
    person: "Élève / Passager",
    registered: "Élève inscrit",
    passenger: "Passager",
    anonymous: "Passager (anonyme)",
    item: "Séance",
    teacher: "Enseignant",
    classLevel: "Classe",
    days: "Jours",
    time: "Horaire",
    date: "Date",
    method: "Règlement",
    cash: "Espèces",
    paidOn: "Encaissé le",
    total: "TOTAL PAYÉ",
    offeredTotal: "SÉANCE OFFERTE",
    offeredNote: (v: string) => `Valeur offerte par l'école : ${v}`,
    signCashier: "La Caisse",
    thanks: "Merci de conserver ce reçu.",
    da: "DA",
  },
  ar: {
    docTitle: "وصل — حصة حرة",
    receiptNo: "رقم",
    person: "التلميذ / الزائر",
    registered: "تلميذ مسجل",
    passenger: "زائر",
    anonymous: "زائر (بدون اسم)",
    item: "الحصة",
    teacher: "الأستاذ",
    classLevel: "القسم",
    days: "الأيام",
    time: "التوقيت",
    date: "التاريخ",
    method: "الدفع",
    cash: "نقدًا",
    paidOn: "تم التحصيل في",
    total: "المبلغ المدفوع",
    offeredTotal: "حصة مجانية",
    offeredNote: (v: string) => `قيمة الحصة المقدمة من المدرسة : ${v}`,
    signCashier: "الصندوق",
    thanks: "يرجى الاحتفاظ بهذا الوصل.",
    da: "دج",
  },
} as const;

/** 80 mm cash-drawer ticket: the séance libre receipt is handed over at the
 *  desk in a second, so it prints as a narrow slip instead of a full A4 page.
 *  Appended AFTER `PRINT_BASE_CSS`, so these rules win over the A4 chrome. */
const TICKET_CSS = `
  @page { size: 80mm auto; margin: 3mm; }
  @media print { body { padding: 0; margin: 0; font-size: 10px; } }
  body { width: 74mm; margin: 0 auto; padding: 6px 0; background: #fff; color: #111; font-size: 11px; }
  .ticket { width: 100%; }
  .ticket .school { display: block; font-size: 1.25em; font-weight: 800; letter-spacing: .3px; }
  .ticket .head { text-align: center; line-height: 1.35; padding-bottom: 6px; border-bottom: 1px dashed #999; }
  .ticket .head span { display: block; font-size: .85em; color: #444; }
  .ticket .title { margin: 7px 0 2px; text-align: center; font-weight: 800; font-size: 1.02em; letter-spacing: .5px; }
  .ticket .num { text-align: center; font-family: monospace; font-size: .85em; color: #444; margin-bottom: 7px; }
  .ticket table { width: 100%; border-collapse: collapse; font-size: .92em; margin: 0; }
  .ticket th, .ticket td { padding: 2.5px 0; border: 0; background: none; text-transform: none; letter-spacing: 0; font-size: 1em; }
  .ticket th { width: 38%; text-align: start; font-weight: 600; color: #555; }
  .ticket td { text-align: end; font-weight: 700; color: #111; }
  .ticket .total { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; padding: 6px 8px; border: 1.5px solid #111; border-radius: 4px; font-weight: 800; font-size: 1.1em; }
  .ticket .total.free { border-style: dashed; }
  .ticket .note { margin: 5px 0 0; text-align: center; font-size: .82em; font-style: italic; color: #444; }
  .ticket .sign { margin-top: 14px; padding-top: 4px; border-top: 1px dashed #999; text-align: center; font-size: .8em; color: #555; }
  .ticket .foot { margin-top: 8px; text-align: center; font-size: .75em; color: #777; line-height: 1.4; }
`;

/** Receipt number, generated at print time (module scope: never during render). */
function makeReceiptNumber(): string {
  return `SL-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;
}

const DAY_LABELS: Record<string, string> = {
  saturday: "Sam",
  sunday: "Dim",
  monday: "Lun",
  tuesday: "Mar",
  wednesday: "Mer",
  thursday: "Jeu",
  friday: "Ven",
};

export function IndependentPage() {
  const {
    school,
    independent,
    teachers,
    students,
    subscriptions,
    sessions,
    modules,
    classes,
    groups,
    salles,
    push,
    deleteFrom,
    updateItem,
  } = useData();
  const { language } = useSettings();

  // Modals
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedCasual, setSelectedCasual] = useState<IndependentSession | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Main list: search / filters / layout
  const [viewMode, setViewMode] = useState<"cards" | "table">("cards");
  const [listSearch, setListSearch] = useState("");
  const [payerFilter, setPayerFilter] = useState<"all" | "student" | "passager">("all");
  const [billingFilter, setBillingFilter] = useState<"all" | "paid" | "free">("all");
  const [kindFilter, setKindFilter] = useState<"all" | "cours" | "timing">("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  // Form: séance libre
  const [studentSearchQuery, setStudentSearchQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [itemSearchQuery, setItemSearchQuery] = useState("");
  const [itemKindTab, setItemKindTab] = useState<"all" | "cours" | "timing">("all");
  /** Restrict the list to the emplois du temps the picked student follows. */
  const [onlyStudentSeances, setOnlyStudentSeances] = useState(false);
  const [selectedItem, setSelectedItem] = useState<SeanceOption | null>(null);
  const [casualDate, setCasualDate] = useState(new Date().toISOString().split("T")[0]);
  const [customPrice, setCustomPrice] = useState<number | null>(null);
  // "Séance offerte": the cours is followed as usual but nobody is paid on it —
  // the school cashes nothing and the teacher earns no share for it.
  const [isFreeSeance, setIsFreeSeance] = useState(false);
  // Explicit cash-in confirmation: the agent validates the amount received
  // before the séance is written. Offered séances need no validation.
  const [paymentValidated, setPaymentValidated] = useState(false);

  // Once a séance libre is created, immediately offer to print its receipt.
  const [receiptData, setReceiptData] = useState<CasualReceiptData | null>(null);

  // ---- Helpers --------------------------------------------------------------

  const nameOf = <T extends { id: string; name: string }>(list: T[], id?: string) =>
    list.find((x) => x.id === id)?.name ?? "-";

  const getStudentName = (sid?: string) => {
    const s = students.find((st) => st.id === sid);
    return s ? `${s.firstName} ${s.lastName}` : "-";
  };

  const classLabelOf = (id?: string) => {
    const c = classes.find((x) => x.id === id);
    if (!c) return "-";
    const lvl = c.type === "cours" ? c.coursLevel : c.formationLevel;
    return lvl ? `${c.name} (${lvl})` : c.name;
  };

  /**
   * Everything the reception can attach a séance libre to:
   *   - "cours": a regular course module (its full context is displayed so the
   *     agent can tell two identical module names apart),
   *   - "timing": a séance libre créneau created on the Emploi du Temps page —
   *     selecting it loads that créneau's own price.
   * Perfectionnements are no longer part of this screen.
   */
  const seanceOptions = useMemo<SeanceOption[]>(() => {
    const list: SeanceOption[] = [];

    sessions.forEach((s) => {
      const sub = subscriptions.find((su) => su.sessionId === s.id);
      const t = teachers.find((te) => te.id === s.teacherId);
      const isOpen = !!s.isOpen;
      const classLabel = isOpen
        ? (s.classIds?.length ? s.classIds : [s.classId]).map(classLabelOf).join(" · ")
        : classLabelOf(s.classId);
      const groupLabel = isOpen
        ? (s.groupIds?.length ? s.groupIds : [s.groupId]).map((id) => nameOf(groups, id)).join(" · ")
        : nameOf(groups, s.groupId);
      const salleLabel = isOpen
        ? (s.salleIds?.length ? s.salleIds : [s.salleId]).map((id) => nameOf(salles, id)).join(" · ")
        : nameOf(salles, s.salleId);
      const moduleName = nameOf(modules, s.moduleId);

      list.push({
        key: s.id,
        kind: isOpen ? "timing" : "cours",
        label: isOpen ? s.title || `Séance Libre — ${moduleName}` : `${moduleName} — ${classLabel}`,
        price: sub?.pricePerSession ?? s.openPrice ?? 0,
        sessionId: s.id,
        moduleName,
        classLabel,
        groupLabel,
        salleLabel,
        teacherName: t ? `${t.firstName} ${t.lastName}` : "-",
        teacherIsPassager: !!t?.isPassager,
        daysLabel: s.days.map((d) => DAY_LABELS[d] ?? d).join(" · "),
        timeLabel: `${s.startTime} - ${s.endTime}`,
        periodLabel:
          isOpen && s.periodStart && s.periodEnd
            ? `${formatDateFr(s.periodStart)} → ${formatDateFr(s.periodEnd)}`
            : undefined,
      });
    });

    return list.sort((a, b) => (a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === "timing" ? -1 : 1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, subscriptions, teachers, modules, classes, groups, salles]);

  /** The emplois du temps the selected student is enrolled on: what he
   *  "studies on" is the usual answer at the desk, so those créneaux are
   *  flagged and listed first. Empty as long as no student is picked. */
  const studentSessionIds = useMemo(() => {
    if (!selectedStudent) return new Set<string>();
    return new Set(
      selectedStudent.subscriptionIds
        .map((id) => subscriptions.find((su) => su.id === id)?.sessionId)
        .filter((id): id is string => !!id),
    );
  }, [selectedStudent, subscriptions]);

  const isStudentSeance = (o: SeanceOption) => studentSessionIds.has(o.sessionId);

  const filteredOptions = seanceOptions
    .filter((o) => {
      if (itemKindTab !== "all" && o.kind !== itemKindTab) return false;
      if (onlyStudentSeances && !isStudentSeance(o)) return false;
      if (!itemSearchQuery.trim()) return true;
      const q = itemSearchQuery.toLowerCase();
      return `${o.label} ${o.moduleName} ${o.classLabel} ${o.groupLabel} ${o.salleLabel} ${o.teacherName}`
        .toLowerCase()
        .includes(q);
    })
    // Stable sort: his own créneaux float to the top, everything else keeps
    // the alphabetical order `seanceOptions` already established.
    .sort((a, b) => Number(isStudentSeance(b)) - Number(isStudentSeance(a)));

  /** Student lookup by name OR card number (RFID) — an empty selection means
   *  the attendee is recorded as a "passager". */
  const matchedStudents = useMemo(() => {
    const q = studentSearchQuery.trim().toLowerCase();
    if (!q) return [];
    return students
      .filter(
        (st) =>
          `${st.firstName} ${st.lastName}`.toLowerCase().includes(q) ||
          (st.rfid ?? "").toLowerCase().includes(q) ||
          st.phone.includes(studentSearchQuery.trim()),
      )
      .slice(0, 25);
  }, [students, studentSearchQuery]);

  /** Tariff of the picked séance, reduction/override included. */
  const listedPrice = customPrice ?? selectedItem?.price ?? 0;
  /** What is actually cashed: nothing at all on an offered séance. */
  const effectivePrice = isFreeSeance ? 0 : listedPrice;
  /** What the school gives away when the séance is offered. */
  const waivedPrice = isFreeSeance ? listedPrice : 0;

  /** Reverse lookup used by the list/cards to describe a stored séance. */
  const optionForSession = (sessionId?: string) =>
    sessionId ? seanceOptions.find((o) => o.sessionId === sessionId) : undefined;

  // ---- Main list ------------------------------------------------------------

  const filteredList = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return independent
      .filter((ind) => {
        const person = ind.studentId ? getStudentName(ind.studentId) : ind.passagerName ?? "";
        if (q && !`${person} ${ind.itemLabel}`.toLowerCase().includes(q)) return false;
        if (payerFilter === "student" && !ind.studentId) return false;
        if (payerFilter === "passager" && ind.studentId) return false;
        if (billingFilter === "paid" && ind.isFree) return false;
        if (billingFilter === "free" && !ind.isFree) return false;
        if (kindFilter !== "all") {
          const opt = optionForSession(ind.sessionId);
          const kind = opt?.kind ?? "cours";
          if (kind !== kindFilter) return false;
        }
        if (fromDate && ind.date < fromDate) return false;
        if (toDate && ind.date > toDate) return false;
        return true;
      })
      .sort((a, b) => (b.createdAt ?? b.date).localeCompare(a.createdAt ?? a.date));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [independent, listSearch, payerFilter, billingFilter, kindFilter, fromDate, toDate, students, seanceOptions]);

  const totalCollected = filteredList.reduce((s, i) => s + i.price, 0);
  const offeredList = filteredList.filter((i) => i.isFree);
  const totalOffered = offeredList.reduce((s, i) => s + (i.waivedAmount ?? 0), 0);

  const clearListFilters = () => {
    setListSearch("");
    setPayerFilter("all");
    setBillingFilter("all");
    setKindFilter("all");
    setFromDate("");
    setToDate("");
  };

  // ---- Create / edit --------------------------------------------------------

  const resetForm = () => {
    setSelectedStudent(null);
    setStudentSearchQuery("");
    setItemSearchQuery("");
    setItemKindTab("all");
    setOnlyStudentSeances(false);
    setSelectedItem(null);
    setCasualDate(new Date().toISOString().split("T")[0]);
    setCustomPrice(null);
    setIsFreeSeance(false);
    setPaymentValidated(false);
    setSelectedCasual(null);
  };

  const openCreate = () => {
    resetForm();
    setIsFormOpen(true);
  };

  const openEdit = (ind: IndependentSession) => {
    setSelectedCasual(ind);
    setCasualDate(ind.date);
    // An offered séance carries its tariff in `waivedAmount`, not in `price`.
    setCustomPrice(ind.isFree ? ind.waivedAmount ?? 0 : ind.price);
    setIsFreeSeance(!!ind.isFree);
    setPaymentValidated(true);

    const student = ind.studentId ? students.find((s) => s.id === ind.studentId) : undefined;
    setSelectedStudent(student ?? null);
    setStudentSearchQuery(student ? `${student.firstName} ${student.lastName}` : ind.passagerName ?? "");

    setSelectedItem(optionForSession(ind.sessionId) ?? null);
    setItemSearchQuery("");
    setItemKindTab("all");
    setOnlyStudentSeances(false);
    setIsFormOpen(true);
    setActiveMenuId(null);
  };

  const handleSubmit = () => {
    if (!selectedItem) {
      alert("Veuillez sélectionner un cours ou un créneau de séance libre.");
      return;
    }

    // An amount to cash must be validated first; an offered séance skips it.
    if (!isFreeSeance && !paymentValidated) {
      alert("Validez d'abord l'encaissement du paiement.");
      return;
    }

    // Who attends, in decreasing order of precision:
    //   1. an élève inscrit picked in the search,
    //   2. the name typed in the search box — a named passager,
    //   3. nothing at all — an anonymous passager, which is what the desk
    //      records when someone drops in without giving a name.
    const passagerName = !selectedStudent ? studentSearchQuery.trim() : undefined;
    const isAnonymous = !selectedStudent && !passagerName;

    const price = effectivePrice;
    const waived = waivedPrice;

    if (selectedCasual) {
      updateItem("independent", selectedCasual.id, {
        studentId: selectedStudent ? selectedStudent.id : undefined,
        passagerName: passagerName || undefined,
        itemLabel: selectedItem.label,
        price,
        isFree: isFreeSeance,
        waivedAmount: waived,
        date: casualDate,
        sessionId: selectedItem.sessionId,
        startTime: selectedItem.timeLabel.split(" - ")[0],
        endTime: selectedItem.timeLabel.split(" - ")[1],
      });
      setIsFormOpen(false);
      resetForm();
      return;
    }

    const nowIso = new Date().toISOString();
    const newCasual: IndependentSession = {
      id: uid("ind"),
      studentId: selectedStudent ? selectedStudent.id : undefined,
      passagerName: passagerName || undefined,
      itemLabel: selectedItem.label,
      price,
      isFree: isFreeSeance,
      waivedAmount: waived,
      date: casualDate,
      sessionId: selectedItem.sessionId,
      startTime: selectedItem.timeLabel.split(" - ")[0],
      endTime: selectedItem.timeLabel.split(" - ")[1],
      createdAt: nowIso,
    };

    push("independent", newCasual);

    // Séance offerte: nothing is debited, nothing is cashed, and the teacher
    // earns no share for it (see buildUnpaidTimings on the Enseignants screen).
    if (!isFreeSeance) {
      // Registered student: the séance is debited from his balance right away.
      if (selectedStudent) {
        const student = students.find((st) => st.id === selectedStudent.id);
        if (student && !student.isFree) {
          updateItem("students", student.id, { balance: student.balance - price });
          push("balanceTx", {
            id: uid("bt"),
            studentId: student.id,
            amount: -price,
            date: nowIso,
            type: "deduction",
            description: `Séance libre: ${selectedItem.label}`,
            moduleId: sessions.find((s) => s.id === selectedItem.sessionId)?.moduleId,
          });
        }
      }

      // Cash inflow for the school
      push("cash", {
        id: uid("csh"),
        type: "student_payment",
        amount: price,
        date: nowIso,
        description: `Séance libre: ${selectedItem.label} (${
          selectedStudent
            ? `${selectedStudent.firstName} ${selectedStudent.lastName}`
            : passagerName || "passager"
        })`,
      });
    }

    setIsFormOpen(false);

    setReceiptData({
      personName: selectedStudent
        ? `${selectedStudent.firstName} ${selectedStudent.lastName}`
        : passagerName || "Passager occasionnel",
      isRegisteredStudent: !!selectedStudent,
      isAnonymous,
      itemLabel: selectedItem.label,
      teacherName: selectedItem.teacherName,
      classLabel: selectedItem.classLabel,
      timeLabel: selectedItem.timeLabel,
      daysLabel: selectedItem.daysLabel,
      price,
      isFree: isFreeSeance,
      waived,
      date: casualDate,
      createdAt: nowIso,
    });

    resetForm();
  };

  const handleDelete = (id: string) => {
    if (confirm("Supprimer cette séance libre ?")) {
      deleteFrom("independent", id);
      setActiveMenuId(null);
    }
  };

  // ---- Receipt --------------------------------------------------------------
  // A séance libre is a 30-second transaction at the desk, so its proof of
  // payment is a narrow cash-drawer ticket (TICKET_CSS), not an A4 invoice:
  // school, séance, jours/horaire, montant, and that is all.

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const handlePrintReceipt = (data: CasualReceiptData) => {
    const L = RECEIPT_LABELS[language];
    const receiptNum = makeReceiptNumber();

    const row = (label: string, value?: string) =>
      value ? `<tr><th>${label}</th><td>${escapeHtml(value)}</td></tr>` : "";

    const who = data.isRegisteredStudent
      ? L.registered
      : data.isAnonymous
        ? L.anonymous
        : L.passenger;

    const bodyHtml = `
      <div class="ticket">
        <div class="head">
          <strong class="school">${escapeHtml(school.name || "")}</strong>
          ${school.phone ? `<span>${escapeHtml(school.phone)}</span>` : ""}
          ${school.address ? `<span>${escapeHtml(school.address)}</span>` : ""}
        </div>

        <div class="title">${L.docTitle}</div>
        <div class="num">${L.receiptNo} ${receiptNum}</div>

        <table>
          ${row(L.person, data.personName)}
          <tr><th></th><td>${who}</td></tr>
          ${row(L.item, data.itemLabel)}
          ${row(L.teacher, data.teacherName)}
          ${row(L.classLevel, data.classLabel)}
          ${row(L.days, data.daysLabel)}
          ${row(L.time, data.timeLabel)}
          ${row(L.date, fmtDate(data.date, language))}
          ${data.isFree ? "" : row(L.method, L.cash)}
          ${row(L.paidOn, fmtDateTime(data.createdAt, language))}
        </table>

        <div class="total${data.isFree ? " free" : ""}">
          <span>${data.isFree ? L.offeredTotal : L.total}</span>
          <span>${data.price} ${L.da}</span>
        </div>
        ${data.isFree ? `<p class="note">${L.offeredNote(`${data.waived ?? 0} ${L.da}`)}</p>` : ""}

        <div class="sign">${L.signCashier}</div>
        <div class="foot">${L.thanks}</div>
      </div>
    `;

    printHtmlDocument(
      printDocument({
        title: `${L.docTitle} - ${data.personName}`,
        lang: language,
        bodyHtml,
        extraCss: TICKET_CSS,
      }),
    );
  };

  const reprint = (ind: IndependentSession) => {
    const opt = optionForSession(ind.sessionId);
    const person = ind.studentId ? getStudentName(ind.studentId) : ind.passagerName;
    handlePrintReceipt({
      personName: person || "Passager occasionnel",
      isRegisteredStudent: !!ind.studentId,
      isAnonymous: !ind.studentId && !ind.passagerName,
      itemLabel: ind.itemLabel,
      teacherName: opt?.teacherName,
      classLabel: opt?.classLabel,
      timeLabel: ind.startTime && ind.endTime ? `${ind.startTime} - ${ind.endTime}` : opt?.timeLabel,
      daysLabel: opt?.daysLabel,
      price: ind.price,
      isFree: ind.isFree,
      waived: ind.waivedAmount,
      date: ind.date,
      createdAt: ind.createdAt ?? `${ind.date}T12:00:00.000Z`,
    });
  };

  const createdStamp = (ind: IndependentSession) => {
    const iso = ind.createdAt ?? `${ind.date}T12:00:00.000Z`;
    const d = new Date(iso);
    if (isNaN(d.getTime())) return ind.date;
    return `${d.toLocaleDateString("fr-FR")} à ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  };

  // ---- Render ---------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <PageHeader
          emoji="🎓"
          title="Séances Libres"
          subtitle="Séances ponctuelles des élèves inscrits et des passagers — encaissées ou offertes"
        />
        <Button onClick={openCreate} className="flex items-center gap-2 self-start sm:self-center">
          <Plus className="h-4 w-4" /> Nouvelle Séance Libre
        </Button>
      </div>

      {/* Filters toolbar */}
      <Card className="border border-line">
        <CardBody className="p-4 space-y-3.5">
          <div className="flex items-center justify-between border-b border-line pb-2.5">
            <span className="font-bold text-ink uppercase tracking-wider text-[10px] flex items-center gap-1.5">
              <Filter className="h-4 w-4 text-primary" /> Rechercher & Filtrer
            </span>
            <div className="flex items-center gap-2">
              {(listSearch || payerFilter !== "all" || billingFilter !== "all" || kindFilter !== "all" || fromDate || toDate) && (
                <button onClick={clearListFilters} className="text-primary hover:underline font-bold text-[10px] flex items-center gap-1">
                  <X className="h-3 w-3" /> Réinitialiser
                </button>
              )}
              <div className="bg-canvas border border-line p-1 rounded-xl flex gap-1">
                <button
                  onClick={() => setViewMode("cards")}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${
                    viewMode === "cards" ? "bg-primary text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  <LayoutGrid className="h-3 w-3" /> Cartes
                </button>
                <button
                  onClick={() => setViewMode("table")}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all flex items-center gap-1 ${
                    viewMode === "table" ? "bg-primary text-white" : "text-muted hover:text-ink"
                  }`}
                >
                  <TableIcon className="h-3 w-3" /> Tableau
                </button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3">
            <div className="lg:col-span-2">
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Recherche</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  placeholder="Nom de l'élève, passager ou séance..."
                  className="pl-9"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Type de payeur</label>
              <Select value={payerFilter} onChange={(e) => setPayerFilter(e.target.value as typeof payerFilter)} className="w-full">
                <option value="all">Tous</option>
                <option value="student">Élèves inscrits</option>
                <option value="passager">Passagers</option>
              </Select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Facturation</label>
              <Select
                value={billingFilter}
                onChange={(e) => setBillingFilter(e.target.value as typeof billingFilter)}
                className="w-full"
              >
                <option value="all">Toutes</option>
                <option value="paid">Encaissées</option>
                <option value="free">Offertes (gratuites)</option>
              </Select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Origine</label>
              <Select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)} className="w-full">
                <option value="all">Toutes</option>
                <option value="timing">Créneaux séance libre</option>
                <option value="cours">Cours normaux</option>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Du</label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-muted uppercase mb-1 font-sans">Au</label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-2.5 text-[11px]">
            <Badge tone="primary" className="font-bold">{filteredList.length} séance(s)</Badge>
            <Badge tone="success" className="font-bold">{totalCollected} DA encaissés</Badge>
            <Badge tone="neutral" className="font-bold">
              {filteredList.filter((i) => !i.studentId).length} passager(s)
            </Badge>
            <Badge tone="warning" className="font-bold">
              {offeredList.length} offerte(s) · {totalOffered} DA non encaissés
            </Badge>
          </div>
        </CardBody>
      </Card>

      {filteredList.length === 0 ? (
        <div className="text-center p-12 bg-canvas/30 border border-line border-dashed rounded-2xl text-muted text-xs">
          Aucune séance libre ne correspond aux filtres actuels.
        </div>
      ) : viewMode === "cards" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredList.map((ind) => {
            const opt = optionForSession(ind.sessionId);
            return (
              <Card
                key={ind.id}
                className={`relative transition-all duration-300 ${
                  activeMenuId === ind.id
                    ? "z-30 scale-[1.02] ring-2 ring-primary/45 shadow-2xl"
                    : "z-10 hover:z-20 hover:shadow-lg hover:-translate-y-0.5 border border-line"
                }`}
              >
                <CardBody className="flex flex-col justify-between min-h-[230px] relative p-5">
                  {/* Actions overlay panel */}
                  {activeMenuId === ind.id && (
                    <div className="absolute inset-0 bg-surface/98 backdrop-blur-md rounded-2xl p-4 flex flex-col justify-between z-20 animate-in fade-in zoom-in-95 duration-200 border border-primary/20">
                      <div className="flex justify-between items-center border-b border-line pb-2">
                        <span className="font-bold text-[10px] text-muted uppercase tracking-wider truncate">
                          Actions: {ind.studentId ? getStudentName(ind.studentId) : ind.passagerName || "Passager anonyme"}
                        </span>
                        <button
                          onClick={() => setActiveMenuId(null)}
                          className="p-1 rounded-lg hover:bg-canvas text-muted hover:text-ink transition-colors"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-2 my-2 flex-1 items-center">
                        <button
                          onClick={() => { setSelectedCasual(ind); setIsDetailsOpen(true); setActiveMenuId(null); }}
                          className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5" /> Détails
                        </button>
                        <button
                          onClick={() => openEdit(ind)}
                          className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                        >
                          <Edit className="h-3.5 w-3.5" /> Modifier
                        </button>
                        <button
                          onClick={() => { reprint(ind); setActiveMenuId(null); }}
                          className="col-span-2 flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                        >
                          <Printer className="h-3.5 w-3.5" /> Réimprimer le reçu
                        </button>
                      </div>

                      <div className="border-t border-line pt-2">
                        <button
                          onClick={() => handleDelete(ind.id)}
                          className="flex items-center justify-center gap-1.5 w-full py-2 px-3 text-xs font-bold rounded-xl bg-danger text-white hover:bg-danger/90 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Supprimer
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-10 w-10 rounded-full bg-success/10 border border-success/20 text-success font-bold text-xs flex items-center justify-center shrink-0">
                          {ind.studentId ? "🎓" : "🚶"}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-ink truncate">
                            {ind.studentId
                              ? getStudentName(ind.studentId)
                              : ind.passagerName || "Passager anonyme"}
                          </h4>
                          <span className="text-[10px] text-muted block font-mono truncate">
                            {ind.studentId ? "Élève Inscrit" : "Passager Occasionnel"}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => setActiveMenuId(activeMenuId === ind.id ? null : ind.id)}
                        className="p-1.5 rounded-lg hover:bg-primary-50 text-muted hover:text-ink transition-colors shrink-0"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2 text-xs bg-canvas/30 border border-line/60 rounded-xl p-2.5">
                        <div className="min-w-0">
                          <span className="text-[10px] text-muted block uppercase font-semibold">
                            {opt?.kind === "timing" ? "Créneau séance libre" : "Cours"}
                          </span>
                          <span className="font-semibold text-ink block truncate">{ind.itemLabel}</span>
                          {opt?.daysLabel && (
                            <span className="text-[9px] text-muted block font-mono truncate">{opt.daysLabel}</span>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-[10px] text-muted block uppercase font-semibold">
                            {ind.isFree ? "Offerte" : "Tarif Payé"}
                          </span>
                          {ind.isFree ? (
                            <>
                              <span className="font-bold text-warning">0 DA</span>
                              <span className="text-[9px] text-muted block">valeur {ind.waivedAmount ?? 0} DA</span>
                            </>
                          ) : (
                            <span className="font-bold text-success">{ind.price} DA</span>
                          )}
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl">
                          <span className="text-muted block text-[9px] uppercase font-sans">Date séance</span>
                          <strong className="text-ink mt-0.5 font-mono block">{formatDateFr(ind.date)}</strong>
                          {ind.startTime && (
                            <span className="text-[9px] text-muted font-mono">{ind.startTime} - {ind.endTime}</span>
                          )}
                        </div>
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl">
                          <span className="text-muted block text-[9px] uppercase">Créée le</span>
                          <strong className="text-ink mt-0.5 font-mono block text-[10px]">{createdStamp(ind)}</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-line/60 pt-3 mt-4 flex items-center justify-between">
                    <span className="text-[10px] text-muted flex items-center gap-1.5 truncate">
                      <User className="h-3 w-3 shrink-0" />
                      {opt?.teacherName ?? "-"}
                      {opt?.teacherIsPassager && (
                        <Badge tone="warning" className="text-[8px] px-1 py-0">Passager</Badge>
                      )}
                    </span>
                    {ind.isFree ? (
                      <Badge tone="warning" className="font-mono font-bold text-[10px]">🎁 Offerte</Badge>
                    ) : (
                      <Badge tone="success" className="font-mono font-bold text-[10px]">{ind.price} DA</Badge>
                    )}
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      ) : (
        /* TABLE VIEW */
        <div className="border border-line rounded-2xl overflow-hidden bg-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse min-w-[860px]">
              <thead>
                <tr className="bg-canvas border-b border-line text-[10px] text-muted uppercase font-bold tracking-wider">
                  <th className="p-3">Élève / Passager</th>
                  <th className="p-3">Séance</th>
                  <th className="p-3">Enseignant</th>
                  <th className="p-3">Date & horaire</th>
                  <th className="p-3">Créée le</th>
                  <th className="p-3 text-right">Tarif</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredList.map((ind) => {
                  const opt = optionForSession(ind.sessionId);
                  return (
                    <tr key={ind.id} className="border-b border-line last:border-0 hover:bg-canvas/30 transition-colors">
                      <td className="p-3">
                        <span className="font-bold text-ink block">
                          {ind.studentId
                            ? getStudentName(ind.studentId)
                            : ind.passagerName || "Passager anonyme"}
                        </span>
                        <Badge tone={ind.studentId ? "primary" : "warning"} className="text-[9px] mt-0.5">
                          {ind.studentId ? "Inscrit" : "Passager"}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <span className="text-ink block truncate max-w-[220px]">{ind.itemLabel}</span>
                        <span className="text-[10px] text-muted">
                          {opt?.kind === "timing" ? "Créneau séance libre" : "Cours"}
                          {opt?.daysLabel ? ` · ${opt.daysLabel}` : ""}
                        </span>
                        {ind.isFree && (
                          <Badge tone="warning" className="text-[9px] mt-0.5">🎁 Offerte</Badge>
                        )}
                      </td>
                      <td className="p-3 text-ink">{opt?.teacherName ?? "-"}</td>
                      <td className="p-3 font-mono text-[10px]">
                        {formatDateFr(ind.date)}
                        {ind.startTime && <span className="block text-muted">{ind.startTime} - {ind.endTime}</span>}
                      </td>
                      <td className="p-3 font-mono text-[10px] text-muted">{createdStamp(ind)}</td>
                      <td className="p-3 text-right font-mono">
                        {ind.isFree ? (
                          <>
                            <strong className="text-warning">0 DA</strong>
                            <span className="block text-[9px] text-muted">valeur {ind.waivedAmount ?? 0} DA</span>
                          </>
                        ) : (
                          <strong className="text-success">{ind.price} DA</strong>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => { setSelectedCasual(ind); setIsDetailsOpen(true); }}
                            className="p-1.5 rounded-lg hover:bg-primary-50 text-ink"
                            title="Détails"
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => reprint(ind)} className="p-1.5 rounded-lg hover:bg-primary-50 text-ink" title="Réimprimer">
                            <Printer className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => openEdit(ind)} className="p-1.5 rounded-lg hover:bg-primary-50 text-primary" title="Modifier">
                            <Edit className="h-3.5 w-3.5" />
                          </button>
                          <button onClick={() => handleDelete(ind.id)} className="p-1.5 rounded-lg hover:bg-danger/10 text-danger" title="Supprimer">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Create / edit a séance libre                                        */}
      {/* ------------------------------------------------------------------ */}
      <Modal
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={selectedCasual ? "Modifier la séance libre" : "Enregistrer une séance libre"}
        wide
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* ---- Who ---- */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-muted font-sans">
                  1. Qui suit la séance ? <span className="font-normal">(facultatif)</span>
                </label>
                {(selectedStudent || studentSearchQuery) && (
                  <button
                    onClick={() => { setSelectedStudent(null); setStudentSearchQuery(""); }}
                    className="text-[10px] font-bold text-primary hover:underline"
                  >
                    Vider
                  </button>
                )}
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={studentSearchQuery}
                  onChange={(e) => {
                    setStudentSearchQuery(e.target.value);
                    if (selectedStudent) setSelectedStudent(null);
                  }}
                  placeholder="Élève inscrit (nom, n° de carte) ou nom du passager..."
                  className="pl-9"
                />
              </div>
              {/* The desk has three ways of naming the attendee, and all three
                  are valid — a walk-in who gives no name is still a séance. */}
              <div className="mt-1.5 rounded-xl border border-line bg-canvas/30 p-2 space-y-1 text-[10px] leading-relaxed text-muted">
                <p className={selectedStudent ? "font-bold text-primary" : ""}>
                  • <strong>Élève inscrit</strong> : cherchez-le puis sélectionnez-le dans les résultats.
                </p>
                <p className={!selectedStudent && studentSearchQuery.trim() ? "font-bold text-primary" : ""}>
                  • <strong>Passager nommé</strong> : tapez simplement son nom complet, sans le sélectionner.
                </p>
                <p className={!selectedStudent && !studentSearchQuery.trim() ? "font-bold text-primary" : ""}>
                  • <strong>Passager anonyme</strong> : laissez le champ vide — la séance est enregistrée
                  sans nom.
                </p>
              </div>
            </div>

            {studentSearchQuery.trim() !== "" && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-muted font-bold block uppercase font-sans">
                  Résultats ({matchedStudents.length}) :
                </span>
                <div className="border border-line rounded-xl max-h-44 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
                  {matchedStudents.map((st) => {
                    const isSelected = selectedStudent?.id === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => { setSelectedStudent(st); setStudentSearchQuery(`${st.firstName} ${st.lastName}`); }}
                        className={`w-full text-start p-2.5 rounded-xl text-xs flex justify-between items-center transition-all ${
                          isSelected
                            ? "bg-primary/15 border border-primary/30 text-ink font-bold"
                            : "hover:bg-primary-50 text-ink border border-transparent"
                        }`}
                      >
                        <div className="min-w-0">
                          <span className="font-semibold block truncate">{st.firstName} {st.lastName}</span>
                          <span className="text-[9px] text-muted block mt-0.5 font-mono">
                            🎫 {st.rfid || "sans carte"} · 📞 {st.phone} · Solde: {st.balance} DA
                          </span>
                        </div>
                        {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                  {matchedStudents.length === 0 && (
                    <div className="p-3 text-center text-xs text-muted bg-surface rounded-xl border border-line">
                      ⚠️ Aucun élève trouvé. Sera enregistré comme passager :{" "}
                      <strong>&laquo;&nbsp;{studentSearchQuery}&nbsp;&raquo;</strong>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Date de la séance</label>
              <Input type="date" value={casualDate} onChange={(e) => setCasualDate(e.target.value)} />
            </div>

            {selectedStudent ? (
              <div className="bg-primary-50/50 border border-line rounded-xl p-3 text-xs">
                <span className="text-[10px] text-muted block uppercase font-bold">Élève sélectionné</span>
                <strong className="text-ink block mt-0.5">{selectedStudent.firstName} {selectedStudent.lastName}</strong>
                <span className="text-muted">
                  Solde actuel : {selectedStudent.balance} DA → après séance :{" "}
                  <strong className={selectedStudent.balance - effectivePrice < 0 ? "text-danger" : "text-success"}>
                    {selectedStudent.isFree ? selectedStudent.balance : selectedStudent.balance - effectivePrice} DA
                  </strong>
                  {selectedStudent.isFree && " (élève gratuit — aucun débit)"}
                  {isFreeSeance && " — séance offerte, aucun débit"}
                </span>
              </div>
            ) : (
              <div className="bg-warning/5 border border-warning/25 rounded-xl p-3 text-xs">
                <span className="text-[10px] text-muted block uppercase font-bold">Enregistrée au nom de</span>
                <strong className="text-ink block mt-0.5">
                  {studentSearchQuery.trim() || "Passager occasionnel (sans nom)"}
                </strong>
                <span className="text-muted">
                  Passager : aucun solde n&apos;est débité, l&apos;encaissement va directement en caisse.
                </span>
              </div>
            )}
          </div>

          {/* ---- What ---- */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">
                2. Sur quel emploi du temps ? *
              </label>
              <p className="text-[10px] text-muted mb-2 leading-relaxed">
                Cherchez l&apos;emploi du temps par son <strong>nom</strong> (module ou intitulé du créneau),
                sa classe, son groupe, sa salle ou son enseignant. Le tarif d&apos;une séance est chargé
                automatiquement.
              </p>
              <div className="flex gap-1.5 mb-2">
                {([
                  { key: "all", label: "Tout" },
                  { key: "timing", label: "Créneaux séance libre" },
                  { key: "cours", label: "Cours normaux" },
                ] as const).map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setItemKindTab(tab.key)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                      itemKindTab === tab.key ? "bg-primary text-white" : "bg-canvas text-muted hover:text-ink"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
                {selectedStudent && studentSessionIds.size > 0 && (
                  <button
                    onClick={() => setOnlyStudentSeances(!onlyStudentSeances)}
                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all ${
                      onlyStudentSeances ? "bg-success text-white" : "bg-canvas text-muted hover:text-ink"
                    }`}
                  >
                    🎓 Ses cours ({studentSessionIds.size})
                  </button>
                )}
              </div>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={itemSearchQuery}
                  onChange={(e) => setItemSearchQuery(e.target.value)}
                  placeholder="Nom de l'emploi du temps, classe, groupe, salle, enseignant..."
                  className="pl-9"
                />
              </div>
              <div className="border border-line rounded-xl max-h-64 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
                {filteredOptions.length === 0 ? (
                  <p className="text-[10px] text-muted italic p-3 text-center">Aucun résultat.</p>
                ) : (
                  filteredOptions.map((opt) => {
                    const isSel = selectedItem?.key === opt.key;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => { setSelectedItem(opt); setCustomPrice(opt.price); setPaymentValidated(false); }}
                        className={`w-full text-start p-2.5 rounded-lg text-xs transition-colors border ${
                          isSel
                            ? "bg-primary/10 border-primary/40 text-ink"
                            : "hover:bg-primary-50 text-ink border-transparent"
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <strong className="font-bold block min-w-0 truncate">
                            {opt.kind === "timing" && <span className="mr-1">🎯</span>}
                            {opt.label}
                            {isStudentSeance(opt) && (
                              <Badge tone="success" className="ml-1.5 text-[8px] px-1 py-0 align-middle">
                                Son cours
                              </Badge>
                            )}
                          </strong>
                          <strong className="text-primary shrink-0">{opt.price} DA</strong>
                        </div>
                        {/* Full context so two identical module names stay distinguishable */}
                        <div className="mt-1 space-y-0.5 text-[10px] text-muted">
                          <div className="flex items-center gap-1"><User className="h-3 w-3 shrink-0" /> {opt.teacherName}{opt.teacherIsPassager ? " (passager)" : ""}</div>
                          <div className="flex items-center gap-1"><Users className="h-3 w-3 shrink-0" /> {opt.classLabel} · Gr: {opt.groupLabel}</div>
                          <div className="flex items-center gap-1"><MapPin className="h-3 w-3 shrink-0" /> {opt.salleLabel}</div>
                          <div className="flex items-center gap-1 font-mono"><Clock className="h-3 w-3 shrink-0" /> {opt.daysLabel} · {opt.timeLabel}</div>
                          {opt.periodLabel && (
                            <div className="flex items-center gap-1 font-mono"><Calendar className="h-3 w-3 shrink-0" /> {opt.periodLabel}</div>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>

            {selectedItem && (
              <div className="space-y-3">
                {/* Recap of the chosen emploi du temps */}
                <div className="rounded-xl border border-primary/25 bg-primary-50/40 p-3 text-xs space-y-1">
                  <span className="text-[10px] text-muted block uppercase font-bold">Emploi du temps choisi</span>
                  <strong className="text-ink block">
                    {selectedItem.kind === "timing" && <span className="mr-1">🎯</span>}
                    {selectedItem.label}
                  </strong>
                  <span className="text-[10px] text-muted block font-mono">
                    {selectedItem.daysLabel} · {selectedItem.timeLabel} · {selectedItem.salleLabel}
                  </span>
                  <span className="text-[10px] text-muted block">
                    Enseignant : <strong className="text-ink">{selectedItem.teacherName}</strong>
                    {selectedItem.teacherIsPassager ? " (passager)" : ""}
                  </span>
                  <span className="text-[10px] text-muted block">
                    Prix d&apos;une séance :{" "}
                    <strong className="text-primary">{selectedItem.price} DA</strong>
                  </span>
                </div>

                {/* Séance offerte: nobody is paid on it — neither the school,
                    nor the teacher who animates it. */}
                <label
                  className={`flex cursor-pointer items-start gap-2.5 rounded-xl border p-3 text-xs transition-colors ${
                    isFreeSeance
                      ? "border-warning/40 bg-warning/10"
                      : "border-line bg-canvas/30 hover:bg-primary-50/40"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isFreeSeance}
                    onChange={(e) => { setIsFreeSeance(e.target.checked); setPaymentValidated(false); }}
                    className="mt-0.5 h-4 w-4 shrink-0"
                  />
                  <span>
                    <strong className="block text-ink">Séance offerte (gratuite)</strong>
                    <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">
                      Rien n&apos;est encaissé par l&apos;école, aucun solde n&apos;est débité, et{" "}
                      <strong>l&apos;enseignant n&apos;est pas rémunéré</strong> sur cette séance. Sa valeur
                      ({listedPrice} DA) reste comptabilisée dans les rapports généraux.
                    </span>
                  </span>
                </label>

                <div>
                  <label className="block text-xs font-semibold text-muted mb-1 font-sans">
                    {isFreeSeance ? "Valeur de la séance offerte (DA)" : "3. Montant à encaisser (DA)"}
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={customPrice ?? selectedItem.price}
                    onChange={(e) => { setCustomPrice(Number(e.target.value)); setPaymentValidated(false); }}
                  />
                  <p className="text-[10px] text-muted mt-1">
                    Tarif chargé depuis {selectedItem.kind === "timing" ? "le créneau" : "l'abonnement"} :{" "}
                    <strong>{selectedItem.price} DA</strong>. Modifiable pour cette séance uniquement.
                  </p>
                </div>

                {isFreeSeance ? (
                  <div className="rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-warning">Total à encaisser :</span>
                      <strong className="text-sm font-extrabold text-warning">0 DA</strong>
                    </div>
                    <p className="mt-1 text-[10px] text-muted">
                      Séance offerte — valeur non encaissée : <strong>{waivedPrice} DA</strong>.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="bg-success/10 border border-success/20 rounded-xl p-3.5 flex justify-between items-center text-xs">
                      <span className="text-success font-semibold">Total à encaisser :</span>
                      <strong className="text-success text-sm font-extrabold">{effectivePrice} DA</strong>
                    </div>
                    {/* Explicit cash-in confirmation before the séance is written */}
                    <label
                      className={`flex cursor-pointer items-center gap-2.5 rounded-xl border p-3 text-xs transition-colors ${
                        paymentValidated
                          ? "border-success/40 bg-success/10"
                          : "border-line bg-canvas/30 hover:bg-primary-50/40"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={paymentValidated}
                        onChange={(e) => setPaymentValidated(e.target.checked)}
                        className="h-4 w-4 shrink-0"
                      />
                      <span>
                        <strong className="block text-ink">
                          Je valide l&apos;encaissement de {effectivePrice} DA
                        </strong>
                        <span className="block text-[10px] text-muted">
                          Paiement en espèces reçu au guichet.
                        </span>
                      </span>
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-4 mt-6 border-t border-line">
          <span className="text-[10px] text-muted">
            {!selectedItem
              ? "Sélectionnez d'abord un emploi du temps."
              : isFreeSeance
                ? `Séance offerte — 0 DA encaissé (valeur ${waivedPrice} DA).`
                : paymentValidated
                  ? `Paiement validé — ${effectivePrice} DA seront encaissés.`
                  : "Validez l'encaissement pour pouvoir enregistrer."}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setIsFormOpen(false)}>Annuler</Button>
            <Button
              onClick={handleSubmit}
              disabled={!selectedItem || (!isFreeSeance && !paymentValidated)}
              className="flex items-center gap-2"
            >
              <Check className="h-4 w-4" />
              {selectedCasual
                ? "Enregistrer les modifications"
                : isFreeSeance
                  ? "Enregistrer la séance offerte"
                  : "Valider & Encaisser"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ------------------------------------------------------------------ */}
      {/* Details                                                             */}
      {/* ------------------------------------------------------------------ */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Détails de la séance libre" wide>
        {selectedCasual && (() => {
          const opt = optionForSession(selectedCasual.sessionId);
          const student = selectedCasual.studentId
            ? students.find((s) => s.id === selectedCasual.studentId)
            : undefined;
          return (
            <div className="space-y-5 text-xs">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-primary-50/50 rounded-xl p-4 border border-line">
                <div>
                  <span className="text-[10px] text-muted block uppercase">Élève / Passager</span>
                  <strong className="text-ink block">
                    {student
                      ? `${student.firstName} ${student.lastName}`
                      : selectedCasual.passagerName || "Passager anonyme"}
                  </strong>
                  <Badge tone={student ? "primary" : "warning"} className="text-[9px] mt-1">
                    {student ? "Élève inscrit" : "Passager"}
                  </Badge>
                </div>
                <div>
                  <span className="text-[10px] text-muted block uppercase">Séance</span>
                  <strong className="text-ink block break-words">{selectedCasual.itemLabel}</strong>
                  <span className="text-[10px] text-muted">
                    {opt?.kind === "timing" ? "Créneau séance libre" : "Cours normal"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted block uppercase">Date & horaire</span>
                  <strong className="text-ink block font-mono">{formatDateFr(selectedCasual.date)}</strong>
                  <span className="text-[10px] text-muted font-mono">
                    {selectedCasual.startTime ? `${selectedCasual.startTime} - ${selectedCasual.endTime}` : opt?.timeLabel ?? "-"}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-muted block uppercase">Montant encaissé</span>
                  <strong className={`block text-base ${selectedCasual.isFree ? "text-warning" : "text-success"}`}>
                    {selectedCasual.price} DA
                  </strong>
                  {selectedCasual.isFree && (
                    <Badge tone="warning" className="text-[9px] mt-0.5">
                      🎁 Offerte — valeur {selectedCasual.waivedAmount ?? 0} DA
                    </Badge>
                  )}
                  <span className="text-[10px] text-muted block">Créée le {createdStamp(selectedCasual)}</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border border-line rounded-2xl p-4 bg-surface space-y-2">
                  <h4 className="font-bold text-ink text-xs uppercase tracking-wider text-muted mb-2">
                    📚 Contexte de la séance
                  </h4>
                  {[
                    ["Module", opt?.moduleName],
                    ["Classe / Niveau", opt?.classLabel],
                    ["Groupe(s)", opt?.groupLabel],
                    ["Salle(s)", opt?.salleLabel],
                    ["Enseignant", opt ? `${opt.teacherName}${opt.teacherIsPassager ? " (passager)" : ""}` : undefined],
                    ["Jours", opt?.daysLabel],
                    ["Période", opt?.periodLabel],
                  ].map(([label, value]) =>
                    value ? (
                      <div key={label} className="flex justify-between border-b border-line/50 pb-1.5 last:border-0">
                        <span className="text-muted">{label} :</span>
                        <strong className="text-ink text-right">{value}</strong>
                      </div>
                    ) : null,
                  )}
                </div>

                <div className="border border-line rounded-2xl p-4 bg-surface space-y-2">
                  <h4 className="font-bold text-ink text-xs uppercase tracking-wider text-muted mb-2">
                    💰 Règlement
                  </h4>
                  <div className="flex justify-between border-b border-line/50 pb-1.5">
                    <span className="text-muted">Montant :</span>
                    <strong className={selectedCasual.isFree ? "text-warning" : "text-success"}>
                      {selectedCasual.price} DA
                    </strong>
                  </div>
                  <div className="flex justify-between border-b border-line/50 pb-1.5">
                    <span className="text-muted">Mode :</span>
                    <strong className="text-ink">
                      {selectedCasual.isFree ? "Séance offerte (rien encaissé)" : "Espèces (encaissé)"}
                    </strong>
                  </div>
                  {selectedCasual.isFree && (
                    <>
                      <div className="flex justify-between border-b border-line/50 pb-1.5">
                        <span className="text-muted">Valeur offerte :</span>
                        <strong className="text-warning">{selectedCasual.waivedAmount ?? 0} DA</strong>
                      </div>
                      <div className="flex justify-between border-b border-line/50 pb-1.5">
                        <span className="text-muted">Enseignant rémunéré :</span>
                        <strong className="text-ink">Non — séance offerte</strong>
                      </div>
                    </>
                  )}
                  {student && (
                    <div className="flex justify-between border-b border-line/50 pb-1.5">
                      <span className="text-muted">Débité du solde :</span>
                      <strong className="text-ink">
                        {selectedCasual.isFree
                          ? "Non (séance offerte)"
                          : student.isFree
                            ? "Non (élève gratuit)"
                            : "Oui"}
                      </strong>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-muted">Enregistrée le :</span>
                    <strong className="text-ink font-mono">{createdStamp(selectedCasual)}</strong>
                  </div>
                </div>
              </div>

              <div className="flex justify-between items-center pt-3 border-t border-line">
                <div className="flex gap-2">
                  <Button variant="outline" className="flex items-center gap-1" onClick={() => reprint(selectedCasual)}>
                    <Printer className="h-4 w-4" /> Imprimer le reçu
                  </Button>
                  <Button variant="outline" className="flex items-center gap-1" onClick={() => { setIsDetailsOpen(false); openEdit(selectedCasual); }}>
                    <Edit className="h-4 w-4" /> Modifier
                  </Button>
                </div>
                <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
              </div>
            </div>
          );
        })()}
      </Modal>

      {/* Séance libre created -> propose the receipt right away */}
      <Modal open={receiptData !== null} onClose={() => setReceiptData(null)} title="Reçu de la Séance Libre">
        {receiptData && (
          <div className="space-y-6 text-center py-4">
            <div className="mx-auto w-12 h-12 bg-success/10 rounded-full flex items-center justify-center text-success text-xl">
              ✔
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-bold text-ink">
                {receiptData.isFree
                  ? "Séance libre offerte enregistrée !"
                  : "Séance libre enregistrée et encaissée !"}
              </h3>
              <p className="text-xs text-muted max-w-sm mx-auto leading-relaxed">
                <strong>{receiptData.itemLabel}</strong> pour <strong>{receiptData.personName}</strong> —{" "}
                {receiptData.isFree ? (
                  <>
                    <strong className="text-warning">séance offerte</strong> (valeur{" "}
                    <strong>{receiptData.waived ?? 0} DA</strong>, ni encaissée par l&apos;école ni
                    rémunérée à l&apos;enseignant).
                  </>
                ) : (
                  <>
                    <strong>{receiptData.price} DA</strong> encaissés.
                  </>
                )}
                <br />
                Souhaitez-vous imprimer le reçu ?
              </p>
            </div>

            <div className="flex justify-center gap-3 pt-4 border-t border-line">
              <Button variant="outline" onClick={() => setReceiptData(null)} className="px-5 py-2 rounded-xl text-xs font-bold">
                Ignorer
              </Button>
              <Button
                onClick={() => { handlePrintReceipt(receiptData); setReceiptData(null); }}
                className="px-5 py-2 rounded-xl text-xs font-bold flex items-center gap-2"
              >
                <Printer className="h-4 w-4" /> Imprimer le reçu (ticket)
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
