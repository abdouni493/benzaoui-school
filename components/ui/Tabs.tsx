"use client";

import { motion } from "framer-motion";
import { useState } from "react";
import { cn } from "@/lib/utils";

export function Tabs({
  tabs,
}: {
  tabs: { id: string; label: string; content: React.ReactNode }[];
}) {
  const [active, setActive] = useState(tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 rounded-xl bg-canvas p-1">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActive(tab.id)}
            className={cn(
              "relative rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active === tab.id ? "text-white" : "text-muted hover:text-ink",
            )}
          >
            {active === tab.id && (
              <motion.span
                layoutId="tab-pill"
                className="absolute inset-0 -z-10 rounded-lg bg-gradient-primary"
                transition={{ type: "spring", stiffness: 380, damping: 30 }}
              />
            )}
            {tab.label}
          </button>
        ))}
      </div>
      <div>{current?.content}</div>
    </div>
  );
}
