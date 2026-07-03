"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-y-1/2 text-muted ltr:left-3 rtl:right-3" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-10 w-full rounded-xl border border-line bg-surface text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-primary ltr:pl-9 ltr:pr-3 rtl:pr-9 rtl:pl-3"
      />
    </div>
  );
}

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-primary",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-10 rounded-xl border border-line bg-surface px-3 text-sm text-ink outline-none transition-colors focus:border-primary",
        className,
      )}
      {...props}
    />
  );
}
