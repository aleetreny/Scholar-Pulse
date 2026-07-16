import type { Paper, Theme } from "@/lib/showroom";

export type DateRange = "all" | "24h" | "3d";
export type SortMode = "relevance" | "newest" | "title";
export type WorkspaceMode = "discover" | "saved";

export type PaperMatch = {
  paper: Paper;
  score: number;
  matchedIn: string[];
};

export type RelatedPaper = {
  paper: Paper;
  reason: string;
  score: number;
};

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "among",
  "based",
  "from",
  "into",
  "method",
  "paper",
  "study",
  "that",
  "their",
  "these",
  "this",
  "using",
  "with",
]);

export function formatIssueDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  })
    .format(new Date(value))
    .toUpperCase();
}

export function formatPaperDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  })
    .format(new Date(value))
    .toUpperCase();
}

export function authorLine(authors: string[], limit = 3): string {
  if (authors.length <= limit) return authors.join(", ");
  return `${authors.slice(0, limit).join(", ")} +${authors.length - limit}`;
}

export function tokenize(value: string): string[] {
  return Array.from(
    new Set(
      (value.toLocaleLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) ?? []).filter(
        (token) => !STOP_WORDS.has(token),
      ),
    ),
  );
}

export function matchPaper(paper: Paper, theme: Theme, query: string): PaperMatch {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const tokens = tokenize(normalizedQuery);
  if (!normalizedQuery || tokens.length === 0) {
    return { paper, score: 1, matchedIn: [] };
  }

  const fields = [
    { label: "title", value: paper.title.toLocaleLowerCase(), weight: 8 },
    { label: "field", value: `${theme.name} ${theme.shortName}`.toLocaleLowerCase(), weight: 6 },
    { label: "category", value: paper.categories.join(" ").toLocaleLowerCase(), weight: 5 },
    { label: "author", value: paper.authors.join(" ").toLocaleLowerCase(), weight: 3 },
    { label: "abstract", value: paper.summary.toLocaleLowerCase(), weight: 1 },
  ] as const;

  let score = 0;
  const matchedIn = new Set<string>();
  for (const token of tokens) {
    for (const field of fields) {
      if (field.value.includes(token)) {
        score += field.weight;
        matchedIn.add(field.label);
      }
    }
  }
  if (paper.title.toLocaleLowerCase().includes(normalizedQuery)) score += 20;

  return { paper, score, matchedIn: Array.from(matchedIn) };
}

export function ageInHours(publishedAt: string, generatedAt: string): number {
  return Math.max(
    0,
    (new Date(generatedAt).getTime() - new Date(publishedAt).getTime()) / 3_600_000,
  );
}

export function findRelatedPapers(paper: Paper, papers: Paper[], limit = 3): RelatedPaper[] {
  const sourceTokens = new Set(tokenize(`${paper.title} ${paper.summary}`).slice(0, 40));
  const sourceCategories = new Set(paper.categories);

  return papers
    .filter((candidate) => candidate.id !== paper.id)
    .map((candidate) => {
      const sharedCategories = candidate.categories.filter((category) => sourceCategories.has(category));
      const sharedTerms = tokenize(candidate.title).filter((term) => sourceTokens.has(term));
      const sameTheme = candidate.themeId === paper.themeId;
      const score = sharedCategories.length * 8 + sharedTerms.length * 3 + (sameTheme ? 2 : 0);
      let reason = "Same research field";
      if (sharedCategories.length > 0) reason = `Shared category: ${sharedCategories[0]}`;
      else if (sharedTerms.length > 0) reason = `Shared concept: ${sharedTerms.slice(0, 2).join(", ")}`;
      return { paper: candidate, reason, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function makeBibtex(paper: Paper): string {
  const year = new Date(paper.publishedAt).getUTCFullYear();
  const firstAuthor = paper.authors[0] ?? "unknown";
  const surname = firstAuthor.split(" ").at(-1)?.replace(/[^a-z0-9]/gi, "") || "unknown";
  const key = `${surname.toLocaleLowerCase()}${year}${paper.id.replace(/[^a-z0-9]/gi, "")}`;
  const title = paper.title.replace(/[{}]/g, "");
  return `@misc{${key},\n  title = {${title}},\n  author = {${paper.authors.join(" and ")}},\n  year = {${year}},\n  eprint = {${paper.id.replace(/v\d+$/, "")}},\n  archivePrefix = {arXiv},\n  primaryClass = {${paper.primaryCategory}},\n  url = {${paper.arxivUrl}}\n}`;
}
