"use client";

import { useState, useEffect } from "react";
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
  User,
  Search,
  RefreshCw,
  MoreVertical,
  X,
  Check,
  Clock,
  DollarSign
} from "lucide-react";
import type { Coursework, IndependentSession, CourseworkType, Student } from "@/lib/types";

const WEEKDAYS = [
  { label: "Sam", value: 6 },
  { label: "Dim", value: 0 },
  { label: "Lun", value: 1 },
  { label: "Mar", value: 2 },
  { label: "Mer", value: 3 },
  { label: "Jeu", value: 4 },
  { label: "Ven", value: 5 },
];

export function IndependentPage() {
  const {
    coursework,
    independent,
    teachers,
    students,
    subscriptions,
    sessions,
    modules,
    classes,
    push,
    deleteFrom,
    updateItem,
  } = useData();

  // Tabs
  const [activeTab, setActiveTab] = useState<"stages" | "casual">("stages");

  // Modals
  const [isCreateStageOpen, setIsCreateStageOpen] = useState(false);
  const [isEditStageOpen, setIsEditStageOpen] = useState(false);
  const [isCreateCasualOpen, setIsCreateCasualOpen] = useState(false);
  const [isEditCasualOpen, setIsEditCasualOpen] = useState(false);
  const [isDetailsStageOpen, setIsDetailsStageOpen] = useState(false);
  
  const [selectedStage, setSelectedStage] = useState<Coursework | null>(null);
  const [selectedCasual, setSelectedCasual] = useState<IndependentSession | null>(null);
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Form: Coursework (Perfectionnement)
  const [stageName, setStageName] = useState("");
  const [stageType, setStageType] = useState<CourseworkType>("single");
  const [singleDate, setSingleDate] = useState(new Date().toISOString().split("T")[0]);
  const [startDate, setStartDate] = useState(new Date().toISOString().split("T")[0]);
  const [endDate, setEndDate] = useState(new Date().toISOString().split("T")[0]);
  const [generatedDates, setGeneratedDates] = useState<{ date: string; checked: boolean }[]>([]);
  const [pricePerSession, setPricePerSession] = useState<number>(0);
  const [totalPrice, setTotalPrice] = useState<number>(0);
  const [teacherId, setTeacherId] = useState("");

  // Form: Casual Session (Séance Libre)
  const [studentSearchQuery, setStudentSearchQuery] = useState("");
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [casualSearchQuery, setCasualSearchQuery] = useState("");
  const [selectedItem, setSelectedItem] = useState<{ label: string; price: number } | null>(null);
  const [casualDate, setCasualDate] = useState(new Date().toISOString().split("T")[0]);

  // Auto generate calendar dates inside creation modal
  useEffect(() => {
    if (stageType !== "period") return;
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return;

    const list: { date: string; checked: boolean }[] = [];
    const current = new Date(start);
    while (current <= end) {
      list.push({
        date: current.toISOString().split("T")[0],
        checked: true,
      });
      current.setDate(current.getDate() + 1);
    }
    setGeneratedDates(list);
    const activeDays = list.filter((d) => d.checked).length;
    setTotalPrice(activeDays * pricePerSession);
  }, [startDate, endDate, stageType, pricePerSession]);

  // Helpers
  const getTeacherName = (tid: string) => {
    const t = teachers.find((te) => te.id === tid);
    return t ? `${t.firstName} ${t.lastName}` : "-";
  };

  const getStudentName = (sid?: string) => {
    const s = students.find((st) => st.id === sid);
    return s ? `${s.firstName} ${s.lastName}` : "-";
  };

  const toggleGeneratedDate = (index: number) => {
    const updated = [...generatedDates];
    updated[index].checked = !updated[index].checked;
    setGeneratedDates(updated);
    const activeDays = updated.filter((d) => d.checked).length;
    setTotalPrice(activeDays * pricePerSession);
  };

  const handleCreateStage = () => {
    if (!stageName || !teacherId) {
      alert("Le nom et l'enseignant sont obligatoires.");
      return;
    }

    const dates = stageType === "single" ? [singleDate] : generatedDates.filter((d) => d.checked).map((d) => d.date);

    if (dates.length === 0) {
      alert("Veuillez choisir au moins un jour actif pour le perfectionnement.");
      return;
    }

    const newStage: Coursework = {
      id: uid("cw"),
      name: stageName,
      type: stageType,
      dates,
      pricePerSession,
      total: totalPrice,
      teacherId,
    };

    push("coursework", newStage);
    setIsCreateStageOpen(false);
    resetStageForm();
  };

  const handleEditStage = () => {
    if (!selectedStage) return;
    const dates = stageType === "single" ? [singleDate] : generatedDates.filter((d) => d.checked).map((d) => d.date);

    if (dates.length === 0) {
      alert("Veuillez choisir au moins un jour actif pour le perfectionnement.");
      return;
    }

    updateItem("coursework", selectedStage.id, {
      name: stageName,
      type: stageType,
      dates,
      pricePerSession,
      total: totalPrice,
      teacherId,
    });
    setIsEditStageOpen(false);
    resetStageForm();
  };

  const handleDeleteStage = (id: string) => {
    if (confirm("Supprimer ce perfectionnement ?")) {
      deleteFrom("coursework", id);
    }
  };

  // Casual session item search options
  const getCasualItemOptions = () => {
    const list: { label: string; price: number }[] = [];

    // Search inside subscriptions
    subscriptions.forEach((sub) => {
      const s = sessions.find((se) => se.id === sub.sessionId);
      if (!s) return;
      const mod = modules.find((m) => m.id === s.moduleId)?.name ?? "Cours";
      const cl = classes.find((c) => c.id === s.classId)?.name ?? "Classe";
      const label = `${cl} - ${mod} (${sub.pricePerSession} DA / séance)`;

      if (!casualSearchQuery || label.toLowerCase().includes(casualSearchQuery.toLowerCase())) {
        list.push({
          label: `${cl} - ${mod}`,
          price: sub.pricePerSession,
        });
      }
    });

    // Search inside stages
    coursework.forEach((cw) => {
      const label = `Perfectionnement: ${cw.name} (${cw.total} DA)`;
      if (!casualSearchQuery || label.toLowerCase().includes(casualSearchQuery.toLowerCase())) {
        list.push({
          label: `Perfectionnement: ${cw.name}`,
          price: cw.total,
        });
      }
    });

    return list;
  };

  // Student search inside Séances Libres modal
  const getFilteredStudentsForCasual = () => {
    if (!studentSearchQuery.trim()) return [];
    return students.filter(
      (st) =>
        `${st.firstName} ${st.lastName}`.toLowerCase().includes(studentSearchQuery.toLowerCase()) ||
        st.phone.includes(studentSearchQuery)
    );
  };

  const handleCreateCasual = () => {
    if (!selectedItem) {
      alert("Veuillez sélectionner un cours ou perfectionnement.");
      return;
    }

    const passengerNameCalculated = !selectedStudent ? studentSearchQuery.trim() : undefined;
    if (selectedStudent === null && !passengerNameCalculated) {
      alert("Veuillez rechercher et sélectionner un étudiant ou saisir le nom d'un passager.");
      return;
    }

    const newCasual: IndependentSession = {
      id: uid("ind"),
      studentId: selectedStudent ? selectedStudent.id : undefined,
      passagerName: passengerNameCalculated || undefined,
      itemLabel: selectedItem.label,
      price: selectedItem.price,
      date: casualDate,
    };

    push("independent", newCasual);

    // If registered student, deduct directly from balance!
    if (selectedStudent) {
      const student = students.find((st) => st.id === selectedStudent.id);
      if (student && !student.isFree) {
        updateItem("students", student.id, {
          balance: student.balance - selectedItem.price,
        });
        // Register transaction
        push("balanceTx", {
          id: uid("bt"),
          studentId: student.id,
          amount: -selectedItem.price,
          date: new Date().toISOString(),
          type: "deduction",
          description: `Séance libre: ${selectedItem.label}`,
        });
      }
    }

    // Register cash inflow for school
    push("cash", {
      id: uid("csh"),
      type: "student_payment",
      amount: selectedItem.price,
      date: new Date().toISOString(),
      description: `Séance libre: ${selectedItem.label} (${
        selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : passengerNameCalculated
      })`,
    });

    setIsCreateCasualOpen(false);
    resetCasualForm();
  };

  const handleEditCasual = () => {
    if (!selectedCasual || !selectedItem) return;

    const passengerNameCalculated = !selectedStudent ? studentSearchQuery.trim() : undefined;
    if (selectedStudent === null && !passengerNameCalculated) {
      alert("Veuillez rechercher et sélectionner un étudiant ou saisir le nom d'un passager.");
      return;
    }

    updateItem("independent", selectedCasual.id, {
      studentId: selectedStudent ? selectedStudent.id : undefined,
      passagerName: passengerNameCalculated || undefined,
      itemLabel: selectedItem.label,
      price: selectedItem.price,
      date: casualDate,
    });

    setIsEditCasualOpen(false);
    resetCasualForm();
  };

  const handleDeleteCasual = (id: string) => {
    if (confirm("Supprimer l'historique de cette séance ?")) {
      deleteFrom("independent", id);
    }
  };

  const resetStageForm = () => {
    setStageName("");
    setStageType("single");
    setSingleDate(new Date().toISOString().split("T")[0]);
    setStartDate(new Date().toISOString().split("T")[0]);
    setEndDate(new Date().toISOString().split("T")[0]);
    setGeneratedDates([]);
    setPricePerSession(0);
    setTotalPrice(0);
    setTeacherId("");
    setSelectedStage(null);
  };

  const resetCasualForm = () => {
    setSelectedStudent(null);
    setStudentSearchQuery("");
    setCasualSearchQuery("");
    setSelectedItem(null);
    setCasualDate(new Date().toISOString().split("T")[0]);
    setSelectedCasual(null);
  };

  const openEditStage = (cw: Coursework) => {
    setSelectedStage(cw);
    setStageName(cw.name);
    setStageType(cw.type);
    setPricePerSession(cw.pricePerSession);
    setTotalPrice(cw.total);
    setTeacherId(cw.teacherId);
    if (cw.type === "single") {
      setSingleDate(cw.dates[0] || "");
    } else {
      setStartDate(cw.dates[0] || "");
      setEndDate(cw.dates[cw.dates.length - 1] || "");
      setGeneratedDates(cw.dates.map((d) => ({ date: d, checked: true })));
    }
    setIsEditStageOpen(true);
  };

  const openEditCasual = (ind: IndependentSession) => {
    setSelectedCasual(ind);
    setCasualDate(ind.date);

    if (ind.studentId) {
      const student = students.find((s) => s.id === ind.studentId);
      if (student) {
        setSelectedStudent(student);
        setStudentSearchQuery(`${student.firstName} ${student.lastName}`);
      } else {
        setSelectedStudent(null);
        setStudentSearchQuery("");
      }
    } else {
      setSelectedStudent(null);
      setStudentSearchQuery(ind.passagerName || "");
    }

    const options = getCasualItemOptions();
    const match = options.find((o) => o.label === ind.itemLabel) || {
      label: ind.itemLabel,
      price: ind.price,
    };
    setSelectedItem(match);

    setIsEditCasualOpen(true);
    setActiveMenuId(null);
  };

  const matchedStudents = getFilteredStudentsForCasual();

  return (
    <div>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <PageHeader
          emoji="🎓"
          title="Séances Libres & Perfectionnement"
          subtitle="Gérer les cours occasionnels et perfectionnements intensifs"
        />

        {/* Tab Switcher */}
        <div className="bg-surface border border-line rounded-2xl p-1 flex gap-1 self-end sm:self-center">
          <button
            onClick={() => setActiveTab("stages")}
            className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all ${
              activeTab === "stages" ? "bg-primary text-white" : "text-muted hover:text-ink"
            }`}
          >
            Perfectionnements
          </button>
          <button
            onClick={() => setActiveTab("casual")}
            className={`px-4 py-1.5 text-xs font-bold rounded-xl transition-all ${
              activeTab === "casual" ? "bg-primary text-white" : "text-muted hover:text-ink"
            }`}
          >
            Séances Libres
          </button>
        </div>
      </div>

      {activeTab === "stages" ? (
        <div>
          <div className="flex justify-end mb-4">
            <Button
              onClick={() => {
                resetStageForm();
                setIsCreateStageOpen(true);
              }}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" /> Nouveau Perfectionnement
            </Button>
          </div>

          {/* Grid of Perfectionnements */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {coursework.map((cw) => (
              <Card
                key={cw.id}
                className={`relative transition-all duration-300 ${
                  activeMenuId === cw.id
                    ? "z-30 scale-[1.02] ring-2 ring-primary/45 shadow-2xl"
                    : "z-10 hover:z-20 hover:shadow-lg hover:-translate-y-0.5 border border-line"
                }`}
              >
                <CardBody className="flex flex-col justify-between min-h-[220px] relative p-5">
                  {/* Actions overlay panel */}
                  {activeMenuId === cw.id && (
                    <div className="absolute inset-0 bg-surface/98 backdrop-blur-md rounded-2xl p-4 flex flex-col justify-between z-20 animate-in fade-in zoom-in-95 duration-200 border border-primary/20">
                      <div className="flex justify-between items-center border-b border-line pb-2">
                        <span className="font-bold text-[10px] text-muted uppercase tracking-wider">
                          Actions: {cw.name}
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
                          onClick={() => {
                            setSelectedStage(cw);
                            setIsDetailsStageOpen(true);
                            setActiveMenuId(null);
                          }}
                          className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                        >
                          <Eye className="h-3.5 w-3.5" /> Détails
                        </button>
                        <button
                          onClick={() => {
                            openEditStage(cw);
                            setActiveMenuId(null);
                          }}
                          className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                        >
                          <Edit className="h-3.5 w-3.5" /> Modifier
                        </button>
                      </div>

                      <div className="border-t border-line pt-2">
                        <button
                          onClick={() => {
                            handleDeleteStage(cw.id);
                            setActiveMenuId(null);
                          }}
                          className="flex items-center justify-center gap-1.5 w-full py-2 px-3 text-xs font-bold rounded-xl bg-danger text-white hover:bg-danger/90 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Supprimer
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 text-primary font-bold text-xs flex items-center justify-center tracking-wider shrink-0">
                          {cw.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-ink hover:text-primary transition-colors truncate">
                            {cw.name}
                          </h4>
                          <span className="text-[10px] text-muted block font-mono truncate">
                            Resp: {getTeacherName(cw.teacherId)}
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={() => setActiveMenuId(activeMenuId === cw.id ? null : cw.id)}
                        className="p-1.5 rounded-lg hover:bg-primary-50 text-muted hover:text-ink transition-colors shrink-0"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </button>
                    </div>

                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between text-xs bg-canvas/30 border border-line/60 rounded-xl p-2.5">
                        <div>
                          <span className="text-[10px] text-muted block uppercase font-semibold">Planification</span>
                          <span className="font-semibold text-ink">
                            {cw.type === "single" ? "Séance unique" : "Période"}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-muted block uppercase font-semibold">Prix séance</span>
                          <span className="font-bold text-primary">{cw.pricePerSession} DA</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                          <span className="text-muted block text-[9px] uppercase">Séances actives</span>
                          <strong className="text-ink mt-0.5">{cw.dates.length} jour(s)</strong>
                        </div>
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                          <span className="text-muted block text-[9px] uppercase">Tarif Total</span>
                          <strong className="text-primary mt-0.5">{cw.total} DA</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-line/60 pt-3 mt-4 flex items-center justify-between">
                    <span className="text-[10px] text-muted flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" />
                      Disponible
                    </span>

                    <Badge tone="primary" className="font-mono font-bold text-[10px]">
                      {cw.total} DA
                    </Badge>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <div>
          <div className="flex justify-end mb-4">
            <Button
              onClick={() => {
                resetCasualForm();
                setIsCreateCasualOpen(true);
              }}
              className="flex items-center gap-2"
            >
              <Plus className="h-4 w-4" /> Enregistrer Séance
            </Button>
          </div>

          {/* Grid of Séances Libres */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {independent.map((ind) => (
              <Card
                key={ind.id}
                className={`relative transition-all duration-300 ${
                  activeMenuId === ind.id
                    ? "z-30 scale-[1.02] ring-2 ring-primary/45 shadow-2xl"
                    : "z-10 hover:z-20 hover:shadow-lg hover:-translate-y-0.5 border border-line"
                }`}
              >
                <CardBody className="flex flex-col justify-between min-h-[220px] relative p-5">
                  {/* Actions overlay panel */}
                  {activeMenuId === ind.id && (
                    <div className="absolute inset-0 bg-surface/98 backdrop-blur-md rounded-2xl p-4 flex flex-col justify-between z-20 animate-in fade-in zoom-in-95 duration-200 border border-primary/20">
                      <div className="flex justify-between items-center border-b border-line pb-2">
                        <span className="font-bold text-[10px] text-muted uppercase tracking-wider">
                          Actions: {ind.studentId ? getStudentName(ind.studentId) : ind.passagerName}
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
                          onClick={() => {
                            openEditCasual(ind);
                            setActiveMenuId(null);
                          }}
                          className="flex items-center justify-center gap-1.5 py-2 px-3 text-xs font-bold rounded-xl bg-canvas border border-line text-ink hover:bg-primary-50 transition-colors"
                        >
                          <Edit className="h-3.5 w-3.5" /> Modifier
                        </button>
                      </div>

                      <div className="border-t border-line pt-2">
                        <button
                          onClick={() => {
                            handleDeleteCasual(ind.id);
                            setActiveMenuId(null);
                          }}
                          className="flex items-center justify-center gap-1.5 w-full py-2 px-3 text-xs font-bold rounded-xl bg-danger text-white hover:bg-danger/90 transition-colors"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Supprimer
                        </button>
                      </div>
                    </div>
                  )}

                  <div>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        <div className="h-10 w-10 rounded-full bg-success/10 border border-success/20 text-success font-bold text-xs flex items-center justify-center tracking-wider shrink-0">
                          {ind.studentId ? "🎓" : "🚶"}
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-sm font-bold text-ink hover:text-primary transition-colors truncate">
                            {ind.studentId ? getStudentName(ind.studentId) : ind.passagerName}
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
                      <div className="flex items-center justify-between text-xs bg-canvas/30 border border-line/60 rounded-xl p-2.5">
                        <div>
                          <span className="text-[10px] text-muted block uppercase font-semibold">Cours / Perfectionnement</span>
                          <span className="font-semibold text-ink truncate max-w-[150px] block">
                            {ind.itemLabel}
                          </span>
                        </div>
                        <div className="text-right">
                          <span className="text-[10px] text-muted block uppercase font-semibold">Tarif Payé</span>
                          <span className="font-bold text-success">{ind.price} DA</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px]">
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                          <span className="text-muted block text-[9px] uppercase font-sans">Date</span>
                          <strong className="text-ink mt-0.5 font-mono">{ind.date}</strong>
                        </div>
                        <div className="bg-canvas/20 border border-line/50 p-2 rounded-xl flex flex-col justify-between">
                          <span className="text-muted block text-[9px] uppercase">Règlement</span>
                          <strong className="text-success mt-0.5">Payé direct</strong>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-line/60 pt-3 mt-4 flex items-center justify-between">
                    <span className="text-[10px] text-muted flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full bg-success" />
                      Enregistré
                    </span>

                    <Badge tone="success" className="font-mono font-bold text-[10px]">
                      {ind.price} DA
                    </Badge>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Create Perfectionnement Modal */}
      <Modal open={isCreateStageOpen} onClose={() => setIsCreateStageOpen(false)} title="Créer un nouveau perfectionnement" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Nom du perfectionnement / Cours *</label>
              <Input value={stageName} onChange={(e) => setStageName(e.target.value)} placeholder="Ex: Informatique bureautique" />
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Enseignant responsable *</label>
              <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="w-full">
                <option value="">Sélectionner un prof</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5">Type de planification</label>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => setStageType("single")}
                  className={`p-3.5 rounded-2xl border text-left transition-all ${
                    stageType === "single"
                      ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                      : "border-line bg-surface hover:bg-canvas/50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Calendar className={`h-4.5 w-4.5 ${stageType === "single" ? "text-primary" : "text-muted"}`} />
                    <span className="font-bold text-xs text-ink font-sans">Séance Unique</span>
                  </div>
                  <span className="text-[10px] text-muted block leading-normal font-sans">
                    Une seule date planifiée pour ce cours
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setStageType("period")}
                  className={`p-3.5 rounded-2xl border text-left transition-all ${
                    stageType === "period"
                      ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                      : "border-line bg-surface hover:bg-canvas/50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Clock className={`h-4.5 w-4.5 ${stageType === "period" ? "text-primary" : "text-muted"}`} />
                    <span className="font-bold text-xs text-ink">Période</span>
                  </div>
                  <span className="text-[10px] text-muted block leading-normal">
                    Plage de dates récurrentes avec jours sélectionnés
                  </span>
                </button>
              </div>
            </div>

            {stageType === "single" ? (
              <div>
                <label className="block text-xs font-semibold text-muted mb-1 font-sans">Date</label>
                <Input type="date" value={singleDate} onChange={(e) => setSingleDate(e.target.value)} />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1">Début</label>
                    <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted mb-1 font-sans">Fin</label>
                    <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Prix par séance (DA)</label>
                <Input
                  type="number"
                  value={pricePerSession || ""}
                  onChange={(e) => {
                    setPricePerSession(Number(e.target.value));
                    if (stageType === "period") {
                      // Handled by useEffect, but trigger update for immediate responsiveness
                      const activeDays = generatedDates.filter((d) => d.checked).length;
                      setTotalPrice(activeDays * Number(e.target.value));
                    } else {
                      setTotalPrice(Number(e.target.value));
                    }
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Total (DA)</label>
                <Input type="number" value={totalPrice || ""} onChange={(e) => setTotalPrice(Number(e.target.value))} />
              </div>
            </div>

            {stageType === "period" && generatedDates.length > 0 && (
              <div className="border border-line rounded-xl p-3 bg-canvas/30 space-y-2">
                <label className="block text-[10px] text-muted font-bold uppercase">Dates générées ({generatedDates.length})</label>
                <div className="space-y-1 max-h-48 overflow-y-auto">
                  {generatedDates.map((d, idx) => (
                    <div key={d.date} className="flex justify-between items-center text-xs p-1.5 bg-surface border border-line rounded-lg">
                      <span className="font-mono">{d.date}</span>
                      <input
                        type="checkbox"
                        checked={d.checked}
                        onChange={() => toggleGeneratedDate(idx)}
                        className="h-4 w-4"
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateStageOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateStage}>Créer le Perfectionnement</Button>
        </div>
      </Modal>

      {/* Edit Perfectionnement Modal */}
      <Modal open={isEditStageOpen} onClose={() => setIsEditStageOpen(false)} title="Modifier le perfectionnement" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Nom du perfectionnement</label>
              <Input value={stageName} onChange={(e) => setStageName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Enseignant</label>
              <Select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className="w-full">
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.firstName} {t.lastName}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-muted mb-1.5 font-sans">Type</label>
              <div className="grid grid-cols-2 gap-3 mt-1">
                <button
                  type="button"
                  onClick={() => setStageType("single")}
                  className={`p-3.5 rounded-2xl border text-left transition-all ${
                    stageType === "single"
                      ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                      : "border-line bg-surface hover:bg-canvas/50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Calendar className={`h-4.5 w-4.5 ${stageType === "single" ? "text-primary" : "text-muted"}`} />
                    <span className="font-bold text-xs text-ink font-sans">Séance Unique</span>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setStageType("period")}
                  className={`p-3.5 rounded-2xl border text-left transition-all ${
                    stageType === "period"
                      ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                      : "border-line bg-surface hover:bg-canvas/50"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <Clock className={`h-4.5 w-4.5 ${stageType === "period" ? "text-primary" : "text-muted"}`} />
                    <span className="font-bold text-xs text-ink">Période</span>
                  </div>
                </button>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Prix Séance (DA)</label>
                <Input
                  type="number"
                  value={pricePerSession || ""}
                  onChange={(e) => {
                    setPricePerSession(Number(e.target.value));
                    setTotalPrice(generatedDates.filter((x) => x.checked).length * Number(e.target.value));
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Total (DA)</label>
                <Input type="number" value={totalPrice || ""} onChange={(e) => setTotalPrice(Number(e.target.value))} />
              </div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-6 mt-4 border-t border-line">
          <Button variant="outline" onClick={() => setIsEditStageOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleEditStage}>Enregistrer</Button>
        </div>
      </Modal>

      {/* Details Perfectionnement Modal */}
      <Modal open={isDetailsStageOpen} onClose={() => setIsDetailsStageOpen(false)} title="Détails du perfectionnement" wide>
        {selectedStage && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-primary-50/50 p-4 rounded-xl border border-line">
              <div>
                <span className="text-muted block font-semibold mb-0.5 font-sans">Perfectionnement</span>
                <span className="font-bold text-ink">{selectedStage.name}</span>
              </div>
              <div>
                <span className="text-muted block font-semibold mb-0.5">Enseignant</span>
                <span className="font-semibold text-ink">{getTeacherName(selectedStage.teacherId)}</span>
              </div>
              <div>
                <span className="text-muted block font-semibold mb-0.5 font-sans">Type</span>
                <Badge tone={selectedStage.type === "single" ? "neutral" : "primary"}>
                  {selectedStage.type === "single" ? "Jour unique" : "Période"}
                </Badge>
              </div>
              <div>
                <span className="text-muted block font-semibold mb-0.5">Tarif Total</span>
                <strong className="text-primary font-bold text-sm">{selectedStage.total} DA</strong>
              </div>
            </div>

            <div>
              <span className="text-[10px] text-muted font-bold block uppercase mb-2">Calendrier des séances ({selectedStage.dates.length})</span>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {selectedStage.dates.map((d) => (
                  <div key={d} className="flex items-center gap-1.5 p-2 bg-canvas border border-line rounded-lg font-mono text-[10px]">
                    <Calendar className="h-3 w-3 text-primary shrink-0" />
                    <span>{d}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-line">
              <Button onClick={() => setIsDetailsStageOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Create Casual Session Modal */}
      <Modal open={isCreateCasualOpen} onClose={() => setIsCreateCasualOpen(false)} title="Enregistrer une séance libre" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">
                Rechercher un élève (Nom ou Téléphone)
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={studentSearchQuery}
                  onChange={(e) => {
                    setStudentSearchQuery(e.target.value);
                    if (selectedStudent) {
                      setSelectedStudent(null);
                    }
                  }}
                  placeholder="Commencez à saisir..."
                  className="pl-9"
                />
              </div>
            </div>

            {studentSearchQuery.trim() !== "" && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-muted font-bold block uppercase font-sans">
                  Résultats de recherche ({matchedStudents.length}) :
                </span>
                <div className="border border-line rounded-xl max-h-44 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
                  {matchedStudents.map((st) => {
                    const isSelected = selectedStudent?.id === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => {
                          setSelectedStudent(st);
                          setStudentSearchQuery(`${st.firstName} ${st.lastName}`);
                        }}
                        className={`w-full text-start p-2.5 rounded-xl text-xs flex justify-between items-center transition-all ${
                          isSelected
                            ? "bg-primary/15 border border-primary/30 text-ink font-bold"
                            : "hover:bg-primary-50 text-ink border border-transparent"
                        }`}
                      >
                        <div>
                          <span className="font-semibold block">{st.firstName} {st.lastName}</span>
                          <span className="text-[9px] text-muted block mt-0.5">
                            🎂 Née le: {st.birthDate || "Non renseignée"} | 📞 {st.phone}
                          </span>
                        </div>
                        {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                  {matchedStudents.length === 0 && (
                    <div className="p-3 text-center text-xs text-muted bg-surface rounded-xl border border-line">
                      ⚠️ Aucun élève trouvé. Enregistré comme passager : "<strong>{studentSearchQuery}</strong>"
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans font-sans">Date de la séance</label>
              <Input type="date" value={casualDate} onChange={(e) => setCasualDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Sélectionner le cours / perfectionnement</label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={casualSearchQuery}
                  onChange={(e) => setCasualSearchQuery(e.target.value)}
                  placeholder="Rechercher cours ou perfectionnement..."
                  className="pl-9"
                />
              </div>
              <div className="border border-line rounded-xl max-h-48 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
                {getCasualItemOptions().map((opt) => {
                  const isSel = selectedItem?.label === opt.label;
                  return (
                    <button
                      key={opt.label}
                      onClick={() => setSelectedItem(opt)}
                      className={`w-full text-start p-2.5 rounded-lg text-xs flex justify-between items-center transition-colors ${
                        isSel ? "bg-primary text-white font-bold" : "hover:bg-primary-50 text-ink"
                      }`}
                    >
                      <span className="truncate pr-2">{opt.label}</span>
                      <strong className={isSel ? "text-white shrink-0" : "text-primary shrink-0"}>{opt.price} DA</strong>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedItem && (
              <div className="bg-success/10 border border-success/20 rounded-xl p-3.5 flex justify-between items-center text-xs">
                <span className="text-success font-semibold">Montant à encaisser :</span>
                <strong className="text-success text-sm font-extrabold">{selectedItem.price} DA</strong>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 mt-6 border-t border-line">
          <Button variant="outline" onClick={() => setIsCreateCasualOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleCreateCasual}>Enregistrer la Séance</Button>
        </div>
      </Modal>

      {/* Edit Casual Session Modal */}
      <Modal open={isEditCasualOpen} onClose={() => setIsEditCasualOpen(false)} title="Modifier la séance libre" wide>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">
                Rechercher un élève (Nom ou Téléphone)
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={studentSearchQuery}
                  onChange={(e) => {
                    setStudentSearchQuery(e.target.value);
                    if (selectedStudent) {
                      setSelectedStudent(null);
                    }
                  }}
                  placeholder="Commencez à saisir..."
                  className="pl-9"
                />
              </div>
            </div>

            {studentSearchQuery.trim() !== "" && (
              <div className="space-y-1.5">
                <span className="text-[10px] text-muted font-bold block uppercase">
                  Résultats de recherche ({matchedStudents.length}) :
                </span>
                <div className="border border-line rounded-xl max-h-44 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
                  {matchedStudents.map((st) => {
                    const isSelected = selectedStudent?.id === st.id;
                    return (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() => {
                          setSelectedStudent(st);
                          setStudentSearchQuery(`${st.firstName} ${st.lastName}`);
                        }}
                        className={`w-full text-start p-2.5 rounded-xl text-xs flex justify-between items-center transition-all ${
                          isSelected
                            ? "bg-primary/15 border border-primary/30 text-ink font-bold"
                            : "hover:bg-primary-50 text-ink border border-transparent"
                        }`}
                      >
                        <div>
                          <span className="font-semibold block">{st.firstName} {st.lastName}</span>
                          <span className="text-[9px] text-muted block mt-0.5">
                            🎂 Née le: {st.birthDate || "Non renseignée"} | 📞 {st.phone}
                          </span>
                        </div>
                        {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                      </button>
                    );
                  })}
                  {matchedStudents.length === 0 && (
                    <div className="p-3 text-center text-xs text-muted bg-surface rounded-xl border border-line">
                      ⚠️ Aucun élève trouvé. Enregistré comme passager : "<strong>{studentSearchQuery}</strong>"
                    </div>
                  )}
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-muted mb-1 font-sans">Date de la séance</label>
              <Input type="date" value={casualDate} onChange={(e) => setCasualDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Sélectionner le cours / perfectionnement</label>
              <div className="relative mb-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <Input
                  value={casualSearchQuery}
                  onChange={(e) => setCasualSearchQuery(e.target.value)}
                  placeholder="Rechercher cours ou perfectionnement..."
                  className="pl-9"
                />
              </div>
              <div className="border border-line rounded-xl max-h-48 overflow-y-auto p-1.5 bg-canvas/30 space-y-1">
                {getCasualItemOptions().map((opt) => {
                  const isSel = selectedItem?.label === opt.label;
                  return (
                    <button
                      key={opt.label}
                      onClick={() => setSelectedItem(opt)}
                      className={`w-full text-start p-2.5 rounded-lg text-xs flex justify-between items-center transition-colors ${
                        isSel ? "bg-primary text-white font-bold" : "hover:bg-primary-50 text-ink"
                      }`}
                    >
                      <span className="truncate pr-2">{opt.label}</span>
                      <strong className={isSel ? "text-white shrink-0" : "text-primary shrink-0"}>{opt.price} DA</strong>
                    </button>
                  );
                })}
              </div>
            </div>

            {selectedItem && (
              <div className="bg-success/10 border border-success/20 rounded-xl p-3.5 flex justify-between items-center text-xs">
                <span className="text-success font-semibold">Montant à encaisser :</span>
                <strong className="text-success text-sm font-extrabold">{selectedItem.price} DA</strong>
              </div>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-4 mt-6 border-t border-line">
          <Button variant="outline" onClick={() => setIsEditCasualOpen(false)}>
            Annuler
          </Button>
          <Button onClick={handleEditCasual}>Enregistrer</Button>
        </div>
      </Modal>
    </div>
  );
}
