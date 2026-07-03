export function EmptyState({
  emoji = "📭",
  message,
}: {
  emoji?: string;
  message: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line py-14 text-center">
      <span className="text-4xl opacity-70">{emoji}</span>
      <p className="text-sm text-muted">{message}</p>
    </div>
  );
}
