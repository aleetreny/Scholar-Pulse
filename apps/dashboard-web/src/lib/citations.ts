import type { Paper } from "@/lib/types";

function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function citeKey(paper: Paper): string {
  const author = lastName(paper.authors[0] ?? "arxiv")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  const year = paper.published.slice(0, 4) || "0000";
  const firstWord =
    paper.title
      .toLowerCase()
      .replace(/\\[a-z]+|[${}^_]/g, " ")
      .match(/[a-z]{3,}/)?.[0] ?? "paper";
  return `${author || "arxiv"}${year}${firstWord}`;
}

/** Escape only characters that break BibTeX fields; keep TeX math intact. */
function bibEscape(value: string): string {
  return value.replace(/([%&#])/g, "\\$1");
}

export function toBibtex(paper: Paper): string {
  const year = paper.published.slice(0, 4);
  const lines = [
    `@misc{${citeKey(paper)},`,
    `  title = {${bibEscape(paper.title)}},`,
    `  author = {${paper.authors.map(bibEscape).join(" and ")}},`,
    `  year = {${year}},`,
    `  eprint = {${paper.id}},`,
    `  archivePrefix = {arXiv},`,
    `  primaryClass = {${paper.primaryCategory}},`,
  ];
  if (paper.doi) {
    lines.push(`  doi = {${paper.doi}},`);
  }
  if (paper.journalRef) {
    lines.push(`  note = {${bibEscape(paper.journalRef)}},`);
  }
  lines.push(`  url = {${paper.absUrl}},`, `}`);
  return lines.join("\n");
}

/** APA-style plain-text citation, close enough for notes and drafts. */
export function toApaCitation(paper: Paper): string {
  const year = paper.published.slice(0, 4);
  const authors = paper.authors;
  let authorText: string;
  if (authors.length === 0) {
    authorText = "Unknown";
  } else if (authors.length === 1) {
    authorText = authors[0];
  } else if (authors.length === 2) {
    authorText = `${authors[0]} & ${authors[1]}`;
  } else if (authors.length <= 7) {
    authorText = `${authors.slice(0, -1).join(", ")}, & ${authors[authors.length - 1]}`;
  } else {
    authorText = `${authors.slice(0, 6).join(", ")}, ... ${authors[authors.length - 1]}`;
  }
  const venue = paper.journalRef ?? `arXiv preprint arXiv:${paper.id}`;
  return `${authorText} (${year}). ${paper.title}. ${venue}. ${paper.absUrl}`;
}

export function libraryToBibtex(papers: Paper[]): string {
  return papers.map(toBibtex).join("\n\n") + "\n";
}
