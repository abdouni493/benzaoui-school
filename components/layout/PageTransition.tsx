"use client";

import { usePathname } from "next/navigation";
import { motion } from "framer-motion";

/** Animates each route as it mounts. We deliberately do NOT use
 *  `AnimatePresence mode="wait"` here: with the App Router's client-side
 *  transitions, waiting for the outgoing page's exit animation can leave the
 *  swap "stuck" (its `onExitComplete` never fires), which showed up as
 *  navigation that only worked on the second click or after a refresh.
 *  Keying a plain `motion.div` on the pathname makes React unmount the old
 *  page and mount the new one immediately — the content is swapped instantly
 *  and simply fades in, never blocking the navigation. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
      className="h-full"
    >
      {children}
    </motion.div>
  );
}
