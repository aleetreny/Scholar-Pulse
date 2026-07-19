import type { MetadataRoute } from "next";

// Required for output:'export' — the manifest is a route handler underneath.
export const dynamic = "force-static";

// basePath is not applied to manifest fields automatically; prefix by hand
// so the installed app opens at the GitHub Pages subpath.
const base = process.env.PAGES_BASE_PATH ?? "";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ScholarPulse",
    short_name: "ScholarPulse",
    description:
      "A reading companion for arXiv: a daily feed of the fields you follow, search, citation graphs, and a local reading library.",
    start_url: `${base}/`,
    scope: `${base}/`,
    display: "standalone",
    background_color: "#f6f2e8",
    theme_color: "#f6f2e8",
    icons: [
      {
        src: `${base}/icon.svg`,
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
