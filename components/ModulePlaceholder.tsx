"use client";

import { motion } from "framer-motion";
import { Card, CardBody } from "@/components/ui/Card";
import { PageHeader } from "@/components/layout/PageHeader";
import { navMetaForHref } from "@/lib/nav";
import { useTranslation } from "@/lib/i18n/useTranslation";

export function ModulePlaceholder({ href }: { href: string }) {
  const { t } = useTranslation();
  const meta = navMetaForHref(href);
  const title = meta ? t(`nav.${meta.key}`) : href.replace("/", "");

  return (
    <div>
      <PageHeader emoji={meta?.emoji ?? "🧩"} title={title} />
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
      >
        <Card gradient>
          <CardBody className="flex flex-col items-center gap-3 py-16 text-center">
            <span className="text-5xl">{meta?.emoji ?? "🚧"}</span>
            <h2 className="text-lg font-bold text-ink">{title}</h2>
            <p className="max-w-md text-sm text-muted">
              {t("common.moduleInProgress")}
            </p>
          </CardBody>
        </Card>
      </motion.div>
    </div>
  );
}
