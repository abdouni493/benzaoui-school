"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { PageTransition } from "./PageTransition";
import { useSession } from "@/lib/store/session";
import { useSettings } from "@/lib/store/settings";

import { GlobalRFIDListener } from "@/components/controls/GlobalRFIDListener";

export function AppShell({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const router = useRouter();
  const user = useSession((s) => s.user);
  const hydrated = useSession((s) => s.hydrated);
  const isRTL = useSettings((s) => s.language) === "ar";

  useEffect(() => {
    if (hydrated && !user) router.replace("/login");
  }, [hydrated, user, router]);

  // Don't render the shell (and thus every page below it) until the
  // Supabase session has actually resolved. Rendering early with a
  // momentarily-null user made pages that read the user/school once at
  // mount (e.g. Settings) latch onto empty defaults on every refresh.
  if (!hydrated || !user) return null;

  return (
    <div className="flex h-dvh overflow-hidden bg-canvas">
      <GlobalRFIDListener />
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile drawer */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              className="fixed inset-0 z-40 bg-black/40 lg:hidden"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              className="fixed inset-y-0 z-50 lg:hidden ltr:left-0 rtl:right-0"
              initial={{ x: isRTL ? "100%" : "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: isRTL ? "100%" : "-100%" }}
              transition={{ type: "spring", stiffness: 360, damping: 38 }}
            >
              <Sidebar onNavigate={() => setMobileOpen(false)} />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar onMenu={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <PageTransition>
            <div className="mx-auto w-full max-w-7xl p-4 md:p-6">{children}</div>
          </PageTransition>
        </main>
      </div>
    </div>
  );
}
