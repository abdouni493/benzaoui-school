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

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
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
          className={`relative z-10 w-full ${wide ? "max-w-3xl" : "max-w-lg"} max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-surface card-shadow-lg`}
          initial={{ opacity: 0, scale: 0.95, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 28 }}
        >
          {title && (
            <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-5 py-4">
              <h2 className="text-base font-bold text-ink">{title}</h2>
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
