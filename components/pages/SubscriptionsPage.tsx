"use client";

import { useState } from "react";
import { useData } from "@/lib/store/data";
import { courseKeyOf, formatDays } from "@/lib/helpers";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/SearchInput";
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
} from "lucide-react";
import type { Subscription, ScheduleSession } from "@/lib/types";

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

  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Global one-time registration fee (school-wide setting)
  const [registrationFee, setRegistrationFee] = useState<number>(school?.registrationFee ?? 0);
  const [feeSaved, setFeeSaved] = useState(false);

  const handleSaveRegistrationFee = () => {
    updateSchool({ registrationFee: Math.max(0, registrationFee || 0) });
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

  /** One tariff written on EVERY group of the course, server-side. */
  const applyPrice = async (sessionId: string) => {
    const isFormation = isFormationSession(sessionId);
    if (isFormation && (levelPrice <= 0 || periodMonths <= 0)) {
      alert("Veuillez saisir le prix du niveau et la période (en mois) de la formation.");
      return false;
    }
    if (!isFormation && pricePerSession <= 0) {
      alert("Veuillez saisir un prix par séance valide.");
      return false;
    }

    setBusy(true);
    const res = await setSubscriptionPrice(
      sessionId,
      isFormation ? 0 : pricePerSession,
      isFormation ? levelPrice : undefined,
      isFormation ? periodMonths : undefined,
    );
    setBusy(false);

    if (!res.ok) {
      alert("Enregistrement du tarif impossible. Vérifiez votre connexion et réessayez.");
      return false;
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
  };

  const openEdit = (sub: Subscription) => {
    setSelectedSub(sub);
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <PageHeader emoji="🎫" title="Abonnements" subtitle="Un tarif par cours, appliqué à tous ses groupes" />
        <Button onClick={() => { resetForm(); setIsCreateOpen(true); }} className="flex items-center gap-2">
          <Plus className="h-4 w-4" /> Nouvel Abonnement
        </Button>
      </div>

      {/* Global one-time registration fee (school-wide, set once and editable) */}
      <Card className="mb-6">
        <CardBody className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex flex-1 items-start gap-3">
            <div className="rounded-xl bg-primary-50 p-2.5 text-primary">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-ink">Frais d&apos;inscription uniques</h3>
              <p className="mt-0.5 text-xs text-muted">
                Frais payés une seule fois par étudiant lors de sa première inscription. Modifiable à tout moment.
              </p>
            </div>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted">Montant (DA)</label>
              <Input
                type="number"
                value={registrationFee || ""}
                onChange={(e) => setRegistrationFee(Number(e.target.value))}
                placeholder="Ex: 1000"
                className="w-32"
              />
            </div>
            <Button onClick={handleSaveRegistrationFee} className="flex items-center gap-2">
              {feeSaved ? (
                <>
                  <Check className="h-4 w-4" /> Enregistré
                </>
              ) : (
                "Enregistrer"
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
                        <strong className="text-primary">{sub.pricePerSession} DA</strong>
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
            🎫 Les <strong className="text-ink">frais d&apos;inscription uniques</strong> sont définis globalement en haut de cette page
            et s&apos;appliquent une seule fois par étudiant.
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
