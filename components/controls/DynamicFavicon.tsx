"use client";

import { useEffect } from "react";
import { useData } from "@/lib/store/data";

/** Points the browser tab icon at the school logo uploaded in Settings.
 *  The static app/icon.png (baked from the current logo) stays as the
 *  fallback until the school row is fetched. */
export function DynamicFavicon() {
  const logo = useData((s) => s.school.logo);

  useEffect(() => {
    if (!logo) return;
    document
      .querySelectorAll('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]')
      .forEach((el) => el.remove());
    const icon = document.createElement("link");
    icon.rel = "icon";
    icon.href = logo;
    document.head.appendChild(icon);
    const apple = document.createElement("link");
    apple.rel = "apple-touch-icon";
    apple.href = logo;
    document.head.appendChild(apple);
  }, [logo]);

  return null;
}
