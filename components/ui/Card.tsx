import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({
  className,
  gradient,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { gradient?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-line card-shadow theme-fade card-interactive",
        gradient ? "bg-gradient-card" : "bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export function CardBody({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}
