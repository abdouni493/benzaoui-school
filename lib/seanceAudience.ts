/**
 * Qui a le droit d'assister à une séance libre.
 *
 * Un créneau de séance libre est créé sur l'Emploi du Temps en cochant des
 * classes, des groupes, des salles et un enseignant. Jusqu'ici ces cases ne
 * décrivaient que le créneau : au guichet, N'IMPORTE quel élève pouvait être
 * encaissé dessus, y compris un élève d'une autre filière qui n'avait rien à y
 * faire. Le créneau porte désormais son public :
 *
 *   · "enrolled" — seuls les élèves dont l'emploi du temps passe par les
 *     classes ET les groupes cochés ;
 *   · "filiere"  — tout élève d'une classe de la même filière, même s'il suit
 *     un autre groupe ou un autre créneau.
 *
 * "enrolled" est inclus dans "filiere" : élargir le public n'enlève jamais
 * personne. Un créneau sans réglage (créé avant, ou base pas encore migrée)
 * n'impose rien — le guichet continue de tout accepter, comme avant.
 *
 * Les passagers ne sont pas concernés : ils n'ont ni classe ni filière, et la
 * séance libre existe précisément pour les encaisser. La règle ne porte donc
 * que sur les élèves inscrits.
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

/** Filières des classes citées, les classes sans filière (formations) étant
 *  ignorées : deux formations ne partagent pas une filière vide. */
function filiereIdsOf(classIds: string[], classes: SchoolClass[]): Set<string> {
  const out = new Set<string>();
  for (const id of classIds) {
    const f = classes.find((c) => c.id === id)?.filiereId;
    if (f) out.add(f);
  }
  return out;
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

  const classIds = openSeanceClassIds(session);
  const groupIds = openSeanceGroupIds(session);

  if (audience === "enrolled") {
    const ok = enrolled.some(
      (s) => classIds.includes(s.classId) && groupIds.includes(s.groupId),
    );
    return ok
      ? { allowed: true }
      : {
          allowed: false,
          reason:
            "Ce créneau est réservé aux élèves des classes et des groupes cochés à sa création : l'emploi du temps de cet élève n'en fait pas partie.",
        };
  }

  // "filiere" : la même filière suffit, quel que soit le groupe ou le créneau.
  const studentClassIds = [...new Set(enrolled.map((s) => s.classId))];
  if (studentClassIds.some((id) => classIds.includes(id))) return { allowed: true };

  const wanted = filiereIdsOf(classIds, classes);
  const his = filiereIdsOf(studentClassIds, classes);
  const ok = [...his].some((f) => wanted.has(f));

  return ok
    ? { allowed: true }
    : {
        allowed: false,
        reason:
          "Ce créneau est ouvert aux élèves de sa filière : cet élève suit une autre filière.",
      };
}
