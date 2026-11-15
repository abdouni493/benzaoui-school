import type { AttendanceRecord } from "@/lib/types";

/** Build once per relationship change, never once per attendance row. */
export function historySearchIndex(
  students: readonly { id: string; firstName: string; lastName: string }[],
  sessions: readonly { id: string; moduleId: string; classId?: string }[],
  modules: readonly { id: string; name: string }[],
  classes: readonly { id: string; name: string }[],
) {
  const studentNames = new Map(students.map(s => [s.id, `${s.firstName} ${s.lastName}`.toLowerCase()]));
  const moduleNames = new Map(modules.map(m => [m.id, m.name.toLowerCase()]));
  const classNames = new Map(classes.map(c => [c.id, c.name.toLowerCase()]));
  const sessionNames = new Map(sessions.map(s => [s.id, [moduleNames.get(s.moduleId) ?? "", classNames.get(s.classId ?? "") ?? ""]]));
  return { studentNames, sessionNames };
}

export function filterAttendanceHistory(
  attendance: readonly AttendanceRecord[],
  index: ReturnType<typeof historySearchIndex>,
  filters: { start: string; end: string; search: string; status: string },
): AttendanceRecord[] {
  const search = filters.search.toLowerCase();
  return attendance.filter(a => {
    const day = a.timestamp.substring(0, 10);
    if (day < filters.start || day > filters.end) return false;
    if (filters.status !== "all" && a.status !== filters.status) return false;
    return (index.studentNames.get(a.studentId) ?? "").includes(search)
      || (index.sessionNames.get(a.sessionId) ?? ["", ""]).some(name => name.includes(search));
  }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
}
