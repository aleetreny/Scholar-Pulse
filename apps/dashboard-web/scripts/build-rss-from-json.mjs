import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CATEGORY_GROUPS } from "../src/lib/categories.ts";

const SITE_BASE_URL = (
  process.env.SITE_BASE_URL ?? "https://aleetreny.github.io/Scholar-Pulse"
).replace(/\/$/, "");

const RSS_ITEMS = 40;

const here = path.dirname(fileURLToPath(import.meta.url));
const feedDir = path.join(here, "..", "public", "data", "feed");
const rssDir = path.join(here, "..", "public", "data", "rss");

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toRss(category, label, papers, generatedAt) {
  const items = (papers || []).slice(0, RSS_ITEMS).map((paper) => {
    const link = `${SITE_BASE_URL}/paper/?id=${encodeURIComponent(paper.id)}`;
    const pubDate = paper.published ? new Date(paper.published).toUTCString() : new Date().toUTCString();
    const authors = Array.isArray(paper.authors) ? paper.authors.join(", ") : "";
    const description = `${authors} — ${paper.abstract || ""}`;

    return [
      "    <item>",
      `      <title>${xmlEscape(paper.title)}</title>`,
      `      <link>${xmlEscape(link)}</link>`,
      `      <guid isPermaLink="false">arxiv:${xmlEscape(paper.id)}</guid>`,
      `      <pubDate>${pubDate}</pubDate>`,
      `      <description>${xmlEscape(description)}</description>`,
      "    </item>",
    ].join("\n");
  });

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0">',
    "  <channel>",
    `    <title>ScholarPulse — ${xmlEscape(label)} (${xmlEscape(category)})</title>`,
    `    <link>${xmlEscape(SITE_BASE_URL)}/</link>`,
    `    <description>${xmlEscape(
      `The newest arXiv submissions in ${label}, via ScholarPulse.`,
    )}</description>`,
    `    <lastBuildDate>${new Date(generatedAt).toUTCString()}</lastBuildDate>`,
    items.join("\n"),
    "  </channel>",
    "</rss>",
    "",
  ].join("\n");
}

async function main() {
  await mkdir(rssDir, { recursive: true });
  const labelFor = new Map(
    CATEGORY_GROUPS.flatMap((group) =>
      group.categories.map(({ id, label }) => [id, label]),
    ),
  );

  const files = await readdir(feedDir);
  const jsonFiles = files.filter((f) => f.endsWith(".json"));

  console.log(`Generating RSS feeds for ${jsonFiles.length} categories...`);

  let count = 0;
  for (const file of jsonFiles) {
    const category = file.replace(/\.json$/, "");
    try {
      const content = await readFile(path.join(feedDir, file), "utf8");
      const snapshot = JSON.parse(content);
      const generatedAt = snapshot.fetchedAt || new Date().toISOString();
      const papers = snapshot.papers || [];
      const label = labelFor.get(category) ?? category;

      const xml = toRss(category, label, papers, generatedAt);
      await writeFile(path.join(rssDir, `${category}.xml`), xml);
      count++;
    } catch (err) {
      console.error(`Failed to generate RSS for ${category}:`, err);
    }
  }

  console.log(`Successfully generated ${count} RSS .xml files in public/data/rss/`);
}

main().catch(console.error);
