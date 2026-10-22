import type { MetadataRoute } from "next";

// Written once at build time (the site is static files).
export const dynamic = "force-static";

const BASE = "https://wilm.ai";

export default function sitemap(): MetadataRoute.Sitemap {
  return (["", "/home", "/privacy"] as const).flatMap((section) => (["en", "fi"] as const).map((lang) => ({
    url: `${BASE}/${lang}${section}`,
    changeFrequency: "weekly",
    priority: section ? 0.7 : 1,
    alternates: {
      languages: {
        en: `${BASE}/en${section}`,
        fi: `${BASE}/fi${section}`
      }
    }
  })));
}
