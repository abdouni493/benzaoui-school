"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  CreditCard,
  DollarSign,
  Edit,
  Eye,
  MessageCircle,
  MoreVertical,
  Printer,
  Trash2,
} from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { daysUntil, EXPIRY_WARNING_DAYS, type StudentDebt } from "@/lib/helpers";
import { isSendablePhone } from "@/lib/whatsapp/phone";
import type { Parent, Student } from "@/lib/types";

/** Ce qu'une carte sait déclencher. L'objet est STABLE d'un rendu à l'autre
 *  (l'écran le construit une fois) : c'est ce qui permet à la carte de ne pas
 *  se redessiner quand on tape dans un formulaire de la page. */
export interface StudentCardActions {
  openWhatsApp: (stu: Student, focus: "student" | "parent") => void;
  openDetails: (stu: Student) => void;
  openAssign: (stu: Student) => void;
  openTopup: (stu: Student) => void;
  openPayDebt: (stu: Student) => void;
  printStudent: (stu: Student) => void;
  openEdit: (stu: Student) => void;
  openPrintPayments: (stu: Student) => void;
  deleteStudent: (id: string) => void;
  openRegFee: (stu: Student) => void;
  setOverlay: (id: string | null) => void;
}

/**
 * Une carte élève de la liste.
 *
 * `memo` : tant que l'élève, sa dette et son parent sont les MÊMES objets (le
 * store les conserve quand rien n'a changé), la carte n'est pas recalculée.
 * Avant, chaque lettre tapée dans « Ajouter un étudiant » redessinait les
 * centaines de cartes de la liste derrière la fenêtre.
 */
export const StudentCard = memo(function StudentCard({
  stu,
  debt,
  overlaid,
  parent,
  labelOf,
  actions,
}: {
  stu: Student;
  debt: StudentDebt;
  overlaid: boolean;
  parent?: Parent;
  labelOf: (subId: string) => string;
  actions: StudentCardActions;
}) {
  return (
    <Card className="relative overflow-visible">
      <CardBody className="relative flex h-56 flex-col justify-between">
        {/* Overlay Action Buttons displayed ABOVE the card when three dots are clicked */}
        {overlaid && (
          <div className="absolute inset-0 z-20 flex flex-col justify-start space-y-2 overflow-y-auto rounded-2xl bg-primary-600/95 p-4 text-white backdrop-blur-sm">
            <div className="mb-1 flex items-center justify-between border-b border-white/20 pb-2">
              <span className="truncate text-sm font-bold">
                {stu.firstName} {stu.lastName}
              </span>
              <button
                onClick={() => actions.setOverlay(null)}
                className="rounded bg-white/10 px-2 py-0.5 text-xs hover:underline"
              >
                Fermer
              </button>
            </div>

            {/* Envoi WhatsApp — mis en avant : c'est l'action de relance la plus
                fréquente sur une fiche en dette. */}
            <div className="grid grid-cols-2 gap-2 text-xs">
              <button
                onClick={() => actions.openWhatsApp(stu, "student")}
                disabled={!isSendablePhone(stu.phone)}
                title={
                  isSendablePhone(stu.phone)
                    ? "Envoyer un message WhatsApp à l'élève"
                    : "Aucun numéro exploitable pour cet élève"
                }
                className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/90 py-2 font-semibold hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp Élève
              </button>
              <button
                onClick={() => actions.openWhatsApp(stu, "parent")}
                disabled={!isSendablePhone(parent?.phone)}
                title={
                  !parent
                    ? "Aucun parent rattaché à cet élève"
                    : isSendablePhone(parent.phone)
                      ? `Envoyer un message WhatsApp à ${parent.firstName} ${parent.lastName}`
                      : "Le parent rattaché n'a pas de numéro exploitable"
                }
                className="flex items-center justify-center gap-1.5 rounded-xl bg-emerald-500/90 py-2 font-semibold hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <MessageCircle className="h-3.5 w-3.5" /> WhatsApp Parent
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <OverlayButton onClick={() => actions.openDetails(stu)} icon={<Eye className="h-3.5 w-3.5" />}>
                Voir Détails
              </OverlayButton>
              <OverlayButton onClick={() => actions.openAssign(stu)} icon={<BookOpen className="h-3.5 w-3.5" />}>
                Inscriptions
              </OverlayButton>
              <OverlayButton onClick={() => actions.openTopup(stu)} icon={<DollarSign className="h-3.5 w-3.5" />}>
                Charger Solde
              </OverlayButton>
              <OverlayButton onClick={() => actions.openPayDebt(stu)} icon={<DollarSign className="h-3.5 w-3.5" />}>
                Régler Dette
              </OverlayButton>
              <OverlayButton onClick={() => actions.printStudent(stu)} icon={<Printer className="h-3.5 w-3.5" />}>
                Imprimer Fiche
              </OverlayButton>
              <OverlayButton onClick={() => actions.openEdit(stu)} icon={<Edit className="h-3.5 w-3.5" />}>
                Modifier
              </OverlayButton>
              <OverlayButton
                onClick={() => actions.openPrintPayments(stu)}
                icon={<Printer className="h-3.5 w-3.5" />}
                className="col-span-2"
              >
                Imprimer Paiements (Période)
              </OverlayButton>
            </div>
            <button
              onClick={() => actions.deleteStudent(stu.id)}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-danger py-2 text-xs font-bold hover:bg-danger/80"
            >
              <Trash2 className="h-3.5 w-3.5" /> Supprimer l&apos;élève
            </button>
          </div>
        )}

        <div>
          <div className="flex items-start justify-between">
            <button
              type="button"
              onClick={() => actions.openDetails(stu)}
              title="Voir la fiche de l'élève"
              className="-m-0.5 flex items-center gap-2 rounded-xl p-0.5 text-start transition-colors hover:bg-primary-50/60"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                {stu.firstName.substring(0, 1)}
                {stu.lastName.substring(0, 1)}
              </div>
              <div>
                <h4 className="flex items-center gap-1.5 text-sm font-bold text-ink transition-colors hover:text-primary">
                  {stu.firstName} {stu.lastName}
                  {/* Alarme visible sans ouvrir la fiche : l'élève a suivi des
                      séances qu'il n'a pas payées. */}
                  {debt.sessions > 0 && (
                    <span
                      title={`Séances suivies non payées : ${debt.sessions} DA`}
                      className="flex items-center gap-0.5 rounded-md bg-danger px-1.5 py-0.5 text-[9px] font-bold text-white"
                    >
                      <AlertTriangle className="h-2.5 w-2.5" /> Dette {debt.sessions} DA
                    </span>
                  )}
                  {/* Le solde stocké et son propre historique ne disent pas la
                      même chose : une incohérence à réparer en base
                      (reconcile_student_balances), pas une dette de plus. */}
                  {debt.drift !== 0 && (
                    <span
                      title={`Le solde stocké s'écarte de ${Math.abs(debt.drift)} DA de la somme de son historique. À corriger en base — ce n'est pas un montant à encaisser.`}
                      className="flex items-center gap-0.5 rounded-md bg-warning px-1.5 py-0.5 text-[9px] font-bold text-white"
                    >
                      <AlertTriangle className="h-2.5 w-2.5" /> Solde à vérifier
                    </span>
                  )}
                  {/* Alarme visible sans ouvrir la fiche : l'inscription n'a
                      jamais été réglée. */}
                  {(stu.registrationDue ?? 0) > 0 && (
                    <span
                      role="button"
                      tabIndex={0}
                      title={`Frais d'inscription impayés : ${stu.registrationDue} DA — cliquez pour les régler`}
                      onClick={(e) => {
                        e.stopPropagation();
                        actions.openRegFee(stu);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          actions.openRegFee(stu);
                        }
                      }}
                      className="flex cursor-pointer items-center gap-0.5 rounded-md bg-danger px-1.5 py-0.5 text-[9px] font-bold text-white hover:bg-danger/80"
                    >
                      <AlertTriangle className="h-2.5 w-2.5" /> Inscription impayée
                    </span>
                  )}
                </h4>
                <span className="flex items-center gap-1 text-[10px] text-muted">
                  <CreditCard className="inline h-3 w-3" /> {stu.rfid}
                </span>
              </div>
            </button>

            <button
              onClick={() => actions.setOverlay(stu.id)}
              className="rounded-lg p-1 text-muted transition-colors hover:bg-primary-50 hover:text-ink"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
          </div>

          <div className="mt-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Téléphone:</span>
              <strong className="text-ink">{stu.phone}</strong>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Solde Actuel:</span>
              <strong className={debt.sessions > 0 ? "text-danger" : "text-success"}>{stu.balance} DA</strong>
            </div>

            {debt.sessions > 0 && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-danger/50 bg-danger/10 p-1.5">
                <span className="flex items-center gap-1 text-[10px] font-bold text-danger">
                  <AlertTriangle className="h-3 w-3 animate-pulse" />
                  SÉANCES NON PAYÉES : {debt.sessions} DA dus
                </span>
                <button
                  onClick={() => actions.openPayDebt(stu)}
                  className="shrink-0 rounded bg-danger px-2 py-0.5 text-[9px] font-bold text-white hover:bg-danger/80"
                >
                  Régler
                </button>
              </div>
            )}

            {/* Le solde stocké ne vaut pas la somme de son historique : un
                versement ne les réconcilierait pas, c'est
                reconcile_student_balances qu'il faut jouer. */}
            {debt.drift !== 0 && (
              <div className="flex items-center justify-between gap-2 rounded-lg border border-warning/50 bg-warning/10 p-1.5">
                <span className="flex items-center gap-1 text-[10px] font-bold text-warning">
                  <AlertTriangle className="h-3 w-3" />
                  SOLDE À VÉRIFIER : {Math.abs(debt.drift)} DA d&apos;écart avec l&apos;historique
                </span>
                <button
                  onClick={() => actions.openDetails(stu)}
                  title="Ouvrir la fiche : l'onglet Transactions détaille l'historique du solde"
                  className="shrink-0 rounded bg-warning px-2 py-0.5 text-[9px] font-bold text-white hover:bg-warning/80"
                >
                  Vérifier
                </button>
              </div>
            )}

            {/* L'alerte ENTIÈRE est le bouton : la réception clique là où elle lit
                le problème, et la fenêtre lui demande ensuite PAR QUELLE PORTE
                l'élève règle — sur son solde, ou séparément au guichet. */}
            {stu.registrationDue && stu.registrationDue > 0 ? (
              <button
                type="button"
                onClick={() => actions.openRegFee(stu)}
                title="Régler les frais d'inscription — sur le solde, ou encaissés à part"
                className="flex w-full items-center justify-between gap-2 rounded-lg border border-danger/50 bg-danger/10 p-1.5 text-start transition-colors hover:bg-danger/20"
              >
                <span className="flex items-center gap-1 text-[10px] font-bold text-danger">
                  <AlertTriangle className="h-3 w-3 animate-pulse" />
                  Frais d&apos;inscription NON PAYÉS : {stu.registrationDue} DA
                </span>
                <span className="shrink-0 rounded bg-danger px-2 py-0.5 text-[9px] font-bold text-white">
                  Régler
                </span>
              </button>
            ) : (
              <div className="flex justify-between rounded bg-success/15 px-2 py-0.5 text-[10px] text-success">
                <span>Frais d&apos;inscription</span>
                <strong>Payé ✔</strong>
              </div>
            )}
          </div>
        </div>

        <div className="mt-2 border-t border-line pt-2">
          <span className="mb-1 block text-[10px] text-muted">Modules/Abonnements:</span>
          {stu.subscriptionIds.length === 0 ? (
            <span className="text-[10px] italic text-muted">Non inscrit</span>
          ) : (
            <div className="flex max-h-12 flex-wrap gap-1 overflow-y-auto">
              {stu.subscriptionIds.map((id) => {
                const exp = stu.subscriptionDates?.[id]?.expiryDate;
                const days = exp ? daysUntil(exp) : null;
                const tone =
                  days === null
                    ? "neutral"
                    : days < 0
                      ? "danger"
                      : days <= EXPIRY_WARNING_DAYS
                        ? "warning"
                        : "neutral";
                return (
                  <Badge key={id} tone={tone} className="whitespace-normal px-1 py-0.5 text-[9px]">
                    {labelOf(id)}
                    {days !== null && days < 0 && " · Expirée"}
                    {days !== null && days >= 0 && days <= EXPIRY_WARNING_DAYS && ` · J-${days}`}
                  </Badge>
                );
              })}
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
});

function OverlayButton({
  onClick,
  icon,
  children,
  className = "",
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-xl bg-white/10 py-2 hover:bg-white/20 ${className}`}
    >
      {icon} {children}
    </button>
  );
}

/** Cartes affichées d'emblée, puis par tranches à mesure qu'on descend. */
const CARDS_PER_STEP = 60;

/**
 * La grille des cartes, affichée par tranches.
 *
 * Construire 400 cartes d'un coup prenait plusieurs centaines de millisecondes
 * à chaque ouverture de l'écran et à chaque changement de filtre. Les 60
 * premières s'affichent tout de suite ; les suivantes arrivent quand on
 * approche du bas de la liste (ou au clic sur « Afficher plus »).
 */
export function StudentCardGrid({
  students,
  debtOf,
  overlayStudentId,
  parentById,
  labelOf,
  actions,
  resetKey,
}: {
  students: Student[];
  debtOf: (stu: Student) => StudentDebt;
  overlayStudentId: string | null;
  parentById: Map<string, Parent>;
  labelOf: (subId: string) => string;
  actions: StudentCardActions;
  /** change quand la recherche ou le filtre change : on repart des 60 premières */
  resetKey: string;
}) {
  const [shown, setShown] = useState({ key: resetKey, count: CARDS_PER_STEP });
  const count = shown.key === resetKey ? shown.count : CARDS_PER_STEP;
  const visible = students.slice(0, count);
  const hasMore = students.length > count;

  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown({ key: resetKey, count: count + CARDS_PER_STEP });
        }
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, count, resetKey]);

  return (
    <>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((stu) => (
          <StudentCard
            key={stu.id}
            stu={stu}
            debt={debtOf(stu)}
            overlaid={overlayStudentId === stu.id}
            parent={stu.parentId ? parentById.get(stu.parentId) : undefined}
            labelOf={labelOf}
            actions={actions}
          />
        ))}
      </div>
      {students.length === 0 && (
        <div className="rounded-2xl border border-dashed border-line py-14 text-center">
          <p className="text-sm text-muted">Aucun élève ne correspond à cette recherche.</p>
        </div>
      )}
      {hasMore && (
        <div ref={sentinel} className="mt-6 flex flex-col items-center gap-2">
          <span className="text-xs text-muted">
            {count} élève(s) affiché(s) sur {students.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShown({ key: resetKey, count: count + CARDS_PER_STEP })}
          >
            Afficher plus
          </Button>
        </div>
      )}
    </>
  );
}
