"use client";

import { motion } from "framer-motion";

const GRADIENTS = {
  primary: "bg-gradient-primary",
  success: "bg-gradient-success",
  warning: "bg-gradient-warning",
  danger: "bg-gradient-danger",
} as const;

export function StatCard({
  emoji,
  label,
  value,
  tone = "primary",
  index = 0,
}: {
  emoji: string;
  label: string;
  value: string | number;
  tone?: keyof typeof GRADIENTS;
  index?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.32 }}
      className={`${GRADIENTS[tone]} relative overflow-hidden rounded-2xl p-5 text-white card-shadow card-interactive`}
    >
      <span className="absolute -end-3 -top-3 text-6xl opacity-20">{emoji}</span>
      <p className="text-sm font-medium text-white/85">{label}</p>
      <p className="mt-2 text-2xl font-extrabold md:text-3xl">{value}</p>
    </motion.div>
  );
}
