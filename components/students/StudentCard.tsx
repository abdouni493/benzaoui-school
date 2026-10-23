"use client";

import { memo, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  BookOpen,
  CreditCard,
  DollarSign,
  Edit,
  Eye,
  Gift,
  MessageCircle,
  MoreVertical,
  Phone,
  Printer,
  Scale,
  Trash2,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { Card } from "@/components/ui/Card";
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
  /** « Régulariser la situation » : tout l'argent de l'élève, corrigeable */
  openRepair: (stu: Student) => void;
  printStudent: (stu: Student) => void;
  openEdit: (stu: Student) => void;
  openPrintPayments: (stu: Student) => void;
  deleteStudent: (id: string) => void;
  openRegFee: (stu: Student) => void;
  setOverlay: (id: string | null) => void;
}

/**
 * L'état d'une fiche, d'un coup d'œil : une couleur, un mot.
 *
 * Les couleurs sont fixées ici (et non tirées des jetons du thème) parce que
 * le thème sombre assombrit `--success` / `--warning` jusqu'à les rendre
 * illisibles sur fond bordeaux : chaque ton a sa variante claire en sombre.
 */
const TONES = {
  danger: {
    bar: "from-rose-500 via-red-500 to-rose-700",
    text: "text-rose-600 dark:text-rose-300",
    pill: "bg-rose-500/15 text-rose-700 ring-rose-500/30 dark:text-rose-200",
    avatar: "from-rose-500 to-red-700",
    soft: "border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-200",
    button: "bg-rose-600 hover:bg-rose-500",
  },
  warning: {
    bar: "from-amber-400 via-orange-400 to-amber-600",
    text: "text-amber-600 dark:text-amber-300",
    pill: "bg-amber-500/15 text-amber-700 ring-amber-500/30 dark:text-amber-200",
    avatar: "from-amber-500 to-orange-600",
    soft: "border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-200",
    button: "bg-amber-600 hover:bg-amber-500",
  },
  success: {
    bar: "from-emerald-400 via-teal-400 to-emerald-600",
    text: "text-emerald-600 dark:text-emerald-300",
    pill: "bg-emerald-500/15 text-emerald-700 ring-emerald-500/30 dark:text-emerald-200",
    avatar: "from-emerald-500 to-teal-700",
    soft: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
    button: "bg-emerald-600 hover:bg-emerald-500",
  },
  free: {
    bar: "from-violet-400 via-fuchsia-400 to-violet-600",
    text: "text-violet-600 dark:text-violet-300",
    pill: "bg-violet-500/15 text-violet-700 ring-violet-500/30 dark:text-violet-200",
    avatar: "from-violet-500 to-fuchsia-700",
    soft: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-200",
    button: "bg-violet-600 hover:bg-violet-500",
  },
} as const;
type ToneKey = keyof typeof TONES;

const formatDA = (n: number) => `${n.toLocaleString("fr-FR")} DA`;

/** « science · D (3eme Année - lycee - scientifique) » → nom + précision. */
function splitLabel(label: string): { name: string; detail: string } {
  const m = label.match(/^(.*?)\s*\((.*)\)$/);
  return m ? { name: m[1], detail: m[2] } : { name: label, detail: "" };
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
  const registrationDue = stu.registrationDue ?? 0;
  const toneKey: ToneKey = debt.alert ? "danger" : debt.drift !== 0 ? "warning" : stu.isFree ? "free" : "success";
  const tone = TONES[toneKey];
  const status = {
    danger: { label: debt.sessions > 0 ? "En dette" : "À régler", icon: <AlertTriangle className="h-3 w-3" /> },
    warning: { label: "À vérifier", icon: <Scale className="h-3 w-3" /> },
    free: { label: "Gratuit", icon: <Gift className="h-3 w-3" /> },
    success: { label: "À jour", icon: <BadgeCheck className="h-3 w-3" /> },
  }[toneKey];

  // Deux inscriptions au même libellé (deux groupes d'un même cours) ne font
  // qu'une puce, comptée — au lieu de deux puces identiques.
  const chips = (() => {
    const map = new Map<string, { label: string; count: number; tone: "neutral" | "warning" | "danger"; suffix: string }>();
    for (const id of stu.subscriptionIds) {
      const exp = stu.subscriptionDates?.[id]?.expiryDate;
      const days = exp ? daysUntil(exp) : null;
      const chipTone = days === null ? "neutral" : days < 0 ? "danger" : days <= EXPIRY_WARNING_DAYS ? "warning" : "neutral";
      const suffix = days !== null && days < 0 ? " · Expirée" : days !== null && days <= EXPIRY_WARNING_DAYS ? ` · J-${days}` : "";
      const label = labelOf(id);
      const key = `${label}|${chipTone}|${suffix}`;
      const prev = map.get(key);
      if (prev) prev.count += 1;
      else map.set(key, { label, count: 1, tone: chipTone, suffix });
    }
    return [...map.values()];
  })();
  // La classe est presque toujours la même pour tous les modules d'un élève :
  // dite une fois dans l'en-tête, elle libère les puces pour les modules.
  const details = new Set(chips.map((c) => splitLabel(c.label).detail));
  const sharedDetail = details.size === 1 ? [...details][0] : "";

  return (
    <Card gradient className="group relative flex h-full flex-col overflow-hidden">
      {/* Le ton de la fiche, en une barre */}
      <div className={`h-1 w-full shrink-0 bg-gradient-to-r ${tone.bar}`} />

      {overlaid && <CardMenu stu={stu} parent={parent} actions={actions} />}

      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* ---- Identité ---------------------------------------------------- */}
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => actions.openDetails(stu)}
            title="Voir la fiche de l'élève"
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br ${tone.avatar} text-sm font-black uppercase text-white shadow-md ring-2 ring-white/10 transition-transform hover:scale-105`}
          >
            {stu.firstName.substring(0, 1)}
            {stu.lastName.substring(0, 1)}
          </button>
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => actions.openDetails(stu)}
              className="block w-full truncate text-start text-sm font-bold capitalize text-ink transition-colors hover:text-primary"
              title={`${stu.firstName} ${stu.lastName}`}
            >
              {stu.firstName} {stu.lastName}
            </button>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1 font-mono">
                <CreditCard className="h-3 w-3" /> {stu.rfid || "—"}
              </span>
              {stu.phone && (
                <span className="inline-flex items-center gap-1 font-mono">
                  <Phone className="h-3 w-3" /> {stu.phone}
                </span>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => actions.setOverlay(stu.id)}
            aria-label="Toutes les actions"
            title="Toutes les actions"
            className="-me-1.5 -mt-1 rounded-lg p-1.5 text-muted transition-colors hover:bg-primary-50 hover:text-ink"
          >
            <MoreVertical className="h-5 w-5" />
          </button>
        </div>

        {/* ---- Le solde ------------------------------------------------------ */}
        <div className="flex items-center justify-between gap-2 rounded-xl border border-line bg-surface/70 px-3 py-2.5">
          <div className="min-w-0">
            <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted">Solde actuel</span>
            <strong
              className={`block truncate font-mono text-xl font-black leading-tight ${
                stu.balance < 0 ? TONES.danger.text : stu.isFree ? TONES.free.text : TONES.success.text
              }`}
            >
              {formatDA(stu.balance)}
            </strong>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-bold ring-1 ${tone.pill}`}
          >
            {status.icon} {status.label}
          </span>
        </div>

        {/* ---- Ce qui demande une action ----------------------------------- */}
        <div className="space-y-1.5">
          {debt.sessions > 0 && (
            <AlertRow
              tone="danger"
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              text={`Séances non payées : ${formatDA(debt.sessions)}`}
              action="Régler"
              onClick={() => actions.openPayDebt(stu)}
            />
          )}
          {/* Le solde stocké ne vaut pas la somme de son historique : ce n'est
              pas une dette, c'est une écriture à réaligner. */}
          {debt.drift !== 0 && (
            <AlertRow
              tone="warning"
              icon={<Scale className="h-3.5 w-3.5" />}
              text={`Solde à vérifier : ${formatDA(Math.abs(debt.drift))} d'écart`}
              action="Corriger"
              title="Le solde ne vaut pas la somme de son historique — « Régulariser » l'aligne d'un clic"
              onClick={() => actions.openRepair(stu)}
            />
          )}
          {registrationDue > 0 ? (
            <AlertRow
              tone="danger"
              icon={<AlertTriangle className="h-3.5 w-3.5" />}
              text={`Inscription non payée : ${formatDA(registrationDue)}`}
              action="Régler"
              title="Régler les frais d'inscription — sur le solde, ou encaissés à part"
              onClick={() => actions.openRegFee(stu)}
            />
          ) : (
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold ${TONES.success.text}`}>
              <BadgeCheck className="h-3.5 w-3.5" /> Frais d&apos;inscription payés
            </span>
          )}
        </div>

        {/* ---- Inscriptions ----------------------------------------------- */}
        <div className="mt-auto border-t border-line pt-2.5">
          <span className="mb-1.5 flex min-w-0 items-center gap-1 text-[10px] text-muted">
            <BookOpen className="h-3 w-3 shrink-0" />
            <span className="shrink-0 font-semibold uppercase tracking-wider">
              Modules ({stu.subscriptionIds.length})
            </span>
            {sharedDetail && <span className="truncate normal-case opacity-80">· {sharedDetail}</span>}
          </span>
          {chips.length === 0 ? (
            <span className="text-[11px] italic text-muted">Non inscrit</span>
          ) : (
            <div className="flex max-h-[3.5rem] flex-wrap gap-1 overflow-y-auto">
              {chips.map((c) => {
                const { name, detail } = splitLabel(c.label);
                const chipClass =
                  c.tone === "danger"
                    ? TONES.danger.soft
                    : c.tone === "warning"
                      ? TONES.warning.soft
                      : "border-line bg-primary-50/50 text-ink";
                return (
                  <span
                    key={`${c.label}${c.suffix}`}
                    title={c.label}
                    className={`inline-flex max-w-full items-center gap-1 rounded-lg border px-1.5 py-0.5 text-[10px] ${chipClass}`}
                  >
                    <strong className="truncate font-bold capitalize">{name}</strong>
                    {detail && !sharedDetail && <span className="truncate opacity-70">{detail}</span>}
                    {c.count > 1 && <span className="rounded bg-primary/15 px-1 font-black text-primary">×{c.count}</span>}
                    {c.suffix && <span className="font-bold">{c.suffix}</span>}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ---- Les trois gestes du guichet ---------------------------------- */}
      <div className="grid shrink-0 grid-cols-3 divide-x divide-line border-t border-line bg-surface/40 rtl:divide-x-reverse">
        <FooterButton icon={<Eye className="h-3.5 w-3.5" />} label="Fiche" onClick={() => actions.openDetails(stu)} />
        <FooterButton icon={<Wallet className="h-3.5 w-3.5" />} label="Recharger" onClick={() => actions.openTopup(stu)} />
        <FooterButton
          icon={<Wrench className="h-3.5 w-3.5" />}
          label="Régulariser"
          onClick={() => actions.openRepair(stu)}
          highlight={debt.drift !== 0}
        />
      </div>
    </Card>
  );
});

function AlertRow({
  tone,
  icon,
  text,
  action,
  title,
  onClick,
}: {
  tone: "danger" | "warning";
  icon: React.ReactNode;
  text: string;
  action: string;
  title?: string;
  onClick: () => void;
}) {
  const t = TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2 py-1.5 text-start transition-colors hover:brightness-110 ${t.soft}`}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{text}</span>
      </span>
      <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold text-white ${t.button}`}>{action}</span>
    </button>
  );
}

function FooterButton({
  icon,
  label,
  onClick,
  highlight,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold transition-colors hover:bg-primary-50 hover:text-primary ${
        highlight ? TONES.warning.text : "text-muted"
      }`}
    >
      {icon} {label}
    </button>
  );
}

/** Le menu complet d'une carte, posé sur elle (bouton ⋮). */
function CardMenu({ stu, parent, actions }: { stu: Student; parent?: Parent; actions: StudentCardActions }) {
  return (
    <div className="absolute inset-0 z-20 flex flex-col overflow-y-auto bg-surface/95 p-3 backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between gap-2 border-b border-line pb-2">
        <span className="truncate text-sm font-bold capitalize text-ink">
          {stu.firstName} {stu.lastName}
        </span>
        <button
          type="button"
          onClick={() => actions.setOverlay(null)}
          aria-label="Fermer"
          className="rounded-lg p-1 text-muted hover:bg-primary-50 hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Relance WhatsApp — l'action la plus fréquente sur une fiche en dette. */}
      <div className="mb-2 grid grid-cols-2 gap-1.5">
        <MenuButton
          onClick={() => actions.openWhatsApp(stu, "student")}
          disabled={!isSendablePhone(stu.phone)}
          title={isSendablePhone(stu.phone) ? "Envoyer un message WhatsApp à l'élève" : "Aucun numéro exploitable pour cet élève"}
          icon={<MessageCircle className="h-3.5 w-3.5 text-emerald-500" />}
        >
          WhatsApp élève
        </MenuButton>
        <MenuButton
          onClick={() => actions.openWhatsApp(stu, "parent")}
          disabled={!isSendablePhone(parent?.phone)}
          title={
            !parent
              ? "Aucun parent rattaché à cet élève"
              : isSendablePhone(parent.phone)
                ? `Envoyer un message WhatsApp à ${parent.firstName} ${parent.lastName}`
                : "Le parent rattaché n'a pas de numéro exploitable"
          }
          icon={<MessageCircle className="h-3.5 w-3.5 text-emerald-500" />}
        >
          WhatsApp parent
        </MenuButton>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <MenuButton onClick={() => actions.openDetails(stu)} icon={<Eye className="h-3.5 w-3.5 text-primary" />}>
          Voir la fiche
        </MenuButton>
        <MenuButton onClick={() => actions.openRepair(stu)} icon={<Wrench className="h-3.5 w-3.5 text-amber-500" />}>
          Régulariser
        </MenuButton>
        <MenuButton onClick={() => actions.openTopup(stu)} icon={<Wallet className="h-3.5 w-3.5 text-emerald-500" />}>
          Charger le solde
        </MenuButton>
        <MenuButton onClick={() => actions.openPayDebt(stu)} icon={<DollarSign className="h-3.5 w-3.5 text-rose-500" />}>
          Régler la dette
        </MenuButton>
        <MenuButton onClick={() => actions.openAssign(stu)} icon={<BookOpen className="h-3.5 w-3.5 text-primary" />}>
          Inscriptions
        </MenuButton>
        <MenuButton onClick={() => actions.openEdit(stu)} icon={<Edit className="h-3.5 w-3.5 text-primary" />}>
          Modifier
        </MenuButton>
        <MenuButton onClick={() => actions.printStudent(stu)} icon={<Printer className="h-3.5 w-3.5 text-muted" />}>
          Imprimer la fiche
        </MenuButton>
        <MenuButton onClick={() => actions.openPrintPayments(stu)} icon={<Printer className="h-3.5 w-3.5 text-muted" />}>
          Paiements (période)
        </MenuButton>
      </div>

      <button
        type="button"
        onClick={() => actions.deleteStudent(stu.id)}
        className="mt-auto flex w-full items-center justify-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 py-2 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-500/20 dark:text-rose-300"
      >
        <Trash2 className="h-3.5 w-3.5" /> Supprimer l&apos;élève
      </button>
    </div>
  );
}

function MenuButton({
  onClick,
  icon,
  children,
  disabled,
  title,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex min-w-0 items-center gap-1.5 rounded-lg border border-line bg-canvas/60 px-2 py-1.5 text-start text-[11px] font-semibold text-ink transition-colors hover:border-primary/40 hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40"
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{children}</span>
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
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
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
