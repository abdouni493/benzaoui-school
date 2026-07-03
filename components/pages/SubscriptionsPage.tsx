"use client";

import { useState } from "react";
import { useData, uid } from "@/lib/store/data";
import { Card, CardBody } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Badge } from "@/components/ui/Badge";
import { Input, Select } from "@/components/ui/SearchInput";
import { PageHeader } from "@/components/layout/PageHeader";
import { Trash2, Edit, Eye, Plus, MoreVertical, Ticket, Search, Wallet, Check } from "lucide-react";
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
    push,
    deleteFrom,
    updateItem,
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
  const getSessionDetails = (sesId: string) => {
    const s = sessions.find((se) => se.id === sesId);
    if (!s) return null;
    const cls = classes.find((c) => c.id === s.classId);
    const mod = modules.find((m) => m.id === s.moduleId);
    const t = teachers.find((te) => te.id === s.teacherId);
    return {
      class: cls?.name ?? "-",
      level: cls?.type === "cours" ? cls.coursLevel : cls?.formationLevel,
      isFormation: cls?.type === "formation",
      module: mod?.name ?? "-",
      teacher: t ? `${t.firstName} ${t.lastName}` : "-",
      days: s.days,
      time: `${s.startTime}-${s.endTime}`,
    };
  };

  const isFormationSession = (sesId: string) => {
    const s = sessions.find((se) => se.id === sesId);
    return s ? classes.find((c) => c.id === s.classId)?.type === "formation" : false;
  };

  // Group subscriptions by class/module/teacher (ignoring group) to display uniquely
  const getUniqueSubscriptions = () => {
    const seen = new Set<string>();
    const unique: Subscription[] = [];

    subscriptions.forEach((sub) => {
      const s = sessions.find((se) => se.id === sub.sessionId);
      if (!s) return;
      // Unique key based on class, module, teacher
      const key = `${s.classId}-${s.moduleId}-${s.teacherId}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(sub);
      }
    });

    return unique;
  };

  // Calculate gains for a subscription (including sibling groups)
  const calculateSubscriptionGains = (sub: Subscription) => {
    const s = sessions.find((se) => se.id === sub.sessionId);
    if (!s) return 0;

    // Find all sessions sharing same class, module, teacher (different groups)
    const siblingSessionIds = new Set(
      sessions
        .filter((se) => se.classId === s.classId && se.moduleId === s.moduleId && se.teacherId === s.teacherId)
        .map((se) => se.id)
    );

    // Sum attendance records for these session ids
    return attendance
      .filter((att) => siblingSessionIds.has(att.sessionId))
      .reduce((sum, att) => sum + att.amountDeducted, 0);
  };

  // Search schedule sessions (deduplicated by class, module, teacher)
  const getFilteredSessionsForSearch = () => {
    const seen = new Set<string>();
    const list: ScheduleSession[] = [];

    // Filter sessions matching search query
    sessions.forEach((s) => {
      const cls = classes.find((c) => c.id === s.classId);
      const mod = modules.find((m) => m.id === s.moduleId);
      const t = teachers.find((te) => te.id === s.teacherId);

      const label = `${mod?.name} ${cls?.name} ${cls?.type === "cours" ? cls.coursLevel : cls?.formationLevel} ${t?.firstName} ${t?.lastName}`.toLowerCase();
      if (searchQuery && !label.includes(searchQuery.toLowerCase())) return;

      const key = `${s.classId}-${s.moduleId}-${s.teacherId}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push(s);
      }
    });

    return list;
  };

  const handleCreateSubscription = () => {
    if (!selectedSessionId) {
      alert("Veuillez sélectionner un emploi.");
      return;
    }
    const isFormation = isFormationSession(selectedSessionId);
    if (isFormation && (levelPrice <= 0 || periodMonths <= 0)) {
      alert("Veuillez saisir le prix du niveau et la période (en mois) de la formation.");
      return;
    }
    if (!isFormation && pricePerSession <= 0) {
      alert("Veuillez saisir un prix par séance valide.");
      return;
    }

    const s = sessions.find((se) => se.id === selectedSessionId);
    if (!s) return;

    // Find all schedule sessions sharing the same class, module, and teacher (all groups)
    const matchingSessions = sessions.filter(
      (se) => se.classId === s.classId && se.moduleId === s.moduleId && se.teacherId === s.teacherId
    );

    // Create subscriptions for each of them if not already existing
    matchingSessions.forEach((matchSes) => {
      const exists = subscriptions.some((su) => su.sessionId === matchSes.id);
      if (!exists) {
        const newSub: Subscription = {
          id: uid("sub"),
          sessionId: matchSes.id,
          // formations are paid per level, not per scan
          pricePerSession: isFormation ? 0 : pricePerSession,
        };
        if (isFormation) {
          newSub.levelPrice = levelPrice;
          newSub.periodMonths = periodMonths;
        }
        push("subscriptions", newSub);
      }
    });

    setIsCreateOpen(false);
    resetForm();
  };

  const handleEditSubscription = () => {
    if (!selectedSub) return;
    const isFormation = isFormationSession(selectedSub.sessionId);
    if (isFormation && (levelPrice <= 0 || periodMonths <= 0)) {
      alert("Veuillez saisir le prix du niveau et la période (en mois) de la formation.");
      return;
    }
    if (!isFormation && pricePerSession <= 0) return;
    const s = sessions.find((se) => se.id === selectedSub.sessionId);
    if (!s) return;

    // Find all matching sessions (sibling groups) and update their subscription price
    const matchingSessions = sessions.filter(
      (se) => se.classId === s.classId && se.moduleId === s.moduleId && se.teacherId === s.teacherId
    );

    matchingSessions.forEach((matchSes) => {
      const matchSub = subscriptions.find((su) => su.sessionId === matchSes.id);
      if (matchSub) {
        updateItem(
          "subscriptions",
          matchSub.id,
          isFormation
            ? { pricePerSession: 0, levelPrice, periodMonths }
            : { pricePerSession }
        );
      }
    });

    setIsEditOpen(false);
    resetForm();
  };

  const handleDelete = (sub: Subscription) => {
    if (confirm("Êtes-vous sûr de vouloir supprimer cet abonnement (et ses déclinaisons par groupe) ?")) {
      const s = sessions.find((se) => se.id === sub.sessionId);
      if (!s) return;

      const matchingSessions = sessions.filter(
        (se) => se.classId === s.classId && se.moduleId === s.moduleId && se.teacherId === s.teacherId
      );

      matchingSessions.forEach((matchSes) => {
        const matchSub = subscriptions.find((su) => su.sessionId === matchSes.id);
        if (matchSub) {
          deleteFrom("subscriptions", matchSub.id);
        }
      });

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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <PageHeader emoji="🎫" title="Abonnements" subtitle="Gérer les tarifs d'abonnements" />
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
              <h3 className="text-sm font-bold text-ink">Frais d'inscription uniques</h3>
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

      {/* Unique subscriptions grid (deduplicated by groups) */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {getUniqueSubscriptions().map((sub) => {
          const details = getSessionDetails(sub.sessionId);
          if (!details) return null;
          const totalGains = calculateSubscriptionGains(sub);

          return (
            <Card key={sub.id} className="relative overflow-visible">
              <CardBody className="flex flex-col justify-between min-h-48">
                <div>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <Ticket className="h-5 w-5 text-primary" />
                      <div>
                        <div className="flex items-center gap-1.5">
                          <h4 className="text-sm font-bold text-ink">
                            {details.module}
                          </h4>
                          {details.isFormation && (
                            <Badge tone="primary" className="text-[9px] px-1.5 py-0">
                              Formation
                            </Badge>
                          )}
                        </div>
                        <span className="text-xs text-muted block">
                          {details.class} - {details.level}
                        </span>
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
                      <strong className="text-ink">{details.teacher}</strong>
                    </div>
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
                placeholder="Filtrer par module, niveau ou enseignant..."
                className="pl-9"
              />
            </div>
          </div>

          <div className="border border-line rounded-xl max-h-48 overflow-y-auto bg-canvas/30 p-2">
            <label className="block text-[10px] font-bold text-muted uppercase mb-2 px-2">Résultats de recherche</label>
            {getFilteredSessionsForSearch().length === 0 ? (
              <p className="text-xs text-muted italic px-2">Aucun emploi disponible.</p>
            ) : (
              <div className="space-y-1">
                {getFilteredSessionsForSearch().map((s) => {
                  const details = getSessionDetails(s.id);
                  if (!details) return null;
                  const isSelected = selectedSessionId === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedSessionId(s.id)}
                      className={`w-full text-start p-2 rounded-lg text-xs transition-colors flex justify-between items-center ${
                        isSelected ? "bg-primary text-white" : "hover:bg-primary-50 text-ink"
                      }`}
                    >
                      <div>
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
                      </div>
                      {isSelected && <span className="text-xs font-bold bg-white/20 px-2 py-0.5 rounded">Sélectionné</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

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
                période indiquée. Lors de l'inscription d'un étudiant, vous choisirez sa date de début et la date
                d'expiration sera calculée automatiquement.
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
            💡 <strong className="text-ink">Règle automatique :</strong> Si le cours sélectionné comporte plusieurs groupes,
            l'abonnement sera automatiquement répliqué pour tous les autres groupes avec le même prix.
          </div>

          <div className="bg-canvas/40 border border-line rounded-xl p-3 text-xs text-muted">
            🎫 Les <strong className="text-ink">frais d'inscription uniques</strong> sont définis globalement en haut de cette page
            et s'appliquent une seule fois par étudiant.
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleCreateSubscription}>Créer</Button>
          </div>
        </div>
      </Modal>

      {/* Edit Modal */}
      <Modal open={isEditOpen} onClose={() => setIsEditOpen(false)} title="Modifier le tarif d'abonnement">
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
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>
              Annuler
            </Button>
            <Button onClick={handleEditSubscription}>Enregistrer</Button>
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
                <h4 className="font-bold text-ink mb-2">👥 Groupes concernés</h4>
                <div className="bg-surface border border-line p-4 rounded-xl space-y-2 max-h-48 overflow-y-auto">
                  {(() => {
                    const s = sessions.find((se) => se.id === selectedSub.sessionId);
                    if (!s) return null;
                    const siblings = sessions.filter(
                      (se) => se.classId === s.classId && se.moduleId === s.moduleId && se.teacherId === s.teacherId
                    );
                    return siblings.map((sib) => {
                      const grName = groups.find((g) => g.id === sib.groupId)?.name ?? "-";
                      const salName = salles.find((sl) => sl.id === sib.salleId)?.name ?? "-";
                      return (
                        <div key={sib.id} className="flex justify-between text-xs bg-canvas/30 p-2 rounded border border-line/50">
                          <strong className="text-ink font-semibold">{grName}</strong>
                          <span className="text-muted">Salle: {salName}</span>
                        </div>
                      );
                    });
                  })()}
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
