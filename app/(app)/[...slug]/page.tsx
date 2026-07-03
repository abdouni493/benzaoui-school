import { ModuleDispatcher } from "@/components/ModuleDispatcher";
import { NAV_BY_ROLE } from "@/lib/nav";

/** Prerender every known module route at build time so sidebar clicks are
 *  served (and prefetched) from the static cache instead of waiting on a
 *  server round-trip — this is what made navigation feel like it needed two
 *  clicks. Unknown slugs still render on demand (ModulePlaceholder). */
export function generateStaticParams() {
  const slugs = new Set<string>();
  for (const items of Object.values(NAV_BY_ROLE)) {
    for (const item of items) {
      if (item.action === "logout") continue;
      const slug = item.href.replace(/^\//, "");
      if (slug && slug !== "dashboard") slugs.add(slug);
    }
  }
  return [...slugs].map((s) => ({ slug: [s] }));
}

export default async function ModuleCatchAll({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;
  return <ModuleDispatcher slug={slug} />;
}
