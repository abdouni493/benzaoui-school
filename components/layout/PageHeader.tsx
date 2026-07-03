import * as React from "react";

export function PageHeader({
  emoji,
  title,
  subtitle,
  actions,
}: {
  emoji?: string;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        {emoji && (
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-50 text-2xl">
            {emoji}
          </span>
        )}
        <div>
          <h1 className="text-xl font-bold text-ink md:text-2xl">{title}</h1>
          {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
