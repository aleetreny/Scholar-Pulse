import type { Paper, SearchSort } from "../types.ts";

const FIELD_PREFIXES: Record<number, string[]> = {
  17: ["cs."], 26: ["math.", "stat."],
  31: ["physics.", "astro-ph.", "cond-mat.", "hep-", "gr-qc", "quant-ph", "nucl-", "math-ph"],
  22: ["eess."], 13: ["q-bio.", "physics.bio-ph"],
  25: ["cond-mat.mtrl-sci"], 16: ["physics.chem-ph"], 20: ["econ.", "q-fin."],
};

export function categoryInField(category: string, fieldId: number | null): boolean {
  return fieldId === null || (FIELD_PREFIXES[fieldId] ?? []).some((prefix) => category.startsWith(prefix));
}

export function matchesSnapshot(paper: Paper, query: string, fieldId: number | null, byAuthor: boolean): boolean {
  if (![paper.primaryCategory, ...paper.categories].some((category) => categoryInField(category, fieldId))) return false;
  const needle = query.replace(/^"|"$/g, "").trim().toLowerCase();
  if (!needle) return !byAuthor;
  if (byAuthor) return paper.authors.some((author) => author.toLowerCase().includes(needle));
  return [paper.title, paper.abstract, ...paper.authors].some((text) => text.toLowerCase().includes(needle));
}

export function sortSnapshotMatches(papers: Paper[], sort: SearchSort): Paper[] {
  return [...papers].sort((a, b) => {
    if (sort === "citations") {
      const delta = (b.metrics?.citations ?? -1) - (a.metrics?.citations ?? -1);
      if (delta) return delta;
    }
    return b.published.localeCompare(a.published) || a.id.localeCompare(b.id);
  });
}
