"use client";

import { useEffect, useMemo, useState } from "react";
import { useData, uid } from "@/lib/store/data";
import {
  classLabel,
  courseKeyOf,
  formatDateFr,
  formatDays,
  studentName,
  todayIso,
  REGISTRATION_FEE_LABELS,
} from "@/lib/helpers";
import { formatDA } from "@/lib/utils";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge, type Tone } from "@/components/ui/Badge";
import { Input } from "@/components/ui/SearchInput";
import { EmptyState } from "@/components/ui/EmptyState";
import { Tabs } from "@/components/ui/Tabs";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  Trash2,
  Edit,
  Eye,
  Plus,
  MoreVertical,
  Ticket,
  Search,
  Wallet,
  Check,
  Users,
  Clock,
  AlertTriangle,
  CalendarRange,
  Gift,
  Power,
} from "lucide-react";
import type { FreePeriod, FreePeriodStat, Subscription, ScheduleSession } from "@/lib/types";

/** Point de départ par défaut d'une re-tarification : le 1er du mois en cours —
 *  la facturation d'un mois entamé se corrige d'un bloc, pas séance par séance. */
function firstOfThisMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString("fr-CA");
}

export function SubscriptionsPage() {
  const {
    school,
    subscriptions,
    sessions,
    classes,
    modules,
    teachers,
    groups,
    salles,
    attendance,
    setSubscriptionPrice,
    deleteSubscriptionPrice,
    repriceSession,
    updateSchool,
  } = useData();

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [selectedSub, setSelectedSub] = useState<Subscription | null>(null);

  // Form states
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");
  const [pricePerSession, setPricePerSession] = useState<number>(0);
  // formation-only pricing: fixed price for the whole level + duration in months
  const [levelPrice, setLevelPrice] = useState<number>(0);
  const [periodMonths, setPeriodMonths] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  // Changer le tarif d'un cours RE-TARIFE aussi les séances déjà pointées : le
  // débit de chaque élève est corrigé et la part encore due à l'enseignant suit
  // le nouveau prix. ACTIVÉ par défaut — un tarif changé qui ne descend ni chez
  // l'élève ni chez l'enseignant ne veut rien dire : l'écran Abonnements
  // affichait le nouveau prix pendant que l'écran Enseignants devait encore
  // l'ancien. Décochable, et la date de départ reste réglable.
  const [applyToPast, setApplyToPast] = useState(true);
  const [applyFrom, setApplyFrom] = useState(firstOfThisMonth);

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // The two global one-time registration fees (school-wide setting). Each one
  // carries the name the desk uses for it, because that name is what reception
  // picks from when a student is created.
  //
  // `school` is fetched after mount, so the form CANNOT hold its own copy from
  // the first render — it used to show 0 until a reload, and saving then wiped
  // the real fee. The draft stays null until something is actually typed, so
  // the inputs read the live school row right up to the first keystroke.
  interface FeeDraft {
    fee1: number;
    label1: string;
    fee2: number;
    label2: string;
  }
  const [feeDraft, setFeeDraft] = useState<FeeDraft | null>(null);
  const [feeSaved, setFeeSaved] = useState(false);
  /** Message of the last refused save (empty when the last one went through). */
  const [feeError, setFeeError] = useState("");

  const fees: FeeDraft = feeDraft ?? {
    fee1: school?.registrationFee ?? 0,
    label1: school?.registrationFeeLabel ?? "",
    fee2: school?.registrationFee2 ?? 0,
    label2: school?.registrationFee2Label ?? "",
  };
  const editFees = (patch: Partial<FeeDraft>) => setFeeDraft({ ...fees, ...patch });

  const handleSaveRegistrationFee = async () => {
    setFeeError("");
    const res = await updateSchool({
      registrationFee: Math.max(0, Math.round(fees.fee1 || 0)),
      registrationFeeLabel: fees.label1.trim(),
      registrationFee2: Math.max(0, Math.round(fees.fee2 || 0)),
      registrationFee2Label: fees.label2.trim(),
    });
    if (!res.ok) {
      // Most likely cause: the database still misses the second-tariff columns.
      setFeeError(res.error ?? "erreur inconnue");
      setFeeDraft(null);
      return;
    }
    // Saved: drop the draft so the inputs follow the school row again.
    setFeeDraft(null);
    setFeeSaved(true);
    setTimeout(() => setFeeSaved(false), 2000);
  };

  // Helpers
  const nameOf = <T extends { id: string; name: string }>(list: T[], id: string) =>
    list.find((x) => x.id === id)?.name ?? "-";

  const getSessionDetails = (sesId: string) => {
    const s = sessions.find((se) => se.id === sesId);
    if (!s) return null;
    const cls = classes.find((c) => c.id === s.classId);
    const mod = modules.find((m) => m.id === s.moduleId);
    const t = teachers.find((te) => te.id === s.teacherId);
    return {
      class: s.isOpen
        ? (s.classIds?.length ? s.classIds : [s.classId]).map((id) => nameOf(classes, id)).join(" · ")
        : cls?.name ?? "-",
      level: cls?.type === "cours" ? cls.coursLevel : cls?.formationLevel,
      isFormation: cls?.type === "formation",
      isOpen: !!s.isOpen,
      /** créneau de séance libre coché « offert » : il n'a aucun tarif */
      isOffered: !!s.isOpen && !!s.isFree,
      title: s.title,
      periodStart: s.periodStart,
      periodEnd: s.periodEnd,
      groupsLabel: s.isOpen
        ? (s.groupIds?.length ? s.groupIds : [s.groupId]).map((id) => nameOf(groups, id)).join(" · ")
        : nameOf(groups, s.groupId),
      sallesLabel: s.isOpen
        ? (s.salleIds?.length ? s.salleIds : [s.salleId]).map((id) => nameOf(salles, id)).join(" · ")
        : nameOf(salles, s.salleId),
      module: mod?.name ?? "-",
      teacher: t ? `${t.firstName} ${t.lastName}` : "-",
      teacherIsPassager: !!t?.isPassager,
      days: s.days,
      daysLabel: formatDays(s.days),
      time: `${s.startTime}-${s.endTime}`,
    };
  };

  const isFormationSession = (sesId: string) => {
    const s = sessions.find((se) => se.id === sesId);
    return s ? classes.find((c) => c.id === s.classId)?.type === "formation" : false;
  };

  /** Sibling groups of a regular course (same class + module + teacher). A
   *  séance libre is never grouped with anything: its timing IS the product. */
  const siblingSessionsOf = (s: ScheduleSession) => {
    const key = courseKeyOf(s);
    return sessions
      .filter((se) => courseKeyOf(se) === key)
      .sort((a, b) => nameOf(groups, a.groupId).localeCompare(nameOf(groups, b.groupId)));
  };

  /** The tariff is defined per COURSE, so a card stands for every group of it. */
  const groupsOfSubscription = (sub: Subscription) => {
    const s = sessions.find((se) => se.id === sub.sessionId);
    if (!s) return [];
    return siblingSessionsOf(s);
  };

  /** A group with no tariff, or a group priced differently: both mean the
   *  course is out of sync and one click repairs it. */
  const inconsistenciesOf = (sub: Subscription) => {
    const siblings = groupsOfSubscription(sub);
    const missing = siblings.filter((se) => !subscriptions.some((su) => su.sessionId === se.id));
    const divergent = siblings.filter((se) => {
      const other = subscriptions.find((su) => su.sessionId === se.id);
      return (
        other &&
        (other.pricePerSession !== sub.pricePerSession ||
          (other.levelPrice ?? 0) !== (sub.levelPrice ?? 0) ||
          (other.periodMonths ?? 0) !== (sub.periodMonths ?? 0))
      );
    });
    return { missing, divergent, count: missing.length + divergent.length };
  };

  // Group subscriptions by course (ignoring group) to display uniquely.
  // Séance libre timings are always listed individually.
  const getUniqueSubscriptions = () => {
    const seen = new Set<string>();
    const unique: Subscription[] = [];

    subscriptions.forEach((sub) => {
      const s = sessions.find((se) => se.id === sub.sessionId);
      if (!s) return;
      const key = courseKeyOf(s);
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(sub);
      }
    });

    return unique;
  };

  // Gains of a subscription = every attendance of every group of the course.
  const calculateSubscriptionGains = (sub: Subscription) => {
    const s = sessions.find((se) => se.id === sub.sessionId);
    if (!s) return 0;
    const siblingSessionIds = new Set(siblingSessionsOf(s).map((se) => se.id));
    return attendance
      .filter((att) => siblingSessionIds.has(att.sessionId))
      .reduce((sum, att) => sum + att.amountDeducted, 0);
  };

  // Search courses (one entry per class+module+teacher, all groups merged).
  // Séance libre timings already carry their own tariff, so they are not
  // offered here — they would create a duplicate.
  const getFilteredCoursesForSearch = () => {
    const seen = new Set<string>();
    const list: ScheduleSession[] = [];

    sessions.forEach((s) => {
      if (s.isOpen) return;
      const cls = classes.find((c) => c.id === s.classId);
      const mod = modules.find((m) => m.id === s.moduleId);
      const t = teachers.find((te) => te.id === s.teacherId);

      const label = `${mod?.name} ${cls?.name} ${cls?.type === "cours" ? cls.coursLevel : cls?.formationLevel} ${t?.firstName} ${t?.lastName} ${nameOf(groups, s.groupId)}`.toLowerCase();
      if (searchQuery && !label.includes(searchQuery.toLowerCase())) return;

      const key = courseKeyOf(s);
      if (!seen.has(key)) {
        seen.add(key);
        list.push(s);
      }
    });

    return list;
  };

  /** Un créneau de séance libre coché « offert » n'a pas de tarif : 0 DA est sa
   *  valeur légitime, pas une saisie oubliée. */
  const isOfferedSession = (sesId: string) => {
    const s = sessions.find((se) => se.id === sesId);
    return !!s?.isOpen && !!s.isFree;
  };

  /** One tariff written on EVERY group of the course, server-side. */
  const applyPrice = async (sessionId: string) => {
    const isFormation = isFormationSession(sessionId);
    if (isFormation && (levelPrice <= 0 || periodMonths <= 0)) {
      alert("Veuillez saisir le prix du niveau et la période (en mois) de la formation.");
      return false;
    }
    if (!isFormation && !isOfferedSession(sessionId) && pricePerSession <= 0) {
      alert("Veuillez saisir un prix par séance valide.");
      return false;
    }

    // Re-tarifer touche à de l'argent déjà passé : on le dit AVANT, en nommant
    // la date, pour qu'il soit encore possible de reculer.
    //
    // Un créneau OFFERT est hors sujet : son tarif est 0 par décision, et le
    // re-tarifer écraserait la valeur de ce qui a été offert (waived_amount),
    // que les rapports comptent comme le coût de la gratuité.
    const rewritesPast = applyToPast && !isFormation && !isOfferedSession(sessionId);
    if (rewritesPast) {
      const fromLabel = applyFrom.split("-").reverse().join("/");
      if (
        !confirm(
          `Appliquer ${pricePerSession} DA à TOUTES les séances pointées depuis le ${fromLabel} ?` +
            "\n\n• Le solde de chaque élève est corrigé de la différence, avec une ligne dans son historique." +
            "\n• La part ENCORE DUE à l'enseignant suit le nouveau tarif." +
            "\n• Les séances déjà réglées à l'enseignant ne sont jamais retouchées." +
            "\n• Les séances offertes restent offertes : personne n'y est débité." +
            "\n\nDécochez « Appliquer aussi aux séances déjà pointées » pour ne changer que le tarif des prochaines séances.",
        )
      ) {
        return false;
      }
    }

    setBusy(true);
    const res = await repriceSession({
      sessionId,
      price: isFormation ? 0 : pricePerSession,
      levelPrice: isFormation ? levelPrice : undefined,
      periodMonths: isFormation ? periodMonths : undefined,
      from: rewritesPast ? applyFrom : undefined,
    });
    setBusy(false);

    if (!res.ok) {
      alert("Enregistrement du tarif impossible. Vérifiez votre connexion et réessayez.");
      return false;
    }

    // La part encore due à l'enseignant est réalignée à CHAQUE enregistrement,
    // même sans re-tarification : c'est ce qui manquait pour que l'écran
    // Enseignants cesse de réclamer l'ancien montant.
    const duesTouched = (res.teacherDues ?? 0) + (res.teacherDuesRemoved ?? 0);
    if (rewritesPast && (res.repriced ?? 0) > 0) {
      alert(
        `Tarif enregistré sur ${res.groups ?? 0} groupe(s).` +
          `\n\n${res.repriced} présence(s) re-tarifée(s) depuis le ${applyFrom.split("-").reverse().join("/")} : ` +
          `${res.charged ?? 0} DA débités en plus, ${res.refunded ?? 0} DA rendus aux élèves, ` +
          `${duesTouched} part(s) enseignant encore dues mises à jour.` +
          "\nLes séances déjà réglées à l'enseignant n'ont pas été touchées.",
      );
    } else if (duesTouched > 0) {
      alert(
        `Tarif enregistré sur ${res.groups ?? 0} groupe(s).` +
          `\n\n${duesTouched} part(s) enseignant encore dues ont été remises au bon montant.`,
      );
    }
    return true;
  };

  const handleCreateSubscription = async () => {
    if (!selectedSessionId) {
      alert("Veuillez sélectionner un emploi.");
      return;
    }
    if (await applyPrice(selectedSessionId)) {
      setIsCreateOpen(false);
      resetForm();
    }
  };

  const handleEditSubscription = async () => {
    if (!selectedSub) return;
    if (await applyPrice(selectedSub.sessionId)) {
      setIsEditOpen(false);
      resetForm();
    }
  };

  /** Repairs a course whose groups drifted apart (a group added after the
   *  tariff was set, or an old row created one by one). */
  const handleHarmonize = async (sub: Subscription) => {
    setBusy(true);
    await setSubscriptionPrice(
      sub.sessionId,
      sub.pricePerSession,
      sub.levelPrice,
      sub.periodMonths,
    );
    setBusy(false);
  };

  const handleDelete = async (sub: Subscription) => {
    if (confirm("Supprimer ce tarif pour TOUS les groupes de ce cours ?")) {
      setBusy(true);
      await deleteSubscriptionPrice(sub.sessionId);
      setBusy(false);
      setActiveMenuId(null);
    }
  };

  const resetForm = () => {
    setSelectedSessionId("");
    setPricePerSession(0);
    setLevelPrice(0);
    setPeriodMonths(0);
    setSearchQuery("");
    setSelectedSub(null);
    setApplyToPast(true);
    setApplyFrom(firstOfThisMonth());
  };

  const openEdit = (sub: Subscription) => {
    setSelectedSub(sub);
    // Chaque ouverture repart du réglage par défaut : le mois en cours, appliqué.
    setApplyToPast(true);
    setApplyFrom(firstOfThisMonth());
    setPricePerSession(sub.pricePerSession);
    setLevelPrice(sub.levelPrice ?? 0);
    setPeriodMonths(sub.periodMonths ?? 0);
    setSelectedSessionId(sub.sessionId);
    setIsEditOpen(true);
    setActiveMenuId(null);
  };

  const openDetails = (sub: Subscription) => {
    setSelectedSub(sub);
    setIsDetailsOpen(true);
    setActiveMenuId(null);
  };

  /** The groups a price is about to be applied to — shown before saving so the
   *  user sees exactly what the single tariff covers. */
  const renderGroupsPreview = (sessionId: string) => {
    const s = sessions.find((se) => se.id === sessionId);
    if (!s) return null;
    const siblings = siblingSessionsOf(s);
    return (
      <div className="rounded-xl border border-primary/25 bg-primary-50/40 p-3">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-primary">
          <Users className="h-3.5 w-3.5" />
          Ce tarif s&apos;applique à {siblings.length} groupe{siblings.length > 1 ? "s" : ""} de ce cours
        </span>
        <div className="mt-2 space-y-1">
          {siblings.map((sib) => {
            const priced = subscriptions.find((su) => su.sessionId === sib.id);
            return (
              <div
                key={sib.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line/60 bg-surface px-2.5 py-1.5 text-[11px]"
              >
                <strong className="text-ink">{nameOf(groups, sib.groupId)}</strong>
                <span className="flex items-center gap-1 text-muted">
                  <Clock className="h-3 w-3" />
                  {formatDays(sib.days) || "—"} · {sib.startTime}-{sib.endTime} · Salle{" "}
                  {nameOf(salles, sib.salleId)}
                </span>
                <Badge tone={priced ? "success" : "warning"} className="text-[9px] px-1.5 py-0">
                  {priced ? `Actuel: ${priced.pricePerSession} DA` : "Sans tarif"}
                </Badge>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  /** The tariff catalogue — one card per cours, all its groups sharing it. */
  const tariffsTab = (
    <div>
      <div className="mb-4 flex items-center justify-end">
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nouvel Abonnement
        </Button>
      </div>

      {/* The two one-time registration fees (school-wide, set once and editable).
          Reception picks one of them — or none — on the création screen. */}
      <Card className="mb-6">
        <CardBody className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-primary-50 p-2.5 text-primary">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink">Frais d&apos;inscription uniques</h3>
              <p className="mt-0.5 text-xs text-muted">
                Deux types au choix, payés une seule fois par étudiant. À la création d&apos;une fiche, la
                réception choisit lequel des deux lui est facturé — ou aucun. Un montant laissé à{" "}
                <strong className="text-ink">0</strong> n&apos;est pas proposé.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {[
              {
                n: 1,
                placeholder: "Ex: Inscription annuelle",
                label: fees.label1,
                setLabel: (v: string) => editFees({ label1: v }),
                amount: fees.fee1,
                setAmount: (v: number) => editFees({ fee1: v }),
                fallback: REGISTRATION_FEE_LABELS.fee1,
              },
              {
                n: 2,
                placeholder: "Ex: Inscription semestrielle",
                label: fees.label2,
                setLabel: (v: string) => editFees({ label2: v }),
                amount: fees.fee2,
                setAmount: (v: number) => editFees({ fee2: v }),
                fallback: REGISTRATION_FEE_LABELS.fee2,
              },
            ].map((fee) => (
              <div
                key={fee.n}
                className={`rounded-xl border p-3 ${
                  fee.amount > 0 ? "border-primary/30 bg-primary-50/40" : "border-line bg-canvas/30"
                }`}
              >
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-muted">
                    Type {fee.n}
                  </span>
                  <Badge tone={fee.amount > 0 ? "success" : "neutral"} className="text-[9px]">
                    {fee.amount > 0 ? "Proposé à la création" : "Non proposé"}
                  </Badge>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_8rem]">
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-muted">Nom du type</label>
                    <Input
                      value={fee.label}
                      onChange={(e) => fee.setLabel(e.target.value)}
                      placeholder={fee.placeholder}
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-[10px] font-semibold text-muted">Montant (DA)</label>
                    <Input
                      type="number"
                      min={0}
                      value={fee.amount || ""}
                      onChange={(e) => fee.setAmount(Number(e.target.value))}
                      placeholder="0"
                    />
                  </div>
                </div>
                <p className="mt-1.5 text-[10px] text-muted">
                  Affiché comme «&nbsp;
                  <strong className="text-ink">{fee.label.trim() || fee.fallback}</strong>
                  &nbsp;» dans la fiche étudiant.
                </p>
              </div>
            ))}
          </div>

          {feeError && (
            <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-xs text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <strong className="block">Les frais n&apos;ont PAS été enregistrés.</strong>
                <span className="text-[11px]">
                  {feeError}. Si le message parle d&apos;une colonne inconnue
                  (<code>registration_fee_2</code>), la base n&apos;a pas encore reçu la migration
                  «&nbsp;second frais d&apos;inscription&nbsp;» — exécutez-la puis réessayez.
                </span>
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <Button onClick={handleSaveRegistrationFee} className="flex items-center gap-2">
              {feeSaved ? (
                <>
                  <Check className="h-4 w-4" /> Enregistré
                </>
              ) : (
                "Enregistrer les frais"
              )}
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* One card per course — every group of it shares the same tariff */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {getUniqueSubscriptions().map((sub) => {
          const details = getSessionDetails(sub.sessionId);
          if (!details) return null;
          const totalGains = calculateSubscriptionGains(sub);
          const courseGroups = groupsOfSubscription(sub);
          const issues = inconsistenciesOf(sub);

          return (
            <Card key={sub.id} className="relative overflow-visible">
              <CardBody className="flex flex-col justify-between min-h-48">
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <Ticket className={`h-5 w-5 shrink-0 ${details.isOpen ? "text-success" : "text-primary"}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h4 className="text-sm font-bold text-ink">
                            {details.module}
                          </h4>
                          {details.isFormation && (
                            <Badge tone="primary" className="text-[9px] px-1.5 py-0">
                              Formation
                            </Badge>
                          )}
                          {details.isOpen && (
                            <Badge tone="success" className="text-[9px] px-1.5 py-0">
                              Séance Libre
                            </Badge>
                          )}
                          {details.isOffered && (
                            <Badge tone="warning" className="text-[9px] px-1.5 py-0">
                              🎁 Offerte
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted block truncate">
                          {details.isOpen ? details.class : `${details.class} - ${details.level}`}
                        </span>
                        {details.isOpen && (
                          <span className="text-[10px] text-muted block font-mono">
                            {details.time} · {details.periodStart} → {details.periodEnd}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Menu Actions */}
                    <div className="relative">
                      <button
                        onClick={() => setActiveMenuId(activeMenuId === sub.id ? null : sub.id)}
                        className="p-1 rounded-lg hover:bg-primary-50 text-muted hover:text-ink transition-colors"
                      >
                        <MoreVertical className="h-5 w-5" />
                      </button>
                      {activeMenuId === sub.id && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setActiveMenuId(null)} />
                          <div className="absolute right-0 mt-1 w-36 bg-surface border border-line rounded-xl shadow-lg z-20 overflow-hidden">
                            <button
                              onClick={() => openDetails(sub)}
                              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-ink hover:bg-primary-50 text-left"
                            >
                              <Eye className="h-4 w-4" /> Détails
                            </button>
                            <button
                              onClick={() => openEdit(sub)}
                              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-ink hover:bg-primary-50 text-left"
                            >
                              <Edit className="h-4 w-4" /> Modifier
                            </button>
                            <button
                              onClick={() => handleDelete(sub)}
                              className="flex items-center gap-2 w-full px-4 py-2 text-sm text-danger hover:bg-danger/10 text-left"
                            >
                              <Trash2 className="h-4 w-4" /> Supprimer
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 space-y-1 text-xs">
                    <div className="flex justify-between text-muted">
                      <span>Enseignant:</span>
                      <strong className="text-ink">
                        {details.teacher}
                        {details.teacherIsPassager && (
                          <Badge tone="warning" className="ml-1.5 text-[9px] px-1 py-0">Passager</Badge>
                        )}
                      </strong>
                    </div>
                    {details.isOpen ? (
                      <>
                        <div className="flex justify-between text-muted">
                          <span>Groupes:</span>
                          <strong className="text-ink truncate max-w-[60%] text-right">{details.groupsLabel}</strong>
                        </div>
                        <div className="flex justify-between text-muted">
                          <span>Salles:</span>
                          <strong className="text-ink truncate max-w-[60%] text-right">{details.sallesLabel}</strong>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between text-muted">
                        <span>Groupes couverts:</span>
                        <strong className="text-ink truncate max-w-[60%] text-right">
                          {courseGroups.map((se) => nameOf(groups, se.groupId)).join(" · ")}
                        </strong>
                      </div>
                    )}
                    {details.isFormation ? (
                      <>
                        <div className="flex justify-between text-muted">
                          <span>Prix du niveau:</span>
                          <strong className="text-primary">{sub.levelPrice ?? 0} DA</strong>
                        </div>
                        <div className="flex justify-between text-muted">
                          <span>Période:</span>
                          <strong className="text-ink">{sub.periodMonths ?? 0} mois</strong>
                        </div>
                      </>
                    ) : (
                      <div className="flex justify-between text-muted">
                        <span>Tarif Séance:</span>
                        {details.isOffered ? (
                          <strong className="text-warning">🎁 Offerte — 0 DA</strong>
                        ) : (
                          <strong className="text-primary">{sub.pricePerSession} DA</strong>
                        )}
                      </div>
                    )}
                  </div>

                  {issues.count > 0 && (
                    <div className="mt-3 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-2.5 text-[11px]">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                      <div className="min-w-0 flex-1">
                        <strong className="block text-ink">
                          {issues.missing.length > 0 && `${issues.missing.length} groupe(s) sans tarif`}
                          {issues.missing.length > 0 && issues.divergent.length > 0 && " · "}
                          {issues.divergent.length > 0 && `${issues.divergent.length} groupe(s) à un prix différent`}
                        </strong>
                        <button
                          onClick={() => handleHarmonize(sub)}
                          disabled={busy}
                          className="mt-1 font-bold text-primary hover:underline disabled:opacity-50"
                        >
                          Appliquer ce tarif à tous les groupes
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="border-t border-line pt-3 mt-3 flex items-center justify-between text-xs">
                  <span className="text-muted">Gains générés</span>
                  <strong className="text-success font-bold text-sm bg-success/10 px-2 py-1 rounded-lg">
                    {totalGains} DA
                  </strong>
                </div>
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );

  return (
    <div>
      <PageHeader
        emoji="🎫"
        title="Abonnements"
        subtitle="Un tarif par cours, appliqué à tous ses groupes — et les périodes offertes"
      />

      <Tabs
        tabs={[
          { id: "tarifs", label: "Tarifs", content: tariffsTab },
          { id: "gratuit", label: "🎁 Périodes gratuites", content: <FreePeriodsPanel /> },
        ]}
      />

      {/* Creation Modal */}
      <Modal open={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="Créer un tarif d'abonnement" wide>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-muted mb-1">Rechercher un cours / emploi</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filtrer par module, classe, niveau, enseignant ou groupe..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="border border-line rounded-xl max-h-56 overflow-y-auto bg-canvas/30 p-2">
            <label className="block text-[10px] font-bold text-muted uppercase mb-2 px-2">Résultats de recherche</label>
            {getFilteredCoursesForSearch().length === 0 ? (
              <p className="text-xs text-muted italic px-2">Aucun emploi disponible.</p>
            ) : (
              <div className="space-y-1">
                {getFilteredCoursesForSearch().map((s) => {
                  const details = getSessionDetails(s.id);
                  if (!details) return null;
                  const isSelected = selectedSessionId === s.id;
                  const siblings = siblingSessionsOf(s);
                  const priced = subscriptions.find((su) =>
                    siblings.some((sib) => sib.id === su.sessionId),
                  );
                  return (
                    <button
                      key={s.id}
                      onClick={() => {
                        setSelectedSessionId(s.id);
                        if (priced) {
                          setPricePerSession(priced.pricePerSession);
                          setLevelPrice(priced.levelPrice ?? 0);
                          setPeriodMonths(priced.periodMonths ?? 0);
                        }
                      }}
                      className={`w-full text-start p-2 rounded-lg text-xs transition-colors flex justify-between items-center gap-2 ${
                        isSelected ? "bg-primary text-white" : "hover:bg-primary-50 text-ink"
                      }`}
                    >
                      <div className="min-w-0">
                        <strong className="block font-bold">
                          {details.module}
                          {details.isFormation && (
                            <span className={`ml-1.5 text-[9px] font-bold px-1.5 py-0.5 rounded ${isSelected ? "bg-white/20" : "bg-primary/15 text-primary"}`}>
                              Formation {details.level}
                            </span>
                          )}
                        </strong>
                        <span className={isSelected ? "text-white/80" : "text-muted"}>
                          Classe: {details.class} | Ens: {details.teacher}
                        </span>
                        <span className={`block text-[10px] ${isSelected ? "text-white/70" : "text-muted"}`}>
                          {siblings.length} groupe{siblings.length > 1 ? "s" : ""}:{" "}
                          {siblings.map((sib) => nameOf(groups, sib.groupId)).join(" · ")}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {priced && (
                          <span
                            className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                              isSelected ? "bg-white/20" : "bg-success/15 text-success"
                            }`}
                          >
                            {priced.pricePerSession} DA
                          </span>
                        )}
                        {isSelected && <span className="text-xs font-bold bg-white/20 px-2 py-0.5 rounded">Sélectionné</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {selectedSessionId && renderGroupsPreview(selectedSessionId)}

          {selectedSessionId && isFormationSession(selectedSessionId) ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">
                    Prix du niveau {getSessionDetails(selectedSessionId)?.level ? `(${getSessionDetails(selectedSessionId)?.level})` : ""} (DA)
                  </label>
                  <Input
                    type="number"
                    value={levelPrice || ""}
                    onChange={(e) => setLevelPrice(Number(e.target.value))}
                    placeholder="Ex: 25000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-muted mb-1">Période de la formation (mois)</label>
                  <Input
                    type="number"
                    value={periodMonths || ""}
                    onChange={(e) => setPeriodMonths(Number(e.target.value))}
                    placeholder="Ex: 3"
                  />
                </div>
              </div>
              <div className="bg-primary-50/50 border border-line rounded-xl p-3 text-xs text-muted">
                🎓 <strong className="text-ink">Formation :</strong> prix fixe pour tout le niveau, valable pendant la
                période indiquée. Lors de l&apos;inscription d&apos;un étudiant, vous choisirez sa date de début et la date
                d&apos;expiration sera calculée automatiquement.
              </div>
            </>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Prix par séance (DA)</label>
              <Input
                type="number"
                value={pricePerSession || ""}
                onChange={(e) => setPricePerSession(Number(e.target.value))}
                placeholder="Ex: 500"
              />
            </div>
          )}

          <div className="bg-primary-50/50 border border-line rounded-xl p-3 text-xs text-muted">
            💡 <strong className="text-ink">Un seul tarif par cours :</strong> le prix saisi ici est écrit sur
            <strong className="text-ink"> tous les groupes </strong> du même cours (même classe, même module, même
            enseignant) — inutile de les tarifer un par un. Un groupe créé plus tard hérite automatiquement de ce tarif.
          </div>

          <div className="bg-canvas/40 border border-line rounded-xl p-3 text-xs text-muted">
            🎫 Les <strong className="text-ink">frais d&apos;inscription uniques</strong> (deux types au choix) sont
            définis globalement en haut de cette page et s&apos;appliquent une seule fois par étudiant : le type
            facturé est choisi sur sa fiche, à sa création.
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={busy}>
              Annuler
            </Button>
            <Button onClick={handleCreateSubscription} disabled={busy}>
              {busy ? "Enregistrement…" : "Créer"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier le tarif d'abonnement" wide>
        <div className="space-y-4">
          {selectedSub && (
            <div className="bg-canvas p-3 rounded-xl border border-line text-xs">
              <span className="text-[10px] text-muted block uppercase">Abonnement sélectionné</span>
              <div className="flex items-center gap-1.5 mt-1">
                <strong className="text-ink block">
                  {getSessionDetails(selectedSub.sessionId)?.module}
                </strong>
                {getSessionDetails(selectedSub.sessionId)?.isFormation && (
                  <Badge tone="primary" className="text-[9px] px-1.5 py-0">Formation</Badge>
                )}
              </div>
              <span className="text-muted">
                {getSessionDetails(selectedSub.sessionId)?.class} - {getSessionDetails(selectedSub.sessionId)?.teacher}
              </span>
            </div>
          )}

          {selectedSub && renderGroupsPreview(selectedSub.sessionId)}

          {selectedSub && isFormationSession(selectedSub.sessionId) ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Prix du niveau (DA)</label>
                <Input
                  type="number"
                  value={levelPrice || ""}
                  onChange={(e) => setLevelPrice(Number(e.target.value))}
                  placeholder="Ex: 25000"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted mb-1">Période de la formation (mois)</label>
                <Input
                  type="number"
                  value={periodMonths || ""}
                  onChange={(e) => setPeriodMonths(Number(e.target.value))}
                  placeholder="Ex: 3"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-semibold text-muted mb-1">Prix par séance (DA)</label>
              <Input
                type="number"
                value={pricePerSession || ""}
                onChange={(e) => setPricePerSession(Number(e.target.value))}
                placeholder="Ex: 500"
              />
            </div>
          )}

          {/* Le nouveau tarif descend-il jusqu'aux séances DÉJÀ pointées ? */}
          {selectedSub &&
            !isFormationSession(selectedSub.sessionId) &&
            !isOfferedSession(selectedSub.sessionId) && (
            <div className="rounded-xl border border-warning/30 bg-warning/5 p-3 space-y-2">
              <label className="flex cursor-pointer items-start gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={applyToPast}
                  onChange={(e) => setApplyToPast(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0"
                />
                <span>
                  <strong className="text-ink">Appliquer aussi aux séances déjà pointées</strong>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-muted">
                    Le débit de chaque élève est corrigé (avec sa ligne dans l&apos;historique du solde) et
                    la part <strong className="text-ink">encore due</strong> à l&apos;enseignant suit le
                    nouveau prix. Les séances <strong className="text-ink">déjà réglées</strong> à
                    l&apos;enseignant ne sont jamais retouchées.
                    <br />
                    Décochez pour que le nouveau tarif ne vaille que{" "}
                    <strong className="text-ink">à partir de la prochaine séance</strong>.
                  </span>
                </span>
              </label>
              {applyToPast && (
                <div className="flex flex-wrap items-center gap-2 border-t border-warning/20 pt-2">
                  <label className="text-[11px] font-semibold text-muted">À partir du</label>
                  <Input
                    type="date"
                    value={applyFrom}
                    onChange={(e) => setApplyFrom(e.target.value)}
                    className="w-44"
                  />
                  <span className="text-[10px] text-muted">
                    Les présences antérieures gardent leur ancien tarif.
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsEditOpen(false)} disabled={busy}>
              Annuler
            </Button>
            <Button onClick={handleEditSubscription} disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer pour tous les groupes"}
            </Button>
          </div>

        </div>
      </Modal>

      {/* Details Modal */}
      <Modal open={isDetailsOpen} onClose={() => setIsDetailsOpen(false)} title="Détails de l'abonnement" wide>
        {selectedSub && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-primary-50/50 rounded-xl p-4 border border-line">
              <div>
                <span className="text-[10px] text-muted block uppercase">Module</span>
                <span className="font-bold text-ink">{getSessionDetails(selectedSub.sessionId)?.module}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase">Classe</span>
                <span className="font-semibold text-ink">{getSessionDetails(selectedSub.sessionId)?.class}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase">Enseignant</span>
                <span className="font-semibold text-ink">{getSessionDetails(selectedSub.sessionId)?.teacher}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted block uppercase">Horaires</span>
                <span className="font-semibold text-ink">{getSessionDetails(selectedSub.sessionId)?.time}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <h4 className="font-bold text-ink">📊 Performances Financières</h4>
                <div className="bg-surface border border-line p-4 rounded-xl space-y-3">
                  {getSessionDetails(selectedSub.sessionId)?.isFormation ? (
                    <>
                      <div className="flex justify-between items-center text-sm border-b border-line pb-2">
                        <span className="text-muted">Prix du niveau:</span>
                        <strong className="text-primary font-bold">{selectedSub.levelPrice ?? 0} DA</strong>
                      </div>
                      <div className="flex justify-between items-center text-sm border-b border-line pb-2">
                        <span className="text-muted">Période de la formation:</span>
                        <strong className="text-ink font-bold">{selectedSub.periodMonths ?? 0} mois</strong>
                      </div>
                    </>
                  ) : (
                    <div className="flex justify-between items-center text-sm border-b border-line pb-2">
                      <span className="text-muted">Prix unitaire séance:</span>
                      <strong className="text-primary font-bold">{selectedSub.pricePerSession} DA</strong>
                    </div>
                  )}
                  <div className="flex justify-between items-center text-sm">
                    <span className="text-muted font-semibold">Total des gains encaissés:</span>
                    <strong className="text-success font-extrabold text-lg">{calculateSubscriptionGains(selectedSub)} DA</strong>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-ink mb-2">👥 Groupes concernés (même tarif)</h4>
                <div className="bg-surface border border-line p-4 rounded-xl space-y-2 max-h-56 overflow-y-auto">
                  {groupsOfSubscription(selectedSub).map((sib) => {
                    const priced = subscriptions.find((su) => su.sessionId === sib.id);
                    return (
                      <div key={sib.id} className="rounded border border-line/50 bg-canvas/30 p-2 text-xs">
                        <div className="flex items-center justify-between">
                          <strong className="text-ink font-semibold">{nameOf(groups, sib.groupId)}</strong>
                          <Badge tone={priced ? "success" : "warning"} className="text-[9px] px-1.5 py-0">
                            {priced ? `${priced.pricePerSession} DA` : "Sans tarif"}
                          </Badge>
                        </div>
                        <span className="mt-0.5 block text-[10px] text-muted">
                          {formatDays(sib.days) || "—"} · {sib.startTime}-{sib.endTime} · Salle{" "}
                          {nameOf(salles, sib.salleId)}
                        </span>
                      </div>
                    );
                  })}
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

// =============================================================================
// Périodes gratuites
// -----------------------------------------------------------------------------
// A free period is a date window during which séances are OFFERED: the card is
// scanned normally and the presence is written, but the price is never taken
// off the student's balance. The server stores what it would have charged on
// each presence (`waivedAmount`), so this panel can show exactly what the
// period cost the school. Totals come from the `free_period_stats` RPC —
// aggregated server-side, so they never depend on how many attendance rows the
// browser happened to load.
// =============================================================================

type PeriodStatus = "upcoming" | "running" | "ended" | "off";

const STATUS_META: Record<PeriodStatus, { label: string; tone: Tone }> = {
  running: { label: "En cours", tone: "success" },
  upcoming: { label: "À venir", tone: "primary" },
  ended: { label: "Terminée", tone: "neutral" },
  off: { label: "Désactivée", tone: "warning" },
};

function statusOf(fp: FreePeriod): PeriodStatus {
  if (!fp.active) return "off";
  const today = todayIso(); // YYYY-MM-DD sorts lexicographically
  if (fp.startDate > today) return "upcoming";
  if (fp.endDate < today) return "ended";
  return "running";
}

function FreePeriodsPanel() {
  const db = useData();
  const {
    classes,
    students,
    sessions,
    modules,
    freePeriods,
    attendance,
    push,
    updateItem,
    deleteFrom,
    fetchFreePeriodStats,
    applyOfferedRules,
  } = db;

  const [stats, setStats] = useState<FreePeriodStat[]>([]);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [editing, setEditing] = useState<FreePeriod | null>(null);
  const [viewing, setViewing] = useState<FreePeriod | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);

  // Form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState(todayIso());
  const [endDate, setEndDate] = useState(todayIso());
  const [selectedClassIds, setSelectedClassIds] = useState<string[]>([]);
  const [payTeachers, setPayTeachers] = useState(true);
  const [active, setActive] = useState(true);
  const [error, setError] = useState("");

  // The cost of a period only moves when a period is created/edited or a new
  // presence lands, so recomputing on those two is enough.
  useEffect(() => {
    let alive = true;
    fetchFreePeriodStats().then((rows) => {
      if (alive) setStats(rows);
    });
    return () => {
      alive = false;
    };
  }, [fetchFreePeriodStats, freePeriods, attendance]);

  const statOf = (id: string) =>
    stats.find((s) => s.id === id) ?? { id, presences: 0, students: 0, waived: 0 };

  const sorted = useMemo(
    () => [...freePeriods].sort((a, b) => b.startDate.localeCompare(a.startDate)),
    [freePeriods],
  );

  const totals = useMemo(
    () => ({
      running: freePeriods.filter((fp) => statusOf(fp) === "running").length,
      waived: stats.reduce((s, r) => s + (r.waived ?? 0), 0),
      presences: stats.reduce((s, r) => s + (r.presences ?? 0), 0),
    }),
    [freePeriods, stats],
  );

  const classesOf = (fp: FreePeriod) =>
    fp.allClasses ? classes : classes.filter((c) => fp.classIds.includes(c.id));

  /** Presences the period offered, most recent first (best-effort local list —
   *  the headline totals above come from the server). */
  const presencesOf = (fp: FreePeriod) =>
    attendance
      .filter((a) => a.freePeriodId === fp.id)
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDescription("");
    setStartDate(todayIso());
    setEndDate(todayIso());
    // Every class is covered by default; the user unchecks what he wants out.
    setSelectedClassIds(classes.map((c) => c.id));
    setPayTeachers(true);
    setActive(true);
    setError("");
    setIsFormOpen(true);
  };

  const openEdit = (fp: FreePeriod) => {
    setEditing(fp);
    setName(fp.name);
    setDescription(fp.description);
    setStartDate(fp.startDate);
    setEndDate(fp.endDate);
    setSelectedClassIds(fp.allClasses ? classes.map((c) => c.id) : [...fp.classIds]);
    setPayTeachers(fp.payTeachers);
    setActive(fp.active);
    setError("");
    setMenuId(null);
    setIsFormOpen(true);
  };

  const toggleClass = (id: string) =>
    setSelectedClassIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );

  const handleSave = async () => {
    if (!startDate || !endDate) {
      setError("Indiquez une date de début et une date de fin.");
      return;
    }
    if (endDate < startDate) {
      setError("La date de fin doit être postérieure (ou égale) à la date de début.");
      return;
    }
    if (selectedClassIds.length === 0) {
      setError("Sélectionnez au moins une classe.");
      return;
    }

    const allClasses = classes.length > 0 && selectedClassIds.length === classes.length;
    const payload = {
      name: name.trim() || "Période gratuite",
      description: description.trim(),
      startDate,
      endDate,
      allClasses,
      // A period covering everything keeps an empty list: a class created later
      // is then automatically covered too.
      classIds: allClasses ? [] : selectedClassIds,
      payTeachers,
      active,
    };

    if (editing) {
      await updateItem("freePeriods", editing.id, payload);
    } else {
      await push("freePeriods", {
        id: uid("fp"),
        createdAt: new Date().toISOString(),
        ...payload,
      });
    }
    setIsFormOpen(false);
    // Une période couvre presque toujours des jours DÉJÀ passés. Sans ce
    // rattrapage, les élèves qui avaient badgé avant sa création restaient
    // débités — et l'enseignant payé sur eux — pendant que ceux d'après
    // passaient gratuitement : c'est le « ça marche pour certains élèves
    // seulement » que ce rattrapage fait disparaître.
    await reconcileOffered(active ? { from: startDate, to: endDate } : null);
  };

  /** Applique la gratuité aux présences DÉJÀ pointées sur la fenêtre donnée :
   *  l'élève débité à tort est remboursé et la séance due non réglée disparaît.
   *  Rien n'est jamais repris à personne — suspendre ou supprimer une période
   *  (range null) ne re-débite donc aucun élève. */
  const reconcileOffered = async (range: { from: string; to: string } | null) => {
    if (!range) return;
    const res = await applyOfferedRules(range);
    if (!res.ok) {
      alert(
        "La période est enregistrée, mais les présences déjà pointées n'ont pas pu être " +
          "rattrapées. Si le message parle d'une fonction manquante, passez la migration " +
          "supabase/migrations/20260903_price_sync_and_offered_reconcile.sql.",
      );
      return;
    }
    if ((res.presences ?? 0) > 0 || (res.duesRemoved ?? 0) > 0) {
      alert(
        `${res.presences ?? 0} présence(s) déjà pointée(s) sont devenues offertes : ` +
          `${res.refunded ?? 0} DA rendus aux élèves` +
          ((res.duesRemoved ?? 0) > 0
            ? `, ${res.duesRemoved} séance(s) retirée(s) de ce qui reste dû aux enseignants`
            : "") +
          ".\nLes règlements déjà versés n'ont pas été touchés.",
      );
    }
  };

  const handleToggleActive = async (fp: FreePeriod) => {
    await updateItem("freePeriods", fp.id, { active: !fp.active });
    setMenuId(null);
    // Réactiver une période rattrape ce qui a été pointé pendant qu'elle
    // dormait ; la suspendre ne reprend rien à personne.
    await reconcileOffered(!fp.active ? { from: fp.startDate, to: fp.endDate } : null);
  };

  const handleDelete = (fp: FreePeriod) => {
    const stat = statOf(fp.id);
    const warning =
      stat.presences > 0
        ? `\n\nATTENTION : ${stat.presences} présence(s) déjà offertes par cette période perdront leur rattachement (les élèves ne seront PAS débités, mais le récapitulatif de ${formatDA(stat.waived)} disparaîtra). Pour la stopper sans perdre l'historique, utilisez plutôt « Désactiver ».`
        : "";
    if (confirm(`Supprimer la période gratuite « ${fp.name} » ?${warning}`)) {
      deleteFrom("freePeriods", fp.id);
      setMenuId(null);
    }
  };

  const sessionLabelOf = (sessionId: string) => {
    const s = sessions.find((se) => se.id === sessionId);
    if (!s) return "—";
    const mod = modules.find((m) => m.id === s.moduleId)?.name ?? "—";
    return `${mod} (${s.startTime}-${s.endTime})`;
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-muted">
          Pendant une période gratuite, l&apos;élève badge normalement et sa{" "}
          <strong className="text-ink">présence est enregistrée</strong>, mais{" "}
          <strong className="text-ink">rien n&apos;est débité de son solde</strong>. Le prix non
          facturé est mémorisé : c&apos;est le coût réel de la période pour l&apos;école.
        </p>
        <Button onClick={openCreate} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nouvelle période gratuite
        </Button>
      </div>

      {/* Headline figures — server-side totals */}
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardBody className="flex items-center gap-3">
            <div className="rounded-xl bg-success/10 p-2.5 text-success">
              <Gift className="h-5 w-5" />
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">
                Périodes en cours
              </span>
              <strong className="text-lg font-extrabold text-ink">{totals.running}</strong>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-3">
            <div className="rounded-xl bg-primary-50 p-2.5 text-primary">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">
                Présences offertes
              </span>
              <strong className="text-lg font-extrabold text-ink">{totals.presences}</strong>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex items-center gap-3">
            <div className="rounded-xl bg-warning/10 p-2.5 text-warning">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <span className="block text-[10px] font-bold uppercase tracking-wider text-muted">
                Coût total offert
              </span>
              <strong className="text-lg font-extrabold text-warning">
                {formatDA(totals.waived)}
              </strong>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* History — one card per period */}
      {sorted.length === 0 ? (
        <EmptyState
          emoji="🎁"
          message="Aucune période gratuite. Créez-en une pour offrir les séances sur une plage de dates."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {sorted.map((fp) => {
            const status = STATUS_META[statusOf(fp)];
            const stat = statOf(fp.id);
            const covered = classesOf(fp);

            return (
              <Card key={fp.id} className="relative overflow-visible">
                <CardBody className="flex min-h-48 flex-col justify-between">
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Gift
                          className={`h-5 w-5 shrink-0 ${
                            statusOf(fp) === "running" ? "text-success" : "text-primary"
                          }`}
                        />
                        <div className="min-w-0">
                          <h4 className="truncate text-sm font-bold text-ink">{fp.name}</h4>
                          <span className="flex items-center gap-1 text-[11px] text-muted">
                            <CalendarRange className="h-3 w-3" />
                            {formatDateFr(fp.startDate)} → {formatDateFr(fp.endDate)}
                          </span>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <Badge tone={status.tone} className="px-1.5 py-0 text-[9px]">
                          {status.label}
                        </Badge>
                        <div className="relative">
                          <button
                            onClick={() => setMenuId(menuId === fp.id ? null : fp.id)}
                            className="rounded-lg p-1 text-muted transition-colors hover:bg-primary-50 hover:text-ink"
                          >
                            <MoreVertical className="h-5 w-5" />
                          </button>
                          {menuId === fp.id && (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setMenuId(null)} />
                              <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
                                <button
                                  onClick={() => {
                                    setViewing(fp);
                                    setIsDetailsOpen(true);
                                    setMenuId(null);
                                  }}
                                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-ink hover:bg-primary-50"
                                >
                                  <Eye className="h-4 w-4" /> Détails
                                </button>
                                <button
                                  onClick={() => openEdit(fp)}
                                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-ink hover:bg-primary-50"
                                >
                                  <Edit className="h-4 w-4" /> Modifier
                                </button>
                                <button
                                  onClick={() => handleToggleActive(fp)}
                                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-ink hover:bg-primary-50"
                                >
                                  <Power className="h-4 w-4" />
                                  {fp.active ? "Désactiver" : "Réactiver"}
                                </button>
                                <button
                                  onClick={() => handleDelete(fp)}
                                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-danger hover:bg-danger/10"
                                >
                                  <Trash2 className="h-4 w-4" /> Supprimer
                                </button>
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {fp.description && (
                      <p className="mt-2 line-clamp-2 text-xs text-muted">{fp.description}</p>
                    )}

                    <div className="mt-3 space-y-1 text-xs">
                      <div className="flex justify-between text-muted">
                        <span>Classes:</span>
                        <strong className="max-w-[60%] truncate text-right text-ink">
                          {fp.allClasses
                            ? "Toutes les classes"
                            : `${covered.length} classe${covered.length > 1 ? "s" : ""}`}
                        </strong>
                      </div>
                      <div className="flex justify-between text-muted">
                        <span>Présences offertes:</span>
                        <strong className="text-ink">{stat.presences}</strong>
                      </div>
                      <div className="flex justify-between text-muted">
                        <span>Élèves concernés:</span>
                        <strong className="text-ink">{stat.students}</strong>
                      </div>
                      <div className="flex justify-between text-muted">
                        <span>Enseignants payés:</span>
                        <strong className="text-ink">{fp.payTeachers ? "Oui" : "Non"}</strong>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-line pt-3 text-xs">
                    <span className="text-muted">Coût de la période</span>
                    <strong className="rounded-lg bg-warning/10 px-2 py-1 text-sm font-bold text-warning">
                      {formatDA(stat.waived)}
                    </strong>
                  </div>
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / edit */}
      <Modal
        open={isFormOpen}
        onClose={() => setIsFormOpen(false)}
        title={editing ? "Modifier la période gratuite" : "Nouvelle période gratuite"}
        wide
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Nom de la période</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Semaine portes ouvertes"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-semibold text-muted">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Motif de la gratuité (facultatif)"
              className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-primary"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Date de début</label>
              <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Date de fin</label>
              <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>

          {/* Classes — all selected by default, the user unchecks what stays payant */}
          <div className="rounded-xl border border-line p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted">
                Classes concernées ({selectedClassIds.length}/{classes.length})
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedClassIds(classes.map((c) => c.id))}
                >
                  Tout sélectionner
                </Button>
                <Button variant="outline" size="sm" onClick={() => setSelectedClassIds([])}>
                  Tout désélectionner
                </Button>
              </div>
            </div>

            {classes.length === 0 ? (
              <p className="px-1 text-xs italic text-muted">Aucune classe enregistrée.</p>
            ) : (
              <div className="max-h-52 space-y-1 overflow-y-auto">
                {classes.map((c) => {
                  const checked = selectedClassIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={`flex cursor-pointer items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                        checked
                          ? "border-primary/30 bg-primary-50/50 text-ink"
                          : "border-line/60 bg-surface text-muted"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleClass(c.id)}
                        className="h-4 w-4 accent-[var(--primary)]"
                      />
                      <span className="font-semibold">{classLabel(db, c)}</span>
                      <Badge
                        tone={c.type === "formation" ? "primary" : "neutral"}
                        className="ml-auto px-1.5 py-0 text-[9px]"
                      >
                        {c.type === "formation" ? c.formationLevel : c.coursLevel}
                      </Badge>
                    </label>
                  );
                })}
              </div>
            )}

            <p className="mt-2 text-[11px] text-muted">
              {classes.length > 0 && selectedClassIds.length === classes.length
                ? "✅ Toutes les classes sont couvertes — une classe créée plus tard le sera aussi."
                : "Seules les classes cochées bénéficient de la gratuité ; les autres restent facturées normalement."}
            </p>
          </div>

          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line p-3 text-xs">
            <input
              type="checkbox"
              checked={payTeachers}
              onChange={(e) => setPayTeachers(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
            />
            <span>
              <strong className="text-ink">Rémunérer les enseignants normalement</strong>
              <span className="mt-0.5 block text-muted">
                Les enseignants payés au pourcentage touchent leur part sur le prix habituel de la
                séance, même si l&apos;élève n&apos;a rien payé. Décochez pour que la séance offerte
                ne génère aucune part enseignant.
              </span>
            </span>
          </label>

          <label className="flex cursor-pointer items-start gap-2 rounded-xl border border-line p-3 text-xs">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--primary)]"
            />
            <span>
              <strong className="text-ink">Période active</strong>
              <span className="mt-0.5 block text-muted">
                Décochez pour suspendre la gratuité sans supprimer la période ni son historique.
              </span>
            </span>
          </label>

          <div className="rounded-xl border border-line bg-primary-50/50 p-3 text-xs text-muted">
            🎁 <strong className="text-ink">Effet au scan :</strong> la carte est acceptée
            normalement, la présence est enregistrée (et compte pour l&apos;enseignant et les
            statistiques), mais <strong className="text-ink">aucun montant n&apos;est retiré</strong>{" "}
            du solde de l&apos;élève. Les absences hebdomadaires ne sont pas facturées non plus sur
            les semaines couvertes.
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-danger/30 bg-danger/10 p-3 text-xs font-semibold text-danger">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsFormOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleSave}>{editing ? "Enregistrer" : "Créer la période"}</Button>
          </div>
        </div>
      </Modal>

      {/* Details / history */}
      <Modal
        open={isDetailsOpen}
        onClose={() => setIsDetailsOpen(false)}
        title="Détails de la période gratuite"
        wide
      >
        {viewing && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 rounded-xl border border-line bg-primary-50/50 p-4 md:grid-cols-4">
              <div>
                <span className="block text-[10px] uppercase text-muted">Période</span>
                <span className="font-bold text-ink">{viewing.name}</span>
              </div>
              <div>
                <span className="block text-[10px] uppercase text-muted">Du → au</span>
                <span className="font-semibold text-ink">
                  {formatDateFr(viewing.startDate)} → {formatDateFr(viewing.endDate)}
                </span>
              </div>
              <div>
                <span className="block text-[10px] uppercase text-muted">Statut</span>
                <Badge tone={STATUS_META[statusOf(viewing)].tone} className="mt-0.5">
                  {STATUS_META[statusOf(viewing)].label}
                </Badge>
              </div>
              <div>
                <span className="block text-[10px] uppercase text-muted">Coût total</span>
                <span className="font-extrabold text-warning">
                  {formatDA(statOf(viewing.id).waived)}
                </span>
              </div>
            </div>

            {viewing.description && (
              <p className="rounded-xl border border-line bg-canvas/30 p-3 text-xs text-muted">
                {viewing.description}
              </p>
            )}

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <div>
                <h4 className="mb-2 font-bold text-ink">🏫 Classes couvertes</h4>
                <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-line bg-surface p-3">
                  {viewing.allClasses && (
                    <p className="mb-1 text-[11px] font-semibold text-success">
                      Toutes les classes (y compris celles créées plus tard).
                    </p>
                  )}
                  {classesOf(viewing).map((c) => (
                    <div
                      key={c.id}
                      className="rounded border border-line/50 bg-canvas/30 px-2 py-1.5 text-xs text-ink"
                    >
                      {classLabel(db, c)}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-2 font-bold text-ink">📊 Ce que la période a offert</h4>
                <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
                  <div className="flex items-center justify-between border-b border-line pb-2 text-sm">
                    <span className="text-muted">Présences offertes:</span>
                    <strong className="text-ink">{statOf(viewing.id).presences}</strong>
                  </div>
                  <div className="flex items-center justify-between border-b border-line pb-2 text-sm">
                    <span className="text-muted">Élèves concernés:</span>
                    <strong className="text-ink">{statOf(viewing.id).students}</strong>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-muted">Coût pour l&apos;école:</span>
                    <strong className="text-lg font-extrabold text-warning">
                      {formatDA(statOf(viewing.id).waived)}
                    </strong>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h4 className="mb-2 font-bold text-ink">🎫 Séances offertes</h4>
              <div className="max-h-72 overflow-y-auto rounded-xl border border-line">
                {presencesOf(viewing).length === 0 ? (
                  <p className="p-4 text-xs italic text-muted">
                    Aucune présence enregistrée sur cette période pour l&apos;instant.
                  </p>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-canvas/80 backdrop-blur">
                      <tr className="text-left text-[10px] uppercase text-muted">
                        <th className="px-3 py-2">Élève</th>
                        <th className="px-3 py-2">Séance</th>
                        <th className="px-3 py-2">Date</th>
                        <th className="px-3 py-2 text-right">Offert</th>
                      </tr>
                    </thead>
                    <tbody>
                      {presencesOf(viewing).map((a) => {
                        const st = students.find((s) => s.id === a.studentId);
                        return (
                          <tr key={a.id} className="border-t border-line/60">
                            <td className="px-3 py-2 font-semibold text-ink">
                              {st ? studentName(st) : "—"}
                            </td>
                            <td className="px-3 py-2 text-muted">
                              {sessionLabelOf(a.sessionId)}
                            </td>
                            <td className="px-3 py-2 text-muted">
                              {new Date(a.timestamp).toLocaleString("fr-DZ", {
                                day: "2-digit",
                                month: "2-digit",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </td>
                            <td className="px-3 py-2 text-right font-bold text-success">
                              {formatDA(a.waivedAmount ?? 0)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            <div className="flex justify-end border-t border-line pt-2">
              <Button onClick={() => setIsDetailsOpen(false)}>Fermer</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
