"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/SearchInput";
import { Badge } from "@/components/ui/Badge";
import { useData, type ScanResult } from "@/lib/store/data";
import { studentName } from "@/lib/helpers";
import { useTranslation } from "@/lib/i18n/useTranslation";
import { formatDA } from "@/lib/utils";

export function ScanModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const scanCard = useData((s) => s.scanCard);
  const students = useData((s) => s.students);
  const [code, setCode] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);

  const doScan = async () => {
    if (!code.trim()) return;
    const res = await scanCard(code.trim());
    setResult(res);
    setCode("");
  };

  const student = result?.studentId
    ? students.find((s) => s.id === result.studentId)
    : undefined;

  return (
    <Modal
      open={open}
      onClose={() => {
        setResult(null);
        onClose();
      }}
      title={t("scan.title")}
    >
      <p className="mb-3 text-sm text-muted">{t("scan.instructions")}</p>
      <div className="flex gap-2">
        <Input
          autoFocus
          placeholder={t("scan.placeholder")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && doScan()}
        />
        <Button onClick={doScan}>{t("scan.button")}</Button>
      </div>

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={`mt-4 rounded-2xl border p-4 ${
            result.ok ? "border-success/30 bg-success/10" : "border-danger/30 bg-danger/10"
          }`}
        >
          <p className={`text-sm font-bold ${result.ok ? "text-success" : "text-danger"}`}>
            {result.ok ? "✅" : "⛔"} {t(result.messageKey)}
          </p>
          {student && (
            <div className="mt-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">{t("scan.student")}</span>
                <span className="font-semibold text-ink">{studentName(student)}</span>
              </div>
              {result.ok && (
                <div className="flex justify-between">
                  <span className="text-muted">{t("scan.deducted")}</span>
                  <span className="font-semibold text-danger">
                    {formatDA(result.cost ?? 0)}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between">
                <span className="text-muted">{t("scan.currentBalance")}</span>
                <Badge tone={student.balance < 0 ? "danger" : "success"}>
                  {formatDA(student.balance)}
                </Badge>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </Modal>
  );
}
