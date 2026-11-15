import { describe, it, expect } from "vitest";
import { performance } from "node:perf_hooks";
import { filterAttendanceHistory, historySearchIndex } from "@/lib/attendanceHistory";
import type { AttendanceRecord } from "@/lib/types";

const students = Array.from({ length: 2000 }, (_, i) => ({ id: `s${i}`, firstName: `synthetic${i}`, lastName: "fixture" }));
const sessions = Array.from({ length: 100 }, (_, i) => ({ id: `c${i}`, moduleId: `m${i}`, classId: `g${i}` }));
const modules = sessions.map((s, i) => ({ id: s.moduleId, name: `module${i}` }));
const classes = sessions.map((s, i) => ({ id: s.classId, name: `classe${i}` }));
const rows = (n: number) => Array.from({ length: n }, (_, i) => ({
  id: `${i}`, studentId: `s${i % 2000}`, sessionId: `c${i % 100}`,
  timestamp: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  status: i % 2 ? "late" : "present", amountDeducted: 125,
})) as AttendanceRecord[];
const filters = { start: "2026-01-01", end: "2026-12-31", search: "", status: "all" };
function baseline(data: AttendanceRecord[], search: string) {
  return data.filter(a => {
    const day = a.timestamp.substring(0, 10);
    if (day < filters.start || day > filters.end) return false;
    const student = students.find(s => s.id === a.studentId);
    const session = sessions.find(s => s.id === a.sessionId);
    return `${student?.firstName} ${student?.lastName}`.toLowerCase().includes(search)
      || (modules.find(m => m.id === session?.moduleId)?.name ?? "").includes(search)
      || (classes.find(c => c.id === session?.classId)?.name ?? "").includes(search);
  }).sort((a,b) => +new Date(b.timestamp) - +new Date(a.timestamp));
}
describe("indexed attendance history", () => {
  const index = historySearchIndex(students, sessions, modules, classes);
  it("preserves complete results, order and money beyond 500 rows", () => {
    const data = rows(10001);
    for (const search of ["", "synthetic17", "module12", "classe9", "missing"]) {
      const result = filterAttendanceHistory(data, index, { ...filters, search });
      expect(result).toEqual(baseline(data, search));
      expect(result.reduce((sum,r) => sum+r.amountDeducted,0)).toBe(baseline(data,search).length*125);
    }
    expect(filterAttendanceHistory(data,index,{...filters,status:"late"})).toHaveLength(5000);
    expect(filterAttendanceHistory(data,index,{...filters,start:"2027-01-01"})).toEqual([]);
  });
  it("handles deleted relationships, accents and Arabic without mutating input", () => {
    const data = rows(2);
    const index = historySearchIndex([{id:"s0", firstName:"École",lastName:"مدرسة"}],[],[],[]);
    expect(filterAttendanceHistory(data,index,{...filters,search:"مدرسة"})).toEqual([data[0]]);
    expect(filterAttendanceHistory(data,index,{...filters,search:"éCOLE"})).toEqual([data[0]]);
    expect(filterAttendanceHistory(data,index,filters)).toHaveLength(2);
    expect(data[0].id).toBe("0");
  });
  it("records synthetic CPU samples, including index construction", () => {
    for (const size of [10000, 100000]) {
      const data = rows(size);
      const sample = (run:()=>unknown) => {
        const ms = Array.from({length:21},()=>{const t=performance.now();run();return performance.now()-t;}).sort((a,b)=>a-b);
        return { median: +ms[10].toFixed(2), p95: +ms[19].toFixed(2) };
      };
      console.log(JSON.stringify({ size, samples:21, baselineMs:sample(()=>baseline(data,"module12")), indexedMs:sample(()=>filterAttendanceHistory(data,historySearchIndex(students,sessions,modules,classes),{...filters,search:"module12"})) }));
    }
  }, 60000);
});
