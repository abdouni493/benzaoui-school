/** Shown instantly in the content area while the next route segment loads,
 *  so the very first click on a sidebar item always gives visual feedback. */
export default function AppLoading() {
  return (
    <div className="flex h-full min-h-[50dvh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-line border-t-[var(--primary)]" />
        <span className="text-xs font-semibold text-muted">Chargement…</span>
      </div>
    </div>
  );
}
