import { describe, it, expect } from "vitest";

import { sessionRoster } from "@/lib/sessionRoster";

const students = [
  { id: "stu-amine", subscriptionIds: ["sub-g1"] },
  { id: "stu-sara", subscriptionIds: ["sub-g1", "sub-phys"] },
  // désinscrit de G1 ce matin, après avoir été pointé
  { id: "stu-yanis", subscriptionIds: [] as string[] },
  // inscrit dans un autre groupe du même cours
  { id: "stu-lina", subscriptionIds: ["sub-g2"] },
];
const subscriptions = [
  { id: "sub-g1", sessionId: "se-g1" },
  { id: "sub-g2", sessionId: "se-g2" },
  { id: "sub-phys", sessionId: "se-phys" },
  { id: "sub-libre", sessionId: "se-libre" },
];

const ids = (list: { id: string }[]) => list.map((s) => s.id);

describe("sessionRoster — la feuille d'un cours suit ses inscriptions", () => {
  it("retire un élève désinscrit, même pointé ce jour-là", () => {
    const day = [
      { studentId: "stu-amine", sessionId: "se-g1" },
      { studentId: "stu-yanis", sessionId: "se-g1" },
    ];
    expect(ids(sessionRoster({ id: "se-g1" }, students, subscriptions, day))).toEqual(["stu-amine", "stu-sara"]);
  });

  it("ne montre pas l'élève d'un autre groupe passé sur ce créneau", () => {
    const day = [{ studentId: "stu-lina", sessionId: "se-g1" }];
    expect(ids(sessionRoster({ id: "se-g1", isOpen: false }, students, subscriptions, day))).toEqual([
      "stu-amine",
      "stu-sara",
    ]);
  });

  it("garde sur une séance libre ceux qui y ont badgé sans inscription", () => {
    const day = [
      { studentId: "stu-lina", sessionId: "se-libre" },
      // une présence sur un AUTRE créneau ne compte pas
      { studentId: "stu-amine", sessionId: "se-g1" },
    ];
    expect(ids(sessionRoster({ id: "se-libre", isOpen: true }, students, subscriptions, day))).toEqual(["stu-lina"]);
  });

  it("ne double pas un inscrit d'une séance libre qui y a aussi badgé", () => {
    const withLibre = [...students, { id: "stu-nour", subscriptionIds: ["sub-libre"] }];
    const day = [{ studentId: "stu-nour", sessionId: "se-libre" }];
    expect(ids(sessionRoster({ id: "se-libre", isOpen: true }, withLibre, subscriptions, day))).toEqual(["stu-nour"]);
  });
});
