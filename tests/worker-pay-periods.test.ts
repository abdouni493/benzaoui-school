import { describe, it, expect } from "vitest";

import {
  addMonthsKeepingDay,
  payAnchorOf,
  pendingAbsencesOf,
  unpaidPeriodsOf,
  urgencyOf,
} from "@/lib/workerPay";
import type { ReceptionStaff, WorkerPayment, WorkerShift } from "@/lib/types";

const DAYS_ALL = [
  "saturday",
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
] as ReceptionStaff["workDays"];

const worker = (o: Partial<ReceptionStaff> = {}): ReceptionStaff => ({
  id: "w1",
  firstName: "Nadia",
  lastName: "Agent",
  phone: "0555",
  email: "",
  paymentType: "monthly",
  startDate: "2026-09-10",
  salary: 30_000,
  workDays: DAYS_ALL,
  ...o,
});

const shift = (o: Partial<WorkerShift> = {}): WorkerShift => ({
  id: `s-${o.workDate ?? "x"}-${o.workerId ?? "w1"}`,
  workerId: "w1",
  workDate: "2026-09-14",
  minutes: 0,
  frozen: false,
  paid: false,
  createdAt: "2026-09-14T08:00:00.000Z",
  ...o,
});

describe("addMonthsKeepingDay — l'anniversaire de paie", () => {
  it("garde le même jour du mois", () => {
    expect(addMonthsKeepingDay("2026-09-10", 1)).toBe("2026-10-10");
    expect(addMonthsKeepingDay("2026-09-10", 2)).toBe("2026-11-10");
  });

  it("ramène au dernier jour quand le mois d'arrivée est plus court", () => {
    // 31 janvier + 1 mois = 28 février, jamais le 3 mars.
    expect(addMonthsKeepingDay("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonthsKeepingDay("2026-03-31", 1)).toBe("2026-04-30");
  });
});

describe("payAnchorOf — d'où part la paie", () => {
  it("prend la date de paie quand elle est posée", () => {
    expect(payAnchorOf({ payStartDate: "2026-09-10", startDate: "2026-08-01" })).toBe("2026-09-10");
  });

  it("retombe sur la date d'embauche — ce que la réception avait toujours saisi", () => {
    expect(payAnchorOf({ startDate: "2026-08-01" })).toBe("2026-08-01");
  });
});

describe("unpaidPeriodsOf — travailleur MENSUEL", () => {
  it("compte du 10 au 9, et le salaire est dû le 10 suivant", () => {
    // C'est la panne : payé à partir du 10 septembre, l'écran annonçait le
    // salaire dû le 30 septembre — dix jours avant qu'il soit gagné.
    const periods = unpaidPeriodsOf(
      worker({ payStartDate: "2026-09-10" }),
      [],
      [],
      "2026-10-15",
    );
    const first = periods[0];
    expect(first.start).toBe("2026-09-10");
    expect(first.end).toBe("2026-10-09");
    expect(first.dueDate).toBe("2026-10-10");
    expect(first.amount).toBe(30_000);
    expect(first.running).toBe(false);
  });

  it("ne réclame pas une période qui n'est pas finie", () => {
    const periods = unpaidPeriodsOf(
      worker({ payStartDate: "2026-09-10" }),
      [],
      [],
      "2026-09-20",
    );
    expect(periods).toHaveLength(1);
    expect(periods[0].running).toBe(true);
    // Une période en cours n'est jamais « en retard » : elle n'est pas finie.
    expect(urgencyOf(periods[0], worker(), "2026-09-20").urgency).not.toBe("late");
  });

  it("garde le découpage en mois CIVILS quand la paie part du 1er", () => {
    // Ce cas doit rester identique à l'ancien comportement : c'est la majorité
    // des écoles, et on ne veut pas repayer un mois déjà réglé.
    const periods = unpaidPeriodsOf(
      worker({ payStartDate: "2026-09-01", startDate: "2026-09-01" }),
      [],
      [],
      "2026-10-15",
    );
    expect(periods[0].start).toBe("2026-09-01");
    expect(periods[0].end).toBe("2026-09-30");
    expect(periods[0].dueDate).toBe("2026-09-30");
    expect(periods[0].key).toBe("09/2026");
  });

  it("la clé reste « MM/YYYY » du mois de DÉPART — les mois déjà payés le restent", () => {
    const paid: WorkerPayment[] = [
      {
        id: "p1",
        workerId: "w1",
        amount: 30_000,
        method: "monthly",
        periodKey: "09/2026",
        daysCount: 0,
        minutes: 0,
        description: "",
        details: [],
        paidAt: "2026-10-10T10:00:00.000Z",
      },
    ];
    const periods = unpaidPeriodsOf(
      worker({ payStartDate: "2026-09-10" }),
      [],
      paid,
      "2026-11-15",
    );
    // Septembre est payé : il ne revient pas.
    expect(periods.map((p) => p.key)).not.toContain("09/2026");
    // Octobre (10/10 → 09/11) est terminé le 15/11 : il est dû.
    const octobre = periods.find((p) => p.key === "10/2026")!;
    expect(octobre.running).toBe(false);
    expect(octobre.dueDate).toBe("2026-11-10");
    // Novembre (10/11 → 09/12) a commencé : il s'affiche, mais EN COURS — on
    // ne réclame pas un salaire qui n'est pas encore gagné.
    const novembre = periods.find((p) => p.key === "11/2026")!;
    expect(novembre.running).toBe(true);
  });

  it("remonte les absences EN ATTENTE de la période, pour que le règlement les voie", () => {
    const shifts = [
      shift({ workDate: "2026-09-14", status: "absent", source: "auto" }),
      shift({ workDate: "2026-09-15", status: "absent", absenceResolved: true, absenceCost: 0 }),
      shift({ workDate: "2026-09-16", status: "present", minutes: 420 }),
    ];
    const periods = unpaidPeriodsOf(
      worker({ payStartDate: "2026-09-10" }),
      shifts,
      [],
      "2026-10-15",
    );
    expect(periods[0].absent).toBe(2);
    // Une seule n'a pas été tranchée : c'est celle qui bloque le règlement.
    expect(periods[0].pendingAbsences.map((d) => d.workDate)).toEqual(["2026-09-14"]);
  });
});

describe("unpaidPeriodsOf — travailleur JOURNALIER", () => {
  const daily = worker({ id: "d1", paymentType: "daily", salary: 2_000, startDate: "2026-09-01" });

  it("ne paie une journée qu'une fois la SORTIE pointée", () => {
    // La panne : la journée était due dès le badge d'arrivée — le travailleur
    // était « dû » à 8 h 01, avant d'avoir travaillé.
    const ouverte = shift({
      workerId: "d1",
      workDate: "2026-09-14",
      startAt: "2026-09-14T08:00:00.000Z",
      minutes: 0,
    });
    expect(unpaidPeriodsOf(daily, [ouverte], [], "2026-09-15")).toEqual([]);

    const fermee = shift({
      workerId: "d1",
      workDate: "2026-09-14",
      startAt: "2026-09-14T08:00:00.000Z",
      endAt: "2026-09-14T16:00:00.000Z",
      minutes: 480,
    });
    const periods = unpaidPeriodsOf(daily, [fermee], [], "2026-09-15");
    expect(periods).toHaveLength(1);
    expect(periods[0].amount).toBe(2_000);
  });

  it("porte les heures de pointage de la journée — ce qui justifie le montant", () => {
    const fermee = shift({
      workerId: "d1",
      workDate: "2026-09-14",
      startAt: "2026-09-14T08:00:00.000Z",
      endAt: "2026-09-14T16:30:00.000Z",
      minutes: 510,
      source: "scan",
    });
    const [p] = unpaidPeriodsOf(daily, [fermee], [], "2026-09-15");
    expect(p.days).toHaveLength(1);
    expect(p.days[0].startAt).toBe("2026-09-14T08:00:00.000Z");
    expect(p.days[0].endAt).toBe("2026-09-14T16:30:00.000Z");
    expect(p.days[0].minutes).toBe(510);
  });

  it("laisse de côté une journée GELÉE : elle attend d'être corrigée", () => {
    const gelee = shift({
      workerId: "d1",
      workDate: "2026-09-14",
      startAt: "2026-09-14T08:00:00.000Z",
      endAt: "2026-09-14T16:00:00.000Z",
      minutes: 480,
      frozen: true,
    });
    expect(unpaidPeriodsOf(daily, [gelee], [], "2026-09-15")).toEqual([]);
  });

  it("ne paie jamais une absence", () => {
    const absent = shift({ workerId: "d1", workDate: "2026-09-14", status: "absent" });
    expect(unpaidPeriodsOf(daily, [absent], [], "2026-09-15")).toEqual([]);
  });
});

describe("pendingAbsencesOf — les absences qu'il reste à trancher", () => {
  const monthly = worker({ id: "m1" });
  const daily = worker({ id: "d1", paymentType: "daily", salary: 2_000 });

  it("ne remonte que les absences NON tranchées", () => {
    const shifts = [
      shift({ workerId: "m1", workDate: "2026-09-14", status: "absent" }),
      shift({
        workerId: "m1",
        workDate: "2026-09-15",
        status: "absent",
        absenceResolved: true,
        absenceCost: 1_200,
      }),
    ];
    const alerts = pendingAbsencesOf([monthly], shifts, "2026-09-20");
    expect(alerts.map((a) => a.shift.workDate)).toEqual(["2026-09-14"]);
  });

  it("« ne rien retenir » est une DÉCISION : l'absence sort des alertes", () => {
    const shifts = [
      shift({
        workerId: "m1",
        workDate: "2026-09-14",
        status: "absent",
        absenceResolved: true,
        absenceCost: 0,
      }),
    ];
    expect(pendingAbsencesOf([monthly], shifts, "2026-09-20")).toEqual([]);
  });

  it("ignore un JOURNALIER : ne pas venir se solde tout seul", () => {
    const shifts = [shift({ workerId: "d1", workDate: "2026-09-14", status: "absent" })];
    expect(pendingAbsencesOf([daily], shifts, "2026-09-20")).toEqual([]);
  });

  it("met les plus anciennes en tête — c'est l'urgence", () => {
    const shifts = [
      shift({ workerId: "m1", workDate: "2026-09-18", status: "absent" }),
      shift({ workerId: "m1", workDate: "2026-09-12", status: "absent" }),
    ];
    const alerts = pendingAbsencesOf([monthly], shifts, "2026-09-20");
    expect(alerts.map((a) => a.shift.workDate)).toEqual(["2026-09-12", "2026-09-18"]);
    expect(alerts[0].daysAgo).toBe(8);
  });
});
