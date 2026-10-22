import type { MetadataRoute } from "next";

// Written once at build time (the site is static files).
export const dynamic = "force-static";

export default function robots(): MetadataRoute.Robots {
  return {
    // The download buttons' addresses aren't pages, and a crawler following them would count as a download.
    rules: { userAgent: "*", allow: "/", disallow: "/get/" },
    sitemap: "https://wilm.ai/sitemap.xml"
  };
}
