/**
 * Qui a le droit d'assister à une séance libre.
 *
 * Un créneau est créé sur l'Emploi du Temps en cochant des classes, des
 * groupes, des salles et un enseignant. Une ligne de `classes` porte exactement
 * ce que la réception coche : le niveau (primaire/moyen/lycée), l'année et la
 * filière. Le public d'un créneau se lit donc sur la CLASSE, jamais sur le
 * groupe :
 *
 *   · "enrolled" — les classes cochées, ÉLARGIES à leurs jumelles : toute
 *     classe de même niveau, même année et même filière. C'est le réglage
 *     courant, et il suffit à laisser badger toute la promotion ;
 *   · "filiere"  — en plus, toutes les années de la filière.
 *
 * "enrolled" est inclus dans "filiere" : élargir le public n'enlève jamais
 * personne. Un créneau sans réglage (créé avant, ou base pas encore migrée)
 * n'impose rien — le guichet continue de tout accepter, comme avant.
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

/** Ces deux classes désignent-elles la même population d'élèves ? */
function isPeerClass(a: SchoolClass, b: SchoolClass): boolean {
  if (a.id === b.id) return true;
  if (a.type !== b.type) return false;
  // Une formation n'a ni année ni filière : elle se rapproche par son niveau,
  // jamais par « pas de filière », qui les réunirait toutes.
  if (a.type === "formation") return a.formationLevel === b.formationLevel;
  return (
    a.coursLevel === b.coursLevel &&
    yearKey(a) === yearKey(b) &&
    (a.filiereId ?? null) === (b.filiereId ?? null)
  );
}

/** Les classes qui désignent la même population que celles citées. */
export function classPeerIds(classIds: string[], classes: SchoolClass[]): string[] {
  const picked = classes.filter((c) => classIds.includes(c.id));
  return classes.filter((c) => picked.some((p) => isPeerClass(c, p))).map((c) => c.id);
}

/** Les classes admises sur un créneau, réglage de public compris. */
export function sessionAudienceClassIds(
  session: ScheduleSession,
  classes: SchoolClass[],
): string[] {
  const pickedIds = openSeanceClassIds(session);
  const peers = classPeerIds(pickedIds, classes);
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

/** Le public d'un créneau, ou undefined quand il n'en porte aucun. */
export function audienceOf(session: ScheduleSession): SeanceAudience | undefined {
  return session.isOpen ? session.openAudience : undefined;
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
        ? "Ce créneau est ouvert aux élèves de sa filière : cet élève suit une autre filière."
        : "Ce créneau est réservé aux classes cochées à sa création — et à celles de même année et même filière : la classe de cet élève n'en fait pas partie.",
  };
}
