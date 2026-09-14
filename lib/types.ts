import type { Role } from "@/lib/store/session";

export type { Role };

/**
 * Quand la feuille de pointage d'une séance s'ouvre (écran Présence) :
 *  - "lead"   : toute seule, N minutes avant l'heure de début de la séance ;
 *  - "fixed"  : toute seule, à partir d'une heure fixe de la journée ;
 *  - "manual" : seulement quand la réception clique « Démarrer le pointage ».
 * Tant qu'elle n'est pas ouverte, les boutons Présent / Retard / Absent sont
 * verrouillés : personne ne peut pointer une séance par avance.
 */
export type AttendanceOpenMode = "lead" | "fixed" | "manual";

export type Day =
  | "sunday"
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday"
  | "saturday";

export const DAYS: Day[] = [
  "saturday",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
];

export interface School {
  id: string;
  name: string;
  description: string;
  phone: string;
  email: string;
  logo?: string;
  address: string;
  articleFiscal?: string;
  registreCommerce?: string;
  nif?: string;
  nis?: string;
  /** one-time registration fee charged once per student on first enrollment */
  registrationFee?: number;
  /** how that first tariff is called at the desk ("Inscription 1" by default) */
  registrationFeeLabel?: string;
  /** a SECOND registration tariff: schools that charge two kinds of inscription
   *  (annuelle / semestrielle, interne / externe…) pick one of the two when the
   *  student is created */
  registrationFee2?: number;
  registrationFee2Label?: string;
  /** master switch for the automatic weekly-absence billing */
  absencePenaltyEnabled?: boolean;
  /** floor date (YYYY-MM-DD): absences are only billed for weeks ending on/after
   *  this day, so enabling the feature never retro-bills old history */
  absencePenaltySince?: string;
  /** weekday the absence week opens on (0 = sunday … 5 = friday, the default):
   *  a week runs from that day to the same day of the next week */
  absenceWeekStartDay?: number;
}

/** Which of the school's two registration tariffs a student is charged.
 *  "none" = this student pays no inscription at all. */
export type RegistrationFeeKey = "fee1" | "fee2";

export type ClassType = "cours" | "formation";
export type CoursLevel = "primaire" | "moyen" | "lycee";
export type FormationLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

export interface SchoolClass {
  id: string;
  type: ClassType;
  name: string;
  description: string;
  // cours
  coursLevel?: CoursLevel;
  year?: string;
  filiereId?: string;
  // formation
  formationLevel?: FormationLevel;
}

export interface Filiere {
  id: string;
  name: string;
}
export interface Module {
  id: string;
  name: string;
}
export interface Group {
  id: string;
  name: string;
}
export interface Salle {
  id: string;
  name: string;
}

export type TeacherPaymentType = "monthly" | "percentage";
export interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  paymentType: TeacherPaymentType;
  monthlyAmount?: number;
  startDate?: string;
  percentage?: number;
  /** "enseignant passager": intervenant sans compte de connexion, réglé
   *  créneau par créneau depuis la fiche enseignant */
  isPassager?: boolean;
  /** de quoi se rappeler qui est ce passager (spécialité, provenance,
   *  disponibilités) — sans ce champ, tout finissait dans le nom */
  description?: string;
}

/** One settlement written for a teacher (fixed amount or percentage-based). */
export interface TeacherPayment {
  id: string;
  teacherId: string;
  amount: number;
  method: "fixed" | "percent";
  percentage?: number;
  studentsCount: number;
  sessionsCount: number;
  description: string;
  /** frozen snapshot of the settled timings, so the receipt can be reprinted */
  details: TeacherPaymentDetail[];
  paidAt: string;
  /** the caisse movement written with this settlement — editing or cancelling
   *  the règlement moves/removes that exact line instead of guessing */
  cashTxId?: string;
}

export interface TeacherPaymentDetail {
  dateKey: string;
  sessionId: string;
  title: string;
  moduleName: string;
  groupName: string;
  startTime: string;
  endTime: string;
  presents: number;
  passagers: number;
  gross: number;
  share: number;
  /** Prix d'UNE séance du créneau, tel qu'il a servi au calcul. Le bon de
   *  paiement en tableau (Niveau × dates) le réimprime à l'identique : sans
   *  lui, la colonne « Montant calculé » ne s'expliquerait plus six mois
   *  après. Absent des règlements écrits avant le tableau. */
  unitPrice?: number;
  /** Pourcentage appliqué à CE créneau — celui de l'enseignant en général, ou
   *  celui posé sur la séance libre quand elle porte le sien. */
  percentage?: number;
  /** Classe / niveau du créneau, colonne « Niveau » du tableau. */
  className?: string;
  /** La ligne vient-elle d'un cours de l'emploi du temps ou d'une séance libre
   *  à pourcentage dédié ? La seconde se calcule à part et s'affiche dans sa
   *  propre colonne. */
  kind?: "cours" | "libre";
  /** Part due au titre des séances libres à pourcentage dédié tenues ce
   *  jour-là sur ce créneau (0 quand il n'y en a aucune). */
  freeShare?: number;
  /** Nombre de ces séances libres à pourcentage dédié. */
  freeCount?: number;
  /** Les séances libres (independent_sessions.id) que ce règlement solde sur
   *  cette ligne : c'est par elles que l'annulation les rend à nouveau dues. */
  independentIds?: string[];
}

export type ReceptionPaymentType = "daily" | "monthly" | "half_day" | "hourly";
/** Réception / Agent de sécurité / Ménage — Ménage never gets a login. */
export type WorkerRole = "reception" | "security" | "menage";
export interface ReceptionStaff {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  paymentType: ReceptionPaymentType;
  startDate: string;
  salary: number;
  role?: WorkerRole;
  /** badge used by the worker check-in scanner */
  rfid?: string;
  /** paymentType === "hourly": price of one worked hour */
  hourlyRate?: number;
  /** the days this worker is expected — an absence is only ever counted on
   *  one of them, so a Friday off never turns into an unjustified absence */
  workDays?: Day[];
  /** expected clock-in / clock-out ("HH:mm"), used to flag a late arrival */
  dailyStart?: string;
  dailyEnd?: string;
  /** poste / fonction précise ("Agent d'accueil du soir"…) */
  jobTitle?: string;
  /** how many days before the due date the payment alert starts */
  payAlertDays?: number;
  /**
   * « Payé à partir du » (YYYY-MM-DD) — travailleurs au MOIS.
   *
   * Un salaire mensuel se compte depuis le jour où l'employé commence à être
   * payé, pas depuis le 1er du mois : embauché le 10 septembre, il est payé le
   * 10 octobre. Sans cette date, l'écran découpait la paie en mois civils et
   * annonçait le salaire dû le 30 septembre — dix jours avant qu'il soit gagné,
   * puis « en retard » pendant ces dix jours-là.
   *
   * Absente : on retombe sur `startDate` (la date d'embauche), qui est ce que
   * la réception avait toujours saisi.
   */
  payStartDate?: string;
}

/** How a worked day got into the register. */
export type WorkerShiftSource = "scan" | "manual" | "auto";
/** Présent (pointé ou saisi) ou absent (constaté, ou relevé automatiquement). */
export type WorkerShiftStatus = "present" | "absent";

/** One day of a worker: badge swipes, manual entry, or an absence. */
export interface WorkerShift {
  id: string;
  workerId: string;
  workDate: string; // YYYY-MM-DD
  startAt?: string;
  endAt?: string;
  minutes: number;
  /** the day ended without a clock-out: hours frozen until reception fixes it */
  frozen: boolean;
  paid: boolean;
  paymentId?: string;
  createdAt: string;
  /** présent ou absent — une absence n'a ni arrivée ni sortie */
  status?: WorkerShiftStatus;
  /** badge, saisie manuelle de la réception, ou relevé automatique du soir */
  source?: WorkerShiftSource;
  /** motif d'une absence, correction d'un pointage… */
  notes?: string;
  /**
   * ABSENCE : la retenue a-t-elle été tranchée ?
   *
   * Une absence constatée ne dit pas encore ce qu'elle coûte : la direction
   * peut retenir une journée, une partie, ou rien du tout (un arrêt justifié).
   * Tant que personne n'a tranché, l'absence reste EN ATTENTE — elle s'affiche
   * en alerte sur l'écran Travailleurs et sur le tableau de bord, et le
   * règlement de la période la fait trancher avant de se conclure.
   *
   * Tranchée à 0 DA est une décision comme une autre : `absenceResolved` vaut
   * alors `true` et `absenceCost` 0. C'est ce qui distingue « on a décidé de ne
   * rien retenir » de « personne n'a encore regardé ».
   */
  absenceResolved?: boolean;
  /** ce que l'absence retient sur la paie (0 = aucune retenue) */
  absenceCost?: number;
  /** la retenue écrite dans `teacher_absences` pour cette absence */
  absenceId?: string;
}

/** One settlement written for a worker — the register the old screen lacked.
 *  Without it, "is this month paid?" was answered by searching the cashier's
 *  free-text descriptions, which a renamed worker or a typo silently broke. */
export interface WorkerPayment {
  id: string;
  workerId: string;
  amount: number;
  /** the contract the settlement was computed on */
  method: ReceptionPaymentType;
  periodStart?: string;
  periodEnd?: string;
  /** "09/2026" for a month, "2026-09-12" for a day — what makes it unique */
  periodKey: string;
  daysCount: number;
  minutes: number;
  description: string;
  /** frozen snapshot of the settled days, so the receipt can be reprinted */
  details: WorkerPaymentDetail[];
  paidAt: string;
  cashTxId?: string;
}

export interface WorkerPaymentDetail {
  workDate: string;
  startAt?: string;
  endAt?: string;
  minutes: number;
  status: WorkerShiftStatus;
  source: WorkerShiftSource;
  amount: number;
}

/**
 * Qui peut assister à une séance libre :
 *   · "enrolled" — seuls les élèves dont l'emploi du temps passe par les
 *     classes ET les groupes cochés à la création du créneau ;
 *   · "filiere"  — tout élève d'une classe de la même filière, même s'il suit
 *     un autre groupe ou un autre créneau.
 * La règle est appliquée par lib/seanceAudience.ts.
 */
export type SeanceAudience = "enrolled" | "filiere";

export interface ScheduleSession {
  id: string;
  classId: string;
  moduleId: string;
  groupId: string;
  salleId: string;
  teacherId: string;
  days: Day[];
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  /** "séance libre" timing: several classes/groups/salles over a date period */
  isOpen?: boolean;
  /** explicit, readable name — only set for séance libre timings */
  title?: string;
  periodStart?: string;
  periodEnd?: string;
  classIds?: string[];
  groupIds?: string[];
  salleIds?: string[];
  /** price of one séance libre (mirrored into the auto-created subscription) */
  openPrice?: number;
  /**
   * "Séance libre offerte": the whole créneau is free. Every présence recorded
   * on it is offered — the student's balance is never debited, the school cashes
   * nothing, and the teacher earns no share. What each séance WOULD have cost
   * (`openPrice`) is what the reports price as the value the school gave away.
   * Only meaningful when `isOpen` is true.
   */
  isFree?: boolean;
  /**
   * « Première séance officielle » du créneau (YYYY-MM-DD), facultative.
   *
   * Un emploi du temps se crée souvent AVANT que l'année commence : les
   * quelques séances d'essai tenues d'ici là étaient pourtant facturées comme
   * les autres, et les absences comptées. Quand cette date est posée, tout ce
   * qui se passe AVANT elle est enregistré exactement pareil — la présence est
   * écrite, l'élève apparaît dans la salle — mais RIEN n'est débité du solde et
   * aucune absence n'est facturée. Le prix non facturé part dans
   * `AttendanceRecord.waivedAmount`, comme pour toute autre gratuité.
   *
   * Absente = le créneau facture dès sa première séance, comme avant.
   */
  billingStartDate?: string;
  /**
   * Public du créneau : qui la réception peut encaisser dessus. Absent sur les
   * créneaux créés avant le réglage — aucune restriction n'est alors appliquée,
   * le guichet accepte n'importe quel élève comme il l'a toujours fait. Les
   * passagers, eux, ne sont jamais concernés : ils n'ont ni classe ni filière.
   * Only meaningful when `isOpen` is true.
   */
  openAudience?: SeanceAudience;
}

export interface Subscription {
  id: string;
  /** the schedule this subscription is priced against */
  sessionId: string;
  pricePerSession: number;
  /** formation classes: fixed price for the whole level (pricePerSession stays 0) */
  levelPrice?: number;
  /** formation classes: duration in months, drives the per-student expiry date */
  periodMonths?: number;
}

/**
 * Per-student enrollment dates (YYYY-MM-DD), kept for EVERY enrollment —
 * cours and formations alike:
 *  - `subscribedAt`: the day reception registered the student on that module
 *    (purely informative, it never drives a price),
 *  - `startDate`: the day billing starts. A séance attended BEFORE it is
 *    recorded as usual but never charged (see `AttendanceRecord.preStart`),
 *  - `expiryDate`: end of the enrollment — only formations get one, derived
 *    from the level's duration. Past it, the card is refused.
 */
export interface SubscriptionDates {
  subscribedAt?: string;
  startDate?: string;
  expiryDate?: string;
}

/** Reduction granted to ONE student on ONE module, applied by every price
 *  calculation (scan, manual présence, weekly absence billing). */
export type DiscountType = "percent" | "amount";
export interface SubscriptionDiscount {
  type: DiscountType;
  value: number;
}

/**
 * "Période gratuite": a date window during which attending is offered. The card
 * is scanned and the presence is written exactly as usual, but the séance price
 * is NEVER taken off the student's balance — it is stored on the presence
 * (`waivedAmount`) so the school can see what the period cost it.
 */
export interface FreePeriod {
  id: string;
  /** short label shown on the card, e.g. "Semaine portes ouvertes" */
  name: string;
  description: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  /** covers every class (the default); otherwise only `classIds` */
  allClasses: boolean;
  classIds: string[];
  /** teachers still earn their percentage on an offered séance */
  payTeachers: boolean;
  /** suspends the period without losing its history */
  active: boolean;
  createdAt?: string;
}

/** Server-side totals of one free period (never truncated by a row limit). */
export interface FreePeriodStat {
  id: string;
  /** presences recorded during the period */
  presences: number;
  /** distinct students who benefited from it */
  students: number;
  /** what those presences would have cost the students = cost of the period */
  waived: number;
}

/** Weekly-absence billing switch for a single module. */
export interface ModuleAbsenceRule {
  moduleId: string;
  enabled: boolean;
  /** length of the absence window in days (7 = the default weekly rule) */
  daysWindow: number;
}

export interface Student {
  id: string;
  firstName: string;
  lastName: string;
  birthDate: string;
  phone: string;
  email: string;
  rfid: string;
  balance: number;
  isFree: boolean;
  parentId?: string;
  subscriptionIds: string[];
  /** formation enrollments: start/expiry per subscription id */
  subscriptionDates?: Record<string, SubscriptionDates>;
  /** per-module reduction, keyed by subscription id */
  subscriptionDiscounts?: Record<string, SubscriptionDiscount>;
  /** outstanding one-time registration cost not yet settled */
  registrationDue?: number;
  /** horodatage d'inscription (ISO), tel que la base l'a écrit. Sert à ranger
   *  la liste du plus récent au plus ancien ; absent sur une base qui n'a pas
   *  encore la colonne `created_at`. */
  createdAt?: string;
}

/** Portal password kept so the payment receipt can print the student's login.
 *  Stored in a staff-only table — never readable by the student/parent. */
export interface StudentCredential {
  studentId: string;
  password: string;
  updatedAt: string;
}

export type BalanceTxType =
  | "topup"
  | "deduction"
  | "debt_payment"
  | "registration";
export interface BalanceTransaction {
  id: string;
  studentId: string;
  amount: number; // signed: + topup, - deduction
  date: string;
  type: BalanceTxType;
  description: string;
  /** module of the séance behind a deduction/refund — used by the per-module
   *  transactions filter in the student file (null for plain topups) */
  moduleId?: string;
  /** the account that recorded this movement (profiles.id) */
  createdBy?: string;
}

/** One automatic weekly-absence charge: a module the student was absent on for
 *  a full 7-day window, billed at that module's séance price. Also mirrored as a
 *  `deduction` BalanceTransaction so it shows in every transaction list. */
export interface AbsencePenalty {
  id: string;
  studentId: string;
  subscriptionId?: string;
  sessionId?: string;
  moduleId?: string;
  /** first/last day of the absent 7-day window (YYYY-MM-DD) */
  periodStart: string;
  periodEnd: string;
  /** amount deducted (> 0) */
  amount: number;
  /** resulting balance (may be negative = debt) */
  balanceAfter: number;
  createdAt: string;
}

export type AttendanceStatus = "present" | "late" | "absent";
export interface AttendanceRecord {
  id: string;
  studentId: string;
  sessionId: string;
  timestamp: string;
  amountDeducted: number;
  status: AttendanceStatus;
  /** the student attended ANOTHER group of the same course (same class + module)
   *  than the one he is enrolled in — a "rattrapage" */
  substituteGroup?: boolean;
  /** the séance was offered by this free period (nothing was deducted) */
  freePeriodId?: string;
  /** the séance happened BEFORE the enrollment's start date: presence kept,
   *  balance untouched (the price sits in `waivedAmount`) */
  preStart?: boolean;
  /** the price that was NOT charged (free period or pre-start séance) — 0 on
   *  every ordinary presence */
  waivedAmount?: number;
}

export interface UnpaidTeacherSession {
  id: string;
  teacherId: string;
  sessionId: string;
  studentId: string;
  amount: number;
  date: string;
  paid: boolean;
}

export interface TeacherAcompte {
  id: string;
  teacherId: string;
  amount: number;
  description: string;
  date: string;
  /** the settlement that consumed this advance. An acompte is never destroyed
   *  when the teacher is paid — it is attached to the règlement, so cancelling
   *  that règlement makes it payable again. `undefined` = still outstanding. */
  paymentId?: string;
}
export interface TeacherAbsence {
  id: string;
  teacherId: string;
  cost: number;
  description: string;
  date: string;
  /** the settlement that consumed this deduction (see TeacherAcompte) */
  paymentId?: string;
}

export interface Subject {
  id: string;
  title: string;
  description: string;
  image?: string;
  sessionId: string;
  date: string;
}

export type Audience = "students" | "teachers" | "parents" | "all";
export interface Announcement {
  id: string;
  title: string;
  description: string;
  audience: Audience;
  endDate: string;
  date: string;
  /** empty = whole school; otherwise only these groups (and, when
   *  includeParents is on, the parents of their students) */
  targetGroupIds?: string[];
  includeParents?: boolean;
}

export interface ExpenseCategory {
  id: string;
  name: string;
}
export interface Expense {
  id: string;
  name: string;
  categoryId: string;
  amount: number;
  date: string;
}

export type CashTxType =
  | "deposit"
  | "withdraw"
  | "expense"
  | "student_payment"
  | "teacher_payment"
  | "acompte";
export interface CashTransaction {
  id: string;
  type: CashTxType;
  amount: number; // signed
  date: string;
  description: string;
  /** the account that wrote this movement (profiles.id). Absent on every line
   *  written before the caisse started recording it. */
  createdBy?: string;
}

/** Un compte de l'application, tel que la caisse le nomme. */
export interface Profile {
  id: string;
  role: Role;
  fullName: string;
  email?: string;
  phone?: string;
}

export interface Parent {
  id: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  childIds: string[];
}

export interface Notification {
  id: string;
  parentId: string;
  title: string;
  description: string;
  date: string;
  read: boolean;
  auto: boolean;
}

export type CourseworkType = "single" | "period";
export interface Coursework {
  id: string;
  name: string;
  type: CourseworkType;
  dates: string[];
  pricePerSession: number;
  total: number;
  teacherId: string;
}

export interface IndependentSession {
  id: string;
  studentId?: string;
  passagerName?: string;
  itemLabel: string;
  price: number;
  date: string;
  /** séance libre timing this attendance belongs to (drives the teacher payout) */
  sessionId?: string;
  startTime?: string;
  endTime?: string;
  createdAt?: string;
  /** the teacher has already been settled for this passager's séance — a
   *  créneau attended only by passagers has no unpaid_teacher_sessions row */
  teacherPaid?: boolean;
  /**
   * "Séance offerte": the séance is held and recorded exactly as usual, but
   * NOBODY is paid on it — nothing is cashed by the school, nothing is taken
   * off a registered student's balance, and the teacher earns no share for it.
   * `price` is therefore 0; what the séance WOULD have cost sits in
   * `waivedAmount` so the reports can price what the school offered.
   */
  isFree?: boolean;
  /** tariff that was NOT charged (0 on every ordinary séance libre) */
  waivedAmount?: number;

  // ---- Ce que le guichet a noté du passager -------------------------------
  /** téléphone du passager (l'élève inscrit a le sien sur sa fiche) */
  passagerPhone?: string;
  /** scolarité déclarée : elle sert à proposer les bons créneaux du jour, et
   *  reste sur la séance pour que le bon imprimé dise de qui il s'agit */
  classId?: string;
  year?: string;
  filiereId?: string;
  /** module choisi au guichet (facultatif : sans lui, tous les créneaux du
   *  jour sont proposés) */
  moduleId?: string;

  /**
   * « Part de l'enseignant sur CETTE séance libre », en pourcentage.
   *
   * Absent (le cas courant) : la séance rejoint les autres présences du
   * créneau et l'enseignant en touche son pourcentage habituel, comme s'il
   * s'agissait d'un élève inscrit de plus.
   *
   * Posé ici : la séance sort du lot. Elle se calcule à son propre taux et
   * s'affiche dans une colonne à part de l'écran de règlement — celle qui
   * n'apparaît QUE s'il reste de telles séances à payer.
   */
  teacherPercentage?: number;
  /** part figée à la création, quand `teacherPercentage` est posé */
  teacherAmount?: number;
  /** le compte qui a encaissé la séance (profiles.id) */
  createdBy?: string;
}

// =============================================================================
// Séances particulières ("Particulier")
// =============================================================================
// Un cours particulier n'est ni un créneau de l'emploi du temps ni une séance
// libre : il n'a ni jour de la semaine ni abonnement. C'est un rendez-vous —
// un élève (inscrit à l'école, ou simplement nommé au guichet), une date, et un
// ou plusieurs modules facturés à l'heure, chacun avec son enseignant et le
// pourcentage qui lui revient. L'argent n'y passe donc pas par le solde de
// l'élève : ce qu'il verse entre en caisse, ce qu'il ne verse pas reste une
// dette attachée à CETTE séance.

/**
 * Où en est le rendez-vous.
 *
 * « requested » est l'état qui manquait : la demande est prise — on sait qui,
 * quand il a demandé, qui l'a reçu, ce qu'il veut — mais RIEN n'est encore
 * programmé. C'est le moment où une demande se perd, et c'est donc une alerte
 * tant qu'elle dure.
 */
export type PrivateSessionStatus = "requested" | "planned" | "done" | "cancelled";

export interface PrivateSession {
  id: string;
  /** élève déjà inscrit à l'école — absent pour un élève de passage */
  studentId?: string;
  /** élève de passage : ce que le guichet a noté de lui */
  guestName?: string;
  guestPhone?: string;
  guestPhone2?: string;
  /** scolarité déclarée (facultative pour un élève de passage) */
  classId?: string;
  year?: string;
  filiereId?: string;
  /** date ET heure du rendez-vous — absente tant que la demande n'est pas
   *  programmée (statut « requested ») */
  scheduledAt?: string;
  /** somme des durées des modules, en minutes */
  durationMinutes: number;
  /** ce que la séance coûte à la famille, tous modules confondus */
  totalPrice: number;
  /** ce qui a réellement été encaissé — le reste est une dette */
  paidAmount: number;
  status: PrivateSessionStatus;
  notes?: string;
  createdAt?: string;
  createdBy?: string;

  // ---- ÉTAPE 1 : le dossier de demande (« renseignement ») ----------------
  /** le jour où la famille a demandé le cours */
  requestDate?: string;
  /** le compte qui a reçu la demande — celui qui saisit par défaut ; un
   *  administrateur peut désigner un autre travailleur */
  receptionistId?: string;
  /** son nom en clair, pour que la facture reste lisible quand le compte
   *  disparaît */
  receptionistName?: string;
  /** ce que le guichet a noté de la demande */
  observation?: string;
  /** versement pris À LA DEMANDE, avant toute programmation. Il entre en
   *  caisse tout de suite : c'est de l'argent reçu. */
  depositAmount?: number;

  // ---- ÉTAPE 3 : la répartition décidée à la conclusion -------------------
  /** part de l'école, en pourcentage (le complément de celle du prof) */
  schoolPercentage?: number;
  /** ce qui revient aux enseignants, en dinars */
  teacherShare?: number;
  /** ce qui reste à l'école — le total MOINS la part des enseignants, jamais
   *  un second calcul de pourcentage : deux arrondis séparés finissaient par
   *  ne plus faire le total */
  schoolShare?: number;
  completedAt?: string;
}

/**
 * Un élève d'une séance particulière.
 *
 * Deux cousins qui prennent le même cours particulier sont UNE séance et DEUX
 * élèves. Les entasser dans `guestName` rendait impossible de dire qui avait
 * payé quoi — et c'est précisément ce que la conclusion de la séance doit
 * répartir.
 */
export interface PrivateSessionStudent {
  id: string;
  privateSessionId: string;
  /** élève déjà inscrit à l'école — absent pour un élève de passage */
  studentId?: string;
  guestName?: string;
  guestPhone?: string;
  /** scolarité déclarée (facultative) */
  classId?: string;
  year?: string;
  filiereId?: string;
  /** ce que CET élève doit, et ce qu'il a versé */
  totalPrice: number;
  paidAmount: number;
  createdAt?: string;
}

/** Un module d'une séance particulière : sa durée, son tarif horaire, et
 *  l'enseignant qui l'assure avec le pourcentage qui lui revient. */
export interface PrivateSessionModule {
  id: string;
  privateSessionId: string;
  moduleId: string;
  /** enseignant de l'école OU enseignant passager créé pour l'occasion */
  teacherId?: string;
  minutes: number;
  /** prix d'UNE heure de ce module */
  hourlyPrice: number;
  /** minutes × tarif horaire, arrondi */
  totalPrice: number;
  teacherPercentage: number;
  /** part de l'enseignant, figée à la création */
  teacherAmount: number;
  teacherPaid: boolean;
  teacherPaidAt?: string;

  /** Le module se tient à SON heure : deux matières le même jour, à deux
   *  heures différentes, sont deux lignes et non une moyenne. */
  scheduledAt?: string;
  /**
   * Prix forfaitaire du module.
   *
   * > 0 : c'est LUI le prix, et la durée n'est plus qu'une information. 0 : on
   * garde le calcul minutes × tarif horaire. Le guichet annonce souvent un
   * prix rond (« la séance, 2 500 ») que le calcul horaire ne sait pas
   * reproduire exactement.
   */
  flatPrice?: number;
  /** enseignant qui n'est pas (encore) dans la base : un nom, un téléphone */
  teacherName?: string;
  teacherPhone?: string;
}
