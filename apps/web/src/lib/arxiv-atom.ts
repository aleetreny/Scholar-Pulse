import { XMLParser } from "fast-xml-parser";

import type { FeedResponse, Paper } from "@/lib/types";

/**
 * arXiv Atom parsing, shared by the snapshot builder script (Node).
 * The browser bundle must not import this — the arXiv API has no CORS
 * headers, so clients only ever see prebuilt JSON snapshots.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
});

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function collapseWhitespace(value: unknown): string {
  // Nodes that carry XML attributes parse as { "#text": ... } objects.
  if (value !== null && typeof value === "object" && "#text" in value) {
    value = (value as Record<string, unknown>)["#text"];
  }
  if (value === null || value === undefined || typeof value === "object") {
    return "";
  }
  return String(value).replace(/\s+/g, " ").trim();
}

/** "http://arxiv.org/abs/2401.12345v2" -> { id: "2401.12345", versionedId: "2401.12345v2" } */
function parseEntryId(rawUrl: string): { id: string; versionedId: string } {
  const tail = rawUrl.replace(/^https?:\/\/[^/]+\/abs\//, "");
  const versionedId = tail || rawUrl;
  const id = versionedId.replace(/v\d+$/, "");
  return { id, versionedId };
}

type AtomEntry = Record<string, unknown>;

function parseEntry(entry: AtomEntry): Paper {
  const { id, versionedId } = parseEntryId(collapseWhitespace(entry.id));

  const authors = asArray(entry.author as AtomEntry | AtomEntry[])
    .map((author) => collapseWhitespace((author as AtomEntry).name))
    .filter(Boolean);

  const categories = asArray(entry.category as AtomEntry | AtomEntry[])
    .map((category) => collapseWhitespace((category as AtomEntry)["@_term"]))
    .filter(Boolean);

  const primaryRaw = entry["arxiv:primary_category"] as AtomEntry | undefined;
  const primaryCategory =
    collapseWhitespace(primaryRaw?.["@_term"]) || categories[0] || "";

  let pdfUrl = "";
  for (const link of asArray(entry.link as AtomEntry | AtomEntry[])) {
    const linkRecord = link as AtomEntry;
    if (linkRecord["@_title"] === "pdf" || linkRecord["@_type"] === "application/pdf") {
      pdfUrl = collapseWhitespace(linkRecord["@_href"]);
      break;
    }
  }
  if (!pdfUrl) {
    pdfUrl = `https://arxiv.org/pdf/${versionedId}`;
  }

  const doiEntry = entry["arxiv:doi"] as AtomEntry | string | undefined;
  const doi = collapseWhitespace(
    typeof doiEntry === "object" ? doiEntry?.["#text"] : doiEntry,
  );
  const journalEntry = entry["arxiv:journal_ref"] as AtomEntry | string | undefined;
  const journalRef = collapseWhitespace(
    typeof journalEntry === "object" ? journalEntry?.["#text"] : journalEntry,
  );
  const commentEntry = entry["arxiv:comment"] as AtomEntry | string | undefined;
  const comment = collapseWhitespace(
    typeof commentEntry === "object" ? commentEntry?.["#text"] : commentEntry,
  );

  return {
    id,
    versionedId,
    title: collapseWhitespace(entry.title),
    abstract: collapseWhitespace(entry.summary),
    authors,
    published: collapseWhitespace(entry.published),
    updated: collapseWhitespace(entry.updated),
    primaryCategory,
    categories,
    doi: doi || null,
    journalRef: journalRef || null,
    comment: comment || null,
    pdfUrl,
    absUrl: `https://arxiv.org/abs/${id}`,
  };
}

/** Parse an arXiv API Atom document into the app's feed shape. */
export function parseArxivFeed(xml: string): FeedResponse {
  const doc = parser.parse(xml) as { feed?: AtomEntry };
  const feed = doc.feed ?? {};

  const papers = asArray(feed.entry as AtomEntry | AtomEntry[])
    .map((entry) => parseEntry(entry as AtomEntry))
    // arXiv reports errors as a single entry whose id points at /api/errors.
    .filter((paper) => paper.id && !paper.id.includes("api/errors"));

  const totalRaw = feed["opensearch:totalResults"] as AtomEntry | string | number | undefined;
  const totalText =
    typeof totalRaw === "object" ? totalRaw?.["#text"] : totalRaw;
  const totalResults = Number.parseInt(String(totalText ?? papers.length), 10) || papers.length;

  const startRaw = feed["opensearch:startIndex"] as AtomEntry | string | number | undefined;
  const startText =
    typeof startRaw === "object" ? startRaw?.["#text"] : startRaw;
  const start = Number.parseInt(String(startText ?? 0), 10) || 0;

  return { papers, totalResults, start };
}
