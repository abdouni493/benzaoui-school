/**
 * Qui a le droit d'assister à une séance libre.
 *
 * Un créneau est créé sur l'Emploi du Temps en cochant des classes, des
 * groupes, des salles et un enseignant. Une ligne de `classes` porte exactement
 * ce que la réception coche : le niveau (primaire/moyen/lycée), l'année et la
 * filière. Le public d'un créneau se lit donc sur la CLASSE, jamais sur le
 * groupe :
 *
 *   · "enrolled" — les classes cochées, ÉLARGIES à leurs jumelles. C'est le
 *     réglage courant, et il suffit à laisser badger toute la promotion ;
 *   · "filiere"  — en plus, toutes les années de la filière.
 *
 * CETTE NOTION DE PUBLIC NE VAUT QUE POUR LES SÉANCES LIBRES.
 *
 *   · SÉANCE LIBRE (`isOpen`) — les classes jumelles sont celles de même
 *     niveau et de MÊME ANNÉE, la filière ne compte pas. Une séance libre est
 *     ouverte à toute la promotion : deux élèves de 3AS, l'un en sciences
 *     l'autre en lettres, y badgent tous les deux.
 *   · COURS ORDINAIRE — AUCUN PUBLIC. Le créneau n'admet QUE ses propres
 *     inscrits : chacun sur son emploi du temps, et sur aucun autre — pas
 *     même un autre groupe du même cours, pas même une autre classe de sa
 *     propre année et de sa propre filière. C'est `studentSessionRank` qui le
 *     dit ici, et `student_session_rank` qui le dit côté base.
 *
 * "enrolled" est inclus dans "filiere" : élargir le public n'enlève jamais
 * personne. Un créneau de séance libre sans réglage explicite est traité comme
 * "enrolled" — le guichet et le badge doivent dire la même chose, et le badge
 * (`student_session_rank`) contrôle la classe sur les séances libres.
 *
 * Le GROUPE ne restreint plus rien. Il décrit le créneau ; il ne décidait de
 * personne d'utile, et fermait la porte à des élèves de la classe visée qui
 * suivaient un autre groupe — le motif exact du refus signalé au guichet.
 *
 * Les passagers ne sont pas concernés : ils n'ont ni classe ni filière, et la
 * séance libre existe précisément pour les encaisser. La règle ne porte donc
 * que sur les élèves inscrits.
 *
 * Miroir exact des fonctions SQL `class_peer_ids`, `session_audience_class_ids`
 * et `student_session_rank` : le guichet et le badge doivent rendre le même
 * verdict, sinon la même séance est acceptée d'un côté et refusée de l'autre.
 */

import type {
  SeanceAudience,
  ScheduleSession,
  SchoolClass,
  Student,
  Subscription,
} from "@/lib/types";

export interface AudienceCheckInput {
  /** le créneau visé (seul un `isOpen` est contrôlé) */
  session: ScheduleSession;
  student: Student;
  /** tous les emplois du temps, pour retrouver ceux que l'élève suit */
  sessions: ScheduleSession[];
  subscriptions: Subscription[];
  classes: SchoolClass[];
}

export interface AudienceVerdict {
  allowed: boolean;
  /** phrase affichée au guichet quand la présence est refusée */
  reason?: string;
}

/** Les classes visées par un créneau. La colonne simple porte le PREMIER choix
 *  (celui sur lequel le scan s'aligne), le tableau porte la sélection complète :
 *  une base pas encore migrée n'a que la première, il faut donc lire les deux. */
export function openSeanceClassIds(s: ScheduleSession): string[] {
  return [...new Set([s.classId, ...(s.classIds ?? [])].filter(Boolean))];
}

/** Idem pour les groupes. */
export function openSeanceGroupIds(s: ScheduleSession): string[] {
  return [...new Set([s.groupId, ...(s.groupIds ?? [])].filter(Boolean))];
}

/** Les emplois du temps que l'élève suit réellement (ses abonnements). */
export function enrolledSessionsOf(
  student: Student,
  sessions: ScheduleSession[],
  subscriptions: Subscription[],
): ScheduleSession[] {
  const sessionIds = new Set(
    subscriptions
      .filter((su) => student.subscriptionIds.includes(su.id))
      .map((su) => su.sessionId),
  );
  return sessions.filter((s) => sessionIds.has(s.id));
}

/** Les classes auxquelles l'élève est rattaché — celles des emplois du temps
 *  qu'il suit, faute d'une colonne « classe » sur sa fiche. */
export function studentClassIds(
  student: Student,
  sessions: ScheduleSession[],
  subscriptions: Subscription[],
): string[] {
  return [
    ...new Set(enrolledSessionsOf(student, sessions, subscriptions).map((s) => s.classId)),
  ];
}

/** Une année comparable : « 3 », « 3 » et «  3  » désignent la même promotion. */
const yearKey = (c?: SchoolClass) => (c?.year ?? "").trim();

/** Ces deux classes désignent-elles la même population d'élèves ?
 *
 *  `ignoreFiliere` est le réglage des SÉANCES LIBRES : elles réunissent toute
 *  une promotion (même niveau, même année), sciences et lettres confondues. Un
 *  cours ordinaire, lui, garde la filière — sinon un 3AS lettres badgerait sur
 *  le cours de physique des 3AS sciences. */
function isPeerClass(a: SchoolClass, b: SchoolClass, ignoreFiliere = false): boolean {
  if (a.id === b.id) return true;
  if (a.type !== b.type) return false;
  // Une formation n'a ni année ni filière : elle se rapproche par son niveau,
  // jamais par « pas de filière », qui les réunirait toutes.
  if (a.type === "formation") return a.formationLevel === b.formationLevel;
  return (
    a.coursLevel === b.coursLevel &&
    yearKey(a) === yearKey(b) &&
    (ignoreFiliere || (a.filiereId ?? null) === (b.filiereId ?? null))
  );
}

/** Les classes qui désignent la même population que celles citées. */
export function classPeerIds(
  classIds: string[],
  classes: SchoolClass[],
  ignoreFiliere = false,
): string[] {
  const picked = classes.filter((c) => classIds.includes(c.id));
  return classes
    .filter((c) => picked.some((p) => isPeerClass(c, p, ignoreFiliere)))
    .map((c) => c.id);
}

/** Les classes admises sur un créneau, réglage de public compris.
 *
 *  N'a de sens que pour une SÉANCE LIBRE : un cours ordinaire n'admet plus
 *  personne par sa classe. La fonction reste définie pour tout créneau — les
 *  écrans s'en servent pour AFFICHER qui un emploi du temps concerne —, mais
 *  seul `studentSessionRank` décide qui entre. */
export function sessionAudienceClassIds(
  session: ScheduleSession,
  classes: SchoolClass[],
): string[] {
  const pickedIds = openSeanceClassIds(session);
  // Séance libre : la promotion entière (niveau + année). Cours ordinaire : le
  // triplet complet, filière comprise.
  const peers = classPeerIds(pickedIds, classes, !!session.isOpen);
  if (session.openAudience !== "filiere") return peers;

  // Toute la filière : l'année ne compte plus. Les jumelles restent du lot —
  // élargir le public ne doit jamais en retirer.
  const picked = classes.filter((c) => pickedIds.includes(c.id));
  const filiereIds = new Set(picked.map((c) => c.filiereId).filter(Boolean));
  return [
    ...new Set([
      ...peers,
      ...classes.filter((c) => c.filiereId && filiereIds.has(c.filiereId)).map((c) => c.id),
    ]),
  ];
}

/** Le rang d'un élève sur un créneau — miroir exact de la fonction SQL
 *  `student_session_rank`, qui est LA porte : `scan_card` la consulte pour
 *  accepter la carte, `mark_attendance` pour accepter une présence saisie à la
 *  main.
 *
 *    0 — inscrit sur CE créneau ;
 *    1 — inscrit au même cours dans un autre groupe (rattrapage) ;
 *    2 — rattaché à une classe du public du créneau ;
 *    undefined — rien à faire là.
 *
 *  UN COURS ORDINAIRE S'ARRÊTE AU RANG 0 : chacun sur son emploi du temps, et
 *  sur aucun autre — pas même celui de sa classe, de son année et de sa
 *  filière. Les rangs 1 et 2 n'existent plus que sur une SÉANCE LIBRE, où ils
 *  gardent exactement le sens qu'ils avaient.
 *
 *  Une seule chose échappe à ce miroir : l'EXPIRATION de l'abonnement, que la
 *  fiche élève ne porte pas côté écran. Le serveur, lui, la contrôle — il peut
 *  donc refuser ce que cette fonction accepte, jamais l'inverse. */
export function studentSessionRank(input: AudienceCheckInput): 0 | 1 | 2 | undefined {
  const { session, student, sessions, subscriptions, classes } = input;
  const enrolled = enrolledSessionsOf(student, sessions, subscriptions);

  // Rang 0 — inscrit sur CE créneau.
  if (enrolled.some((s) => s.id === session.id)) return 0;

  // Cours ordinaire : la lecture s'arrête ici.
  if (!session.isOpen) return undefined;

  // Rang 1 — même cours, même classe, autre groupe.
  if (enrolled.some((s) => s.moduleId === session.moduleId && s.classId === session.classId)) {
    return 1;
  }

  // Rang 2 — une classe de l'élève figure dans le public de la séance libre.
  const admitted = new Set(sessionAudienceClassIds(session, classes));
  if (studentClassIds(student, sessions, subscriptions).some((id) => admitted.has(id))) {
    return 2;
  }

  return undefined;
}

/**
 * Cet élève peut-il être pointé — au badge ou à la main — sur ce créneau ?
 *
 * Miroir de la clause d'éligibilité de `scan_card` (« le rang n'est pas NULL »)
 * et du refus `attendance.notEnrolled` de `mark_attendance`. Refuser est une
 * décision de guichet : le motif rendu est la phrase que la réception lira.
 */
export function canAttendSession(input: AudienceCheckInput): AudienceVerdict {
  if (studentSessionRank(input) !== undefined) return { allowed: true };

  return {
    allowed: false,
    reason: input.session.isOpen
      ? "Cette séance libre est réservée à son public : cet élève n'en fait pas partie."
      : "Ce créneau n'est pas dans l'emploi du temps de cet élève. Un cours ordinaire n'accepte que ses propres inscrits — ni un autre groupe du même cours, ni une autre classe de la même année et de la même filière.",
  };
}

/** Le public d'un créneau, ou undefined pour un cours ordinaire (le guichet
 *  n'encaisse pas de séance libre dessus, il n'a donc rien à contrôler).
 *
 *  Une séance libre sans réglage vaut "enrolled" : le badge a toujours
 *  contrôlé la classe (`student_session_rank`), et laisser le guichet tout
 *  accepter faisait rendre à la même carte deux verdicts opposés. */
export function audienceOf(session: ScheduleSession): SeanceAudience | undefined {
  return session.isOpen ? (session.openAudience ?? "enrolled") : undefined;
}

/**
 * Cet élève peut-il être encaissé sur ce créneau de séance libre ?
 *
 * Refuser est une décision de guichet : le motif rendu est la phrase que la
 * réception lira, il dit ce qui manque à l'élève, jamais « non ».
 */
export function checkOpenSeanceAudience(input: AudienceCheckInput): AudienceVerdict {
  const { session, student, sessions, subscriptions, classes } = input;

  const audience = audienceOf(session);
  // Cours ordinaire, ou créneau créé avant le réglage : rien à contrôler.
  if (!audience) return { allowed: true };

  const enrolled = enrolledSessionsOf(student, sessions, subscriptions);

  // Inscrit sur le créneau lui-même : la question ne se pose plus.
  if (enrolled.some((s) => s.id === session.id)) return { allowed: true };

  if (enrolled.length === 0) {
    return {
      allowed: false,
      reason:
        "Cet élève n'est inscrit à aucun emploi du temps : il n'entre donc dans le public d'aucun créneau de séance libre.",
    };
  }

  const admitted = new Set(sessionAudienceClassIds(session, classes));
  const his = studentClassIds(student, sessions, subscriptions);
  if (his.some((id) => admitted.has(id))) return { allowed: true };

  return {
    allowed: false,
    reason:
      audience === "filiere"
        ? "Ce créneau est ouvert à sa filière et à sa promotion : cet élève n'est ni de l'une ni de l'autre."
        : "Cette séance libre est réservée aux classes cochées à sa création — et à toute la promotion de même niveau et de même année : la classe de cet élève n'en fait pas partie.",
  };
}
