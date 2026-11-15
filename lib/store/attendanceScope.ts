import { roleHome } from "@/lib/nav";
import type { Role } from "@/lib/types";
/** No financial or historical tables may be added to this route's bootstrap. */
export const ATTENDANCE_TABLE_KEYS = [
  "sessions", "subscriptions", "classes", "modules", "teachers", "salles",
  "groups", "freePeriods", "students",
] as const;

export function attendanceRoute(path: string, role: string) {
  return path === "/attendance" && (role === "admin" || role === "reception");
}

/** Calendar-day bounds include DST transitions; dates originate in a date input. */
export function attendanceBounds(start: string, end = start) {
  const after = new Date(`${end}T00:00:00`);
  after.setDate(after.getDate() + 1);
  return { from: new Date(`${start}T00:00:00`).toISOString(), to: after.toISOString() };
}

/** Only a fixed authorized destination is accepted; never redirect arbitrary URLs. */
export function attendanceLoginDestination(role: Role, next: string | null) {
  return role === "reception" || (role === "admin" && next === "attendance")
    ? "/attendance" : roleHome(role);
}
