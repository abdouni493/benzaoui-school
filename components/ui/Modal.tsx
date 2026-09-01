"use client";

import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Renders modal content into a portal at document.body so that
 *  it is never caught in a parent component's unmount cascade
 *  (which previously caused `null.removeChild` crashes when
 *  navigating away while a modal's host page was being destroyed). */
function ModalPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}

/** How much room the dialog gets. `wide` is kept as the historical shorthand
 *  for "lg"; `xl` and `full` are for the work-surfaces (teacher settlement,
 *  séances dues) where a cramped column made the numbers unreadable. */
export type ModalSize = "md" | "lg" | "xl" | "full";

const SIZES: Record<ModalSize, string> = {
  md: "max-w-lg",
  lg: "max-w-3xl",
  xl: "max-w-6xl",
  full: "max-w-[96rem]",
};

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
  size,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** one line under the title — what this dialog is for */
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
  size?: ModalSize;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <motion.div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          onClick={onClose}
        />
        <motion.div
          className={`relative z-10 w-full ${SIZES[size ?? (wide ? "lg" : "md")]} max-h-[92vh] overflow-y-auto rounded-2xl border border-line bg-surface card-shadow-lg`}
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
        >
          {title && (
            <div className="sticky top-0 z-20 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-base font-bold text-ink">{title}</h2>
                {subtitle && (
                  <p className="mt-0.5 text-[11px] leading-snug text-muted">{subtitle}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:bg-primary-50 hover:text-ink"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          <div className="p-5">{children}</div>
          {footer && (
            <div className="sticky bottom-0 flex justify-end gap-2 border-t border-line bg-surface px-5 py-3">
              {footer}
            </div>
          )}
        </motion.div>
      </div>
    </ModalPortal>
  );
}
