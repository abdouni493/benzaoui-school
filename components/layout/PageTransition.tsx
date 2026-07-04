"use client";

/** Simple wrapper that applies an entry animation to each page.
 *  
 *  ⚠️  DO NOT use `key={pathname}` here. Changing the key forces React to
 *  destroy and re-create the entire subtree on every navigation. During the
 *  destruction phase, deeply nested components (modals, framer-motion nodes)
 *  try to call removeChild on DOM nodes that their parent already removed,
 *  causing the infamous `Cannot read properties of null ('removeChild')` crash.
 *  That crash corrupts React's reconciler and makes subsequent state updates
 *  (like opening the sidebar) silently fail.
 *
 *  Instead we just apply a CSS animation on the wrapper. Next.js App Router
 *  already handles swapping the {children} content on navigation — there is
 *  no need for us to force a remount via key. */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full animate-page-fade">
      {children}
    </div>
  );
}
