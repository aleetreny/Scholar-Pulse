import { XMLParser } from "fast-xml-parser";
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
});
const array = (value) =>
  value == null ? [] : Array.isArray(value) ? value : [value];
const clean = (value) =>
  String(typeof value === "object" ? (value?.["#text"] ?? "") : (value ?? ""))
    .replace(/\s+/g, " ")
    .trim();
const ID = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})$/i;
export function workArxivId(work) {
  const doi = (work.doi ?? "")
    .match(/10\.48550\/arxiv\.(.+)$/i)?.[1]
    ?.replace(/v\d+$/, "");
  if (doi && ID.test(doi)) return doi;
  for (const location of work.locations ?? []) {
    const id = location.landing_page_url?.match(
      /^https?:\/\/arxiv\.org\/abs\/(.+?)(?:v\d+)?$/i,
    )?.[1];
    if (id && ID.test(id)) return id;
  }
  return null;
}
export function parseMetadata(xml) {
  return array(parser.parse(xml)?.feed?.entry).flatMap((entry) => {
    const versionedId = clean(entry.id).replace(
      /^https?:\/\/arxiv\.org\/abs\//,
      "",
    );
    const id = versionedId.replace(/v\d+$/, "");
    if (!ID.test(id)) return [];
    return [
      {
        id,
        versionedId,
        title: clean(entry.title),
        abstract: clean(entry.summary),
        authors: array(entry.author)
          .map((author) => clean(author.name))
          .filter(Boolean),
        categories: array(entry.category)
          .map((category) => clean(category["@_term"]))
          .filter(Boolean),
        primaryCategory: clean(entry["arxiv:primary_category"]?.["@_term"]),
        doi: clean(entry["arxiv:doi"]) || null,
        journalRef: clean(entry["arxiv:journal_ref"]) || null,
        comment: clean(entry["arxiv:comment"]) || null,
      },
    ];
  });
}
async function boundedText(response) {
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 2_000_000) {
      await reader.cancel();
      throw new Error("Metadata response too large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
/** Canonical titles/bylines prevent index merges from relabelling an arXiv id. */
export async function canonicalize(data, origin, cache, ctx, fetchUpstream) {
  const ids = [
    ...new Set((data.results ?? []).map(workArxivId).filter(Boolean)),
  ];
  const known = new Map(),
    missing = [];
  const keyFor = (id) =>
    new Request(`${origin}/canonical/${encodeURIComponent(id)}`);
  await Promise.all(
    ids.map(async (id) => {
      const hit = await cache.match(keyFor(id));
      if (hit) known.set(id, await hit.json());
      else missing.push(id);
    }),
  );
  if (missing.length) {
    const url = new URL("https://export.arxiv.org/api/query");
    url.search = new URLSearchParams({
      id_list: missing.sort().join(","),
      max_results: String(missing.length),
    });
    try {
      const response = await fetchUpstream(url, {
        signal: AbortSignal.timeout(6000),
      });
      if (response.ok) {
        for (const paper of parseMetadata(await boundedText(response))) {
          if (!ids.includes(paper.id) || !paper.title) continue;
          known.set(paper.id, paper);
          ctx.waitUntil(
            cache.put(
              keyFor(paper.id),
              Response.json(paper, {
                headers: { "Cache-Control": "public, max-age=604800" },
              }),
            ),
          );
        }
      } else await response.body?.cancel();
    } catch {
      /* Metadata is optional; never change the result set or citation ordering. */
    }
  }
  return {
    ...data,
    results: (data.results ?? []).map((work) => {
      const metadata = known.get(workArxivId(work));
      return metadata ? { ...work, arxiv_metadata: metadata } : work;
    }),
  };
}
