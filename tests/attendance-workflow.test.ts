import { beforeEach, describe, expect, it, vi } from "vitest";
import { attendanceRoute, attendanceLoginDestination } from "@/lib/store/attendanceScope";
type Row = Record<string, unknown>;
const fixture = vi.hoisted(() => ({ db: {} as Record<string, Row[]>, requests: [] as { table: string; rows: number; filtered: boolean }[], missingSync: false, failTable: "", hold: null as Promise<void> | null }));
vi.mock("@/lib/store/snapshot", () => ({ readSnapshot: async () => null, writeSnapshot: async () => {}, clearSnapshots: async () => {} }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({
  rpc: async (name: string, args: Record<string, unknown>) => {
    if (name === "sync_changes") return fixture.missingSync
      ? {data:null,error:{code:"PGRST202",message:"missing function"}}
      : {data:{now:new Date().toISOString(),tables:{},deleted:[]},error:null};
    if (name === "scan_card") { args.p_student_id="student";args.p_session_id="session"; }
    if (name === "mark_attendance" || name === "scan_card") {
      const student = fixture.db.students.find(s => s.id === args.p_student_id)!;
      if (!fixture.db.attendance.some(a => a.student_id === student.id && a.session_id === args.p_session_id)) {
        student.balance = Number(student.balance) - 100;
        fixture.db.attendance.push({id:"new",student_id:student.id,session_id:args.p_session_id,occurred_at:new Date().toISOString(),status:"present",amount_deducted:100});
      }
      return {data:{ok:true,studentId:student.id,newBalance:student.balance,messageKey:"scan.success"},error:null};
    }
    return {data:null,error:{message:"unexpected RPC"}};
  },
  from: (table: string) => {
    const predicates: ((row:Row)=>boolean)[] = [];
    let lo=0, hi=Infinity, orderKey="id";
    const q = {
      select: () => q, order: (key:string) => {orderKey=key;return q;},
      in: (key:string, ids:unknown[]) => {predicates.push(r=>ids.includes(r[key]));return q;},
      eq: (key:string,value:unknown) => {predicates.push(r=>r[key]===value);return q;},
      gt: (key:string,value:string) => {predicates.push(r=>String(r[key])>value);return q;},
      gte: (key:string,value:string) => {predicates.push(r=>String(r[key])>=value);return q;},
      lt: (key:string,value:string) => {predicates.push(r=>String(r[key])<value);return q;},
      limit: (n:number) => {hi=n-1;return q;},
      range: (a:number,b:number) => {lo=a;hi=b;return q;},
      maybeSingle: async () => ({data:null,error:null}),
      then: (resolve:(value:unknown)=>unknown,reject?:(e:unknown)=>unknown) => {
        if (fixture.failTable === table) { fixture.failTable = ""; return Promise.resolve({data:null,error:{message:"offline"}}).then(resolve,reject); }
        const held = fixture.hold; fixture.hold = null;
        const rows=(fixture.db[table]??[]).filter(r=>predicates.every(p=>p(r))).sort((a,b)=>String(a[orderKey])<String(b[orderKey]) ? -1 : String(a[orderKey])>String(b[orderKey]) ? 1 : 0).slice(lo,hi+1);
        fixture.requests.push({table,rows:rows.length,filtered:predicates.length>0});
        return Promise.resolve(held).then(()=>({data:structuredClone(rows),error:null})).then(resolve,reject);
      },
    };
    return q;
  },
}) }));
async function desk() {vi.resetModules(); return (await import("@/lib/store/data")).useData;}
function seed(size:number) {
  const day=["sunday","monday","tuesday","wednesday","thursday","friday","saturday"][new Date().getDay()];
  fixture.db={
    sessions:[{id:"session",days:[day],module_id:"module",class_id:"class"}],
    subscriptions:[{id:"subscription",session_id:"session"}],
    student_subscriptions:[{student_id:"student",subscription_id:"subscription"}],
    students:[{id:"student",first_name:"Synthetic",last_name:"Fixture",balance:1000,student_subscriptions:[{subscription_id:"subscription"}]}],
    attendance:Array.from({length:size},(_,i)=>({id:`old${String(i).padStart(8,"0")}`,student_id:"student",session_id:"old",occurred_at:"2020-01-01T12:00:00Z",amount_deducted:100,status:"present"})),
    balance_tx:Array.from({length:size},(_,i)=>({id:`tx${String(i).padStart(8,"0")}`,student_id:"student",amount:100})),
    cash_transactions:Array.from({length:size},(_,i)=>({id:`cash${String(i).padStart(8,"0")}`})),
  };
}
beforeEach(()=>{fixture.requests=[];fixture.missingSync=false;fixture.failTable="";fixture.hold=null;seed(1500);});
describe("reception Attendance workflow without global history",()=>{
  for (const missingSync of [false,true]) it(`cold, manual save, second desk; missing sync=${missingSync}`,async()=>{
    fixture.missingSync=missingSync;
    const first=await desk();await first.getState().start("desk1","attendance");
    expect(first.getState().attendanceStatus).toBe("complete");
    expect(first.getState().students).toHaveLength(1);
    expect(first.getState().complete.students).toBe(false);
    expect(fixture.requests.map(r=>r.table)).not.toEqual(expect.arrayContaining(["balance_tx","cash_transactions","teacher_payments","worker_payments"]));
    const cold=fixture.requests.slice();
    const second=await desk();await second.getState().start("desk2","attendance");
    fixture.requests=[];
    const result=await first.getState().markAttendance("student","session","present");
    expect(result.ok).toBe(true);
    expect(first.getState().students[0].balance).toBe(900);
    expect(first.getState().attendance).toHaveLength(1);
    expect(fixture.requests.map(r=>r.table).sort()).toEqual(["attendance","students"]);
    expect(fixture.requests.every(r=>r.filtered)).toBe(true);
    const save=fixture.requests.slice();
    await first.getState().markAttendance("student","session","present");
    await second.getState().backgroundSync();
    expect(second.getState().attendance).toHaveLength(1);
    expect(second.getState().students[0].balance).toBe(900);
    // A later desk poll replaces the selected day: deletes cannot persist.
    fixture.db.attendance=fixture.db.attendance.filter(a=>a.id!=="new");
    await second.getState().backgroundSync();
    expect(second.getState().attendance).toHaveLength(0);
    console.log(JSON.stringify({missingSync,cold,save}));
  });
  it("records before/after transfers with identical small and long-history fixtures",async()=>{
    for(const size of [1500,15000]) {
      seed(size);const legacy=await desk();fixture.requests=[];
      await legacy.getState().fetchAll();const before=fixture.requests.slice();
      fixture.requests=[];fixture.missingSync=true;
      // No sync migration: the legacy path falls back to whole-store refresh.
      await legacy.getState().markAttendance("student","session","present");
      const beforeSave=fixture.requests.slice();
      seed(size);
      const scoped=await desk();fixture.requests=[];
      await scoped.getState().start("desk","attendance");const after=fixture.requests.slice();
      fixture.requests=[];
      await scoped.getState().markAttendance("student","session","present");
      const afterSave=fixture.requests.slice();
      expect(afterSave.map(r=>r.table).sort()).toEqual(["attendance","students"]);
      expect(after.some(r=>r.table==="balance_tx")).toBe(false);
      expect(after.reduce((n,r)=>n+r.rows,0)).toBe(4);
      console.log(JSON.stringify({historyRows:size,manualBefore:{requests:beforeSave.length,rows:beforeSave.reduce((n,r)=>n+r.rows,0)},manualAfter:{requests:afterSave.length,rows:afterSave.reduce((n,r)=>n+r.rows,0)},before:{requests:before.length,rows:before.reduce((n,r)=>n+r.rows,0),tables:[...new Set(before.map(r=>r.table))]},after:{requests:after.length,rows:after.reduce((n,r)=>n+r.rows,0),tables:[...new Set(after.map(r=>r.table))]}}));
    }
  });
  it("keeps immediate RFID balance feedback and bounds its background reads",async()=>{
    const store=await desk();await store.getState().start("desk","attendance");fixture.requests=[];
    const result=await store.getState().scanCard("synthetic-code");
    expect(result.newBalance).toBe(900);expect(store.getState().students[0].balance).toBe(900);
    await new Promise(r=>setTimeout(r,0));
    expect(store.getState().attendance).toHaveLength(1);
    await store.getState().scanCard("synthetic-code");
    expect(store.getState().students[0].balance).toBe(900);
    expect(fixture.requests.every(r=>["students","attendance"].includes(r.table) && r.filtered)).toBe(true);
  });
  it("retains confirmed data on read failure and retries reads only",async()=>{
    const store=await desk();await store.getState().start("desk","attendance");
    fixture.failTable="students";
    const result=await store.getState().markAttendance("student","session","present");
    expect(result.ok).toBe(true);
    expect(store.getState().attendanceStatus).toBe("failed");
    expect(store.getState().students[0].balance).toBe(900);
    await store.getState().loadAttendanceDay(new Date().toLocaleDateString("fr-CA"));
    expect(store.getState().students[0].balance).toBe(900);
    expect(store.getState().attendance).toHaveLength(1);
  });
  it("discards a prior owner's delayed scoped read",async()=>{
    const store=await desk();let release!:()=>void;
    fixture.hold=new Promise<void>(r=>{release=r;});
    const old=store.getState().start("old","attendance");
    await Promise.resolve();store.getState().clear();release();await old;
    expect(store.getState().students).toHaveLength(0);
    expect(store.getState().attendanceScope).toBe(false);
  });
  it("keeps full selected-period history and requires complete data on financial navigation",async()=>{
    const store=await desk();await store.getState().start("desk","attendance");
    expect(await store.getState().readAttendanceHistory("2020-01-01","2020-01-02")).toHaveLength(1500);
    await store.getState().start("desk");
    expect(store.getState().loaded).toBe(true);
    expect(store.getState().balanceTx).toHaveLength(1500);
    expect(store.getState().complete.balanceTx).toBe(true);
    expect(attendanceLoginDestination("reception",null)).toBe("/attendance");
    expect(attendanceLoginDestination("admin","attendance")).toBe("/attendance");
    expect(attendanceLoginDestination("parent","attendance")).not.toBe("/attendance");
    expect(attendanceLoginDestination("admin","https://untrusted.example")).not.toBe("https://untrusted.example");
    expect(attendanceRoute("/attendance","reception")).toBe(true);
    expect(attendanceRoute("/reports","admin")).toBe(false);
    expect(attendanceRoute("/attendance","parent")).toBe(false);
  });
  it("opens a student card from Attendance with only that student's rows",async()=>{
    fixture.db.balance_tx.push({id:"txother",student_id:"other",amount:5});
    fixture.db.cash_transactions.push({id:"cashx"});
    const store=await desk();await store.getState().start("desk","attendance");
    expect(store.getState().balanceTx).toHaveLength(0);
    fixture.requests=[];
    await store.getState().focusAttendanceStudent("student");
    const state=store.getState();
    expect(state.attendanceScope).toBe(true);
    expect(state.attendanceFocusStatus).toBe("complete");
    expect(state.balanceTx).toHaveLength(1500);
    expect(state.balanceTx.every(t=>t.studentId==="student")).toBe(true);
    expect(state.attendance.filter(a=>a.studentId==="student")).toHaveLength(1500);
    expect(state.complete.balanceTx).toBe(true);
    const tables=new Set(fixture.requests.map(r=>r.table));
    expect(tables.has("cash_transactions")).toBe(false);
    expect(tables.has("sessions")).toBe(false);
    // A write from the card re-reads only that student, not the whole day.
    fixture.requests=[];
    await store.getState().refresh();
    expect(fixture.requests.some(r=>r.table==="sessions")).toBe(false);
    expect(store.getState().balanceTx).toHaveLength(1500);
    // Background polling keeps the open card filled.
    await store.getState().backgroundSync();
    expect(store.getState().balanceTx).toHaveLength(1500);
    await store.getState().focusAttendanceStudent(null);
    expect(store.getState().attendanceFocusId).toBeNull();
  });
});
