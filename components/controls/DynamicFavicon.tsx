"use client";

import { useEffect, useRef } from "react";
import { useData } from "@/lib/store/data";

/** Points the browser tab icon at the school logo uploaded in Settings.
 *  The static app/icon.png (baked from the current logo) stays as the
 *  fallback until the school row is fetched.
 *
 *  ⚠️  We only manage link elements we ourselves created (tracked via refs).
 *  Removing arbitrary <link> nodes from <head> (as the old version did)
 *  causes React/Next.js to crash with `null.removeChild` because it tracked
 *  those server-rendered nodes in its fiber tree. */
export function DynamicFavicon() {
  const logo = useData((s) => s.school.logo);
  const iconRef = useRef<HTMLLinkElement | null>(null);
  const appleRef = useRef<HTMLLinkElement | null>(null);

  useEffect(() => {
    if (!logo) return;

    // Create or update our icon <link>
    if (!iconRef.current) {
      iconRef.current = document.createElement("link");
      iconRef.current.rel = "icon";
      iconRef.current.setAttribute("data-dynamic", "true");
      document.head.appendChild(iconRef.current);
    }
    iconRef.current.href = logo;

    // Create or update our apple-touch-icon <link>
    if (!appleRef.current) {
      appleRef.current = document.createElement("link");
      appleRef.current.rel = "apple-touch-icon";
      appleRef.current.setAttribute("data-dynamic", "true");
      document.head.appendChild(appleRef.current);
    }
    appleRef.current.href = logo;

    // Cleanup: only remove the elements WE created
    return () => {
      iconRef.current?.remove();
      iconRef.current = null;
      appleRef.current?.remove();
      appleRef.current = null;
    };
  }, [logo]);

  return null;
}
