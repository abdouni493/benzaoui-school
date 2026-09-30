"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useSession } from "@/lib/store/session";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";
import { RestrictedPage } from "@/components/RestrictedPage";

// ---- Chaque écran dans son propre fichier JavaScript ---------------------------
//
// Les 23 écrans de l'application (près de 50 000 lignes) étaient tous importés
// ici d'un bloc : ouvrir N'IMPORTE QUELLE page téléchargeait, analysait et
// compilait TOUS les écrans — la caisse, les rapports, la paie — avant d'afficher
// la première ligne. Sur le PC du guichet, c'était plusieurs secondes à chaque
// ouverture.
//
// Chaque écran est maintenant chargé à la demande, et les autres sont
// préchargés en arrière-plan une fois la page affichée, quand le navigateur n'a
// rien d'autre à faire : la navigation suivante reste instantanée.

// Les mêmes imports, pour le préchargement de fond : webpack les rattache aux
// mêmes fichiers que les `dynamic()` ci-dessous (qui, eux, doivent être écrits
// en toutes lettres — Next les analyse à la compilation).
const loaders = {
  classes: () => import("@/components/pages/ClassesPage").then((m) => m.ClassesPage),
  planner: () => import("@/components/pages/PlannerPage").then((m) => m.PlannerPage),
  timetables: () => import("@/components/pages/TimetablesPage").then((m) => m.TimetablesPage),
  rooms: () => import("@/components/pages/RoomsPage").then((m) => m.RoomsPage),
  subscriptions: () => import("@/components/pages/SubscriptionsPage").then((m) => m.SubscriptionsPage),
  students: () => import("@/components/pages/StudentsPage").then((m) => m.StudentsPage),
  birthdays: () => import("@/components/pages/BirthdaysPage").then((m) => m.BirthdaysPage),
  attendance: () => import("@/components/pages/AttendancePage").then((m) => m.AttendancePage),
  teachers: () => import("@/components/pages/TeachersPage").then((m) => m.TeachersPage),
  subjects: () => import("@/components/pages/SubjectsPage").then((m) => m.SubjectsPage),
  administration: () => import("@/components/pages/AdministrationPage").then((m) => m.AdministrationPage),
  independent: () => import("@/components/pages/IndependentPage").then((m) => m.IndependentPage),
  particulier: () => import("@/components/pages/ParticulierPage").then((m) => m.ParticulierPage),
  parents: () => import("@/components/pages/ParentsPage").then((m) => m.ParentsPage),
  announcements: () => import("@/components/pages/AnnouncementsPage").then((m) => m.AnnouncementsPage),
  expenses: () => import("@/components/pages/ExpensesPage").then((m) => m.ExpensesPage),
  analytics: () => import("@/components/pages/AnalyticsPage").then((m) => m.AnalyticsPage),
  cash: () => import("@/components/pages/CashPage").then((m) => m.CashPage),
  reports: () => import("@/components/pages/ReportsPage").then((m) => m.ReportsPage),
  settings: () => import("@/components/pages/SettingsPage").then((m) => m.SettingsPage),
  studentPortal: () => import("@/components/pages/StudentPages").then((m) => m.StudentPages),
  teacherPortal: () => import("@/components/pages/TeacherPages").then((m) => m.TeacherPages),
  parentPortal: () => import("@/components/pages/ParentPages").then((m) => m.ParentPages),
} as const;

/** Ce qui s'affiche le temps que le fichier de l'écran arrive (une fraction de
 *  seconde la première fois, rien ensuite : il est en cache). */
function ScreenLoading() {
  return (
    <div className="flex min-h-[50dvh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-line border-t-[var(--primary)]" />
        <span className="text-xs font-semibold text-muted">Chargement…</span>
      </div>
    </div>
  );
}

const ClassesPage = dynamic(() => import("@/components/pages/ClassesPage").then((m) => m.ClassesPage), {
  ssr: false,
  loading: ScreenLoading,
});
const PlannerPage = dynamic(() => import("@/components/pages/PlannerPage").then((m) => m.PlannerPage), {
  ssr: false,
  loading: ScreenLoading,
});
const TimetablesPage = dynamic(() => import("@/components/pages/TimetablesPage").then((m) => m.TimetablesPage), {
  ssr: false,
  loading: ScreenLoading,
});
const RoomsPage = dynamic(() => import("@/components/pages/RoomsPage").then((m) => m.RoomsPage), {
  ssr: false,
  loading: ScreenLoading,
});
const SubscriptionsPage = dynamic(() => import("@/components/pages/SubscriptionsPage").then((m) => m.SubscriptionsPage), {
  ssr: false,
  loading: ScreenLoading,
});
const StudentsPage = dynamic(() => import("@/components/pages/StudentsPage").then((m) => m.StudentsPage), {
  ssr: false,
  loading: ScreenLoading,
});
const BirthdaysPage = dynamic(() => import("@/components/pages/BirthdaysPage").then((m) => m.BirthdaysPage), {
  ssr: false,
  loading: ScreenLoading,
});
const AttendancePage = dynamic(() => import("@/components/pages/AttendancePage").then((m) => m.AttendancePage), {
  ssr: false,
  loading: ScreenLoading,
});
const TeachersPage = dynamic(() => import("@/components/pages/TeachersPage").then((m) => m.TeachersPage), {
  ssr: false,
  loading: ScreenLoading,
});
const SubjectsPage = dynamic(() => import("@/components/pages/SubjectsPage").then((m) => m.SubjectsPage), {
  ssr: false,
  loading: ScreenLoading,
});
const AdministrationPage = dynamic(() => import("@/components/pages/AdministrationPage").then((m) => m.AdministrationPage), {
  ssr: false,
  loading: ScreenLoading,
});
const IndependentPage = dynamic(() => import("@/components/pages/IndependentPage").then((m) => m.IndependentPage), {
  ssr: false,
  loading: ScreenLoading,
});
const ParticulierPage = dynamic(() => import("@/components/pages/ParticulierPage").then((m) => m.ParticulierPage), {
  ssr: false,
  loading: ScreenLoading,
});
const ParentsPage = dynamic(() => import("@/components/pages/ParentsPage").then((m) => m.ParentsPage), {
  ssr: false,
  loading: ScreenLoading,
});
const AnnouncementsPage = dynamic(() => import("@/components/pages/AnnouncementsPage").then((m) => m.AnnouncementsPage), {
  ssr: false,
  loading: ScreenLoading,
});
const ExpensesPage = dynamic(() => import("@/components/pages/ExpensesPage").then((m) => m.ExpensesPage), {
  ssr: false,
  loading: ScreenLoading,
});
const AnalyticsPage = dynamic(() => import("@/components/pages/AnalyticsPage").then((m) => m.AnalyticsPage), {
  ssr: false,
  loading: ScreenLoading,
});
const CashPage = dynamic(() => import("@/components/pages/CashPage").then((m) => m.CashPage), {
  ssr: false,
  loading: ScreenLoading,
});
const ReportsPage = dynamic(() => import("@/components/pages/ReportsPage").then((m) => m.ReportsPage), {
  ssr: false,
  loading: ScreenLoading,
});
const SettingsPage = dynamic(() => import("@/components/pages/SettingsPage").then((m) => m.SettingsPage), {
  ssr: false,
  loading: ScreenLoading,
});
const StudentPages = dynamic(() => import("@/components/pages/StudentPages").then((m) => m.StudentPages), {
  ssr: false,
  loading: ScreenLoading,
});
const TeacherPages = dynamic(() => import("@/components/pages/TeacherPages").then((m) => m.TeacherPages), {
  ssr: false,
  loading: ScreenLoading,
});
const ParentPages = dynamic(() => import("@/components/pages/ParentPages").then((m) => m.ParentPages), {
  ssr: false,
  loading: ScreenLoading,
});

/** Les écrans que chaque rôle peut ouvrir — seuls ceux-là sont préchargés. */
const PRELOAD_BY_ROLE: Record<string, (keyof typeof loaders)[]> = {
  student: ["studentPortal"],
  teacher: ["teacherPortal"],
  parent: ["parentPortal"],
  reception: [
    "students", "attendance", "classes", "planner", "timetables", "subscriptions", "rooms",
    "birthdays", "independent", "particulier", "parents", "announcements", "subjects", "settings",
  ],
  admin: [
    "students", "attendance", "classes", "teachers", "cash", "planner", "timetables",
    "subscriptions", "rooms", "birthdays", "independent", "particulier", "parents",
    "announcements", "subjects", "administration", "expenses", "analytics", "reports", "settings",
  ],
};

let preloaded = false;

/** Précharge, un par un et seulement quand le navigateur est libre, les
 *  écrans que ce compte peut ouvrir. */
function usePreloadScreens(role: string) {
  useEffect(() => {
    if (preloaded) return;
    preloaded = true;
    const queue = [...(PRELOAD_BY_ROLE[role] ?? [])];
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    let cancelled = false;
    let handle: number | undefined;
    const next = () => {
      if (cancelled) return;
      const key = queue.shift();
      if (!key) return;
      void loaders[key]()
        .catch(() => undefined)
        .finally(schedule);
    };
    const schedule = () => {
      if (cancelled || queue.length === 0) return;
      handle = w.requestIdleCallback
        ? w.requestIdleCallback(next, { timeout: 4000 })
        : window.setTimeout(next, 300);
    };
    // Laisse d'abord l'écran courant s'afficher et les données arriver.
    const start = window.setTimeout(schedule, 2500);
    return () => {
      cancelled = true;
      window.clearTimeout(start);
      if (handle !== undefined) {
        if (w.cancelIdleCallback) w.cancelIdleCallback(handle);
        else window.clearTimeout(handle);
      }
      preloaded = false;
    };
  }, [role]);
}

/** Client-side role+slug dispatch for every module route. Kept separate from
 *  the route file so the page itself can stay a server component and export
 *  `generateStaticParams` (prerendered shells -> instant sidebar navigation). */
export function ModuleDispatcher({ slug }: { slug: string[] }) {
  const user = useSession((s) => s.user);
  const pageSlug = slug[0];

  const role = user?.role || "admin";
  usePreloadScreens(role);

  // 1. Student Portal Routing
  if (role === "student") {
    return <StudentPages slug={pageSlug} />;
  }

  // 2. Teacher Portal Routing
  if (role === "teacher") {
    return <TeacherPages slug={pageSlug} />;
  }

  // 3. Parent Portal Routing
  if (role === "parent") {
    return <ParentPages slug={pageSlug} />;
  }

  // 4. Admin / Reception Portal Routing
  //
  // LES ÉCRANS D'ARGENT NE SONT PAS DES ÉCRANS DE GUICHET
  // -----------------------------------------------------
  // Le menu d'un compte de réception n'y mène pas — mais retirer une entrée du
  // menu ne ferme pas l'URL : elle reste tapable, un signet la garde, un lien
  // envoyé par message la rouvre. Ces cinq écrans-là ne montrent QUE ce que
  // l'école gagne et ce que ses enseignants coûtent :
  //
  //   /teachers  · le pourcentage de chaque enseignant, son salaire, ses parts
  //   /workers   · la paie des travailleurs
  //   /analytics · les recettes agrégées
  //   /cash      · la caisse
  //   /reports   · les états financiers
  //
  // Ils rejoignent donc /expenses, fermé le premier, derrière la même réponse
  // lisible. Ce n'est pas la barrière de sécurité (celle-là vit dans les RLS) :
  // c'est ce qui fait que le guichet ne tombe plus dessus par accident.
  const directionOnly = (title: string, message: string) =>
    role === "admin" ? null : <RestrictedPage title={title} message={message} />;

  switch (pageSlug) {
    case "classes":
      return <ClassesPage />;
    case "planner":
      return <PlannerPage />;
    case "timetables":
      return <TimetablesPage />;
    case "rooms":
      return <RoomsPage />;
    case "subscriptions":
      return <SubscriptionsPage />;
    case "students":
      return <StudentsPage />;
    case "birthdays":
      return <BirthdaysPage />;
    case "attendance":
      return <AttendancePage />;
    case "teachers":
      return (
        directionOnly(
          "Enseignants — écran réservé à la direction",
          "Cet écran montre la rémunération de chaque enseignant (pourcentage, salaire, parts dues). Ces chiffres ne sont pas consultables depuis un compte de réception.",
        ) ?? <TeachersPage />
      );
    case "subjects":
      return <SubjectsPage />;
    case "workers":
    case "administration": // legacy slug — kept so old bookmarks keep working
      return (
        directionOnly(
          "Travailleurs — écran réservé à la direction",
          "La paie des travailleurs n'est pas consultable depuis un compte de réception.",
        ) ?? <AdministrationPage />
      );
    case "independent":
      return <IndependentPage />;
    case "particulier":
      return <ParticulierPage />;
    case "parents":
      return <ParentsPage />;
    case "announcements":
      return <AnnouncementsPage />;
    case "expenses":
      // Réservé à la direction. Le menu n'y mène plus pour un compte de
      // réception, mais l'URL reste tapable — et un signet la garde.
      return role === "admin" ? (
        <ExpensesPage />
      ) : (
        <RestrictedPage
          title="Dépenses — écran réservé à la direction"
          message="Les dépenses de l'école ne sont pas consultables depuis un compte de réception."
        />
      );
    case "analytics":
      return (
        directionOnly(
          "Analyses — écran réservé à la direction",
          "Les recettes de l'école ne sont pas consultables depuis un compte de réception.",
        ) ?? <AnalyticsPage />
      );
    case "cash":
      return (
        directionOnly(
          "Caisse — écran réservé à la direction",
          "Le cumul de la caisse n'est pas consultable depuis un compte de réception. Les encaissements se font depuis les écrans concernés (élèves, séances libres, particulier).",
        ) ?? <CashPage />
      );
    case "reports":
      return (
        directionOnly(
          "Rapports — écran réservé à la direction",
          "Les états financiers de l'école ne sont pas consultables depuis un compte de réception.",
        ) ?? <ReportsPage />
      );
    case "settings":
      return <SettingsPage />;
    default:
      return <ModulePlaceholder href={`/${slug.join("/")}`} />;
  }
}
