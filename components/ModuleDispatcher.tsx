"use client";

import { useSession } from "@/lib/store/session";
import { ClassesPage } from "@/components/pages/ClassesPage";
import { PlannerPage } from "@/components/pages/PlannerPage";
import { TimetablesPage } from "@/components/pages/TimetablesPage";
import { RoomsPage } from "@/components/pages/RoomsPage";
import { SubscriptionsPage } from "@/components/pages/SubscriptionsPage";
import { StudentsPage } from "@/components/pages/StudentsPage";
import { BirthdaysPage } from "@/components/pages/BirthdaysPage";
import { AttendancePage } from "@/components/pages/AttendancePage";
import { TeachersPage } from "@/components/pages/TeachersPage";
import { SubjectsPage } from "@/components/pages/SubjectsPage";
import { AdministrationPage } from "@/components/pages/AdministrationPage";
import { IndependentPage } from "@/components/pages/IndependentPage";
import { ParticulierPage } from "@/components/pages/ParticulierPage";
import { ParentsPage } from "@/components/pages/ParentsPage";
import { AnnouncementsPage } from "@/components/pages/AnnouncementsPage";
import { ExpensesPage } from "@/components/pages/ExpensesPage";
import { AnalyticsPage } from "@/components/pages/AnalyticsPage";
import { CashPage } from "@/components/pages/CashPage";
import { ReportsPage } from "@/components/pages/ReportsPage";
import { SettingsPage } from "@/components/pages/SettingsPage";
import { StudentPages } from "@/components/pages/StudentPages";
import { TeacherPages } from "@/components/pages/TeacherPages";
import { ParentPages } from "@/components/pages/ParentPages";
import { ModulePlaceholder } from "@/components/ModulePlaceholder";
import { RestrictedPage } from "@/components/RestrictedPage";

/** Client-side role+slug dispatch for every module route. Kept separate from
 *  the route file so the page itself can stay a server component and export
 *  `generateStaticParams` (prerendered shells -> instant sidebar navigation). */
export function ModuleDispatcher({ slug }: { slug: string[] }) {
  const { user } = useSession();
  const pageSlug = slug[0];

  const role = user?.role || "admin";

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
