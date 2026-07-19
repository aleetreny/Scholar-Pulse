import type { Paper, Theme } from "@/lib/showroom";

export type WorkspaceMode = "latest" | "saved";

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

export type ActivityPoint = {
  count: number;
  date: string;
  label: string;
};

const STOP_WORDS = new Set([
  "about", "across", "after", "all", "also", "among", "analysis", "and", "approach",
  "are", "based", "between", "can", "data", "different", "effect", "effects", "efficient",
  "evidence", "for", "framework", "from", "general", "has", "high", "how", "into", "large",
  "learning", "method", "model", "models", "more", "new", "novel", "over", "paper", "problem",
  "proposed", "provides", "results", "show", "study", "system", "that", "the", "their", "these",
  "this", "through", "toward", "towards", "using", "via", "was", "were", "which", "while",
  "with", "without",
]);

export function formatIssueDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

export function formatPaperDate(value: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value));
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

export function getThemeSignals(papers: Paper[], limit = 4): string[] {
  const counts = new Map<string, number>();
  for (const paper of papers) {
    for (const token of tokenize(paper.title)) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([token]) => token);
}

export function getActivity(papers: Paper[], generatedAt: string, days = 7): ActivityPoint[] {
  const end = new Date(generatedAt);
  end.setUTCHours(0, 0, 0, 0);

  return Array.from({ length: days }, (_, index) => {
    const date = new Date(end);
    date.setUTCDate(end.getUTCDate() - (days - index - 1));
    const key = date.toISOString().slice(0, 10);
    return {
      count: papers.filter((paper) => paper.publishedAt.slice(0, 10) === key).length,
      date: key,
      label: new Intl.DateTimeFormat("en-GB", {
        weekday: "short",
        timeZone: "UTC",
      }).format(date),
    };
  });
}

export function formatCoverage(papers: Paper[]): string {
  if (papers.length === 0) return "No papers";
  const dates = papers.map((paper) => paper.publishedAt).sort();
  const oldest = formatPaperDate(dates[0]);
  const newest = formatPaperDate(dates[dates.length - 1]);
  return oldest === newest ? newest : `${oldest} – ${newest}`;
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
  const matchedTokens = new Set<string>();
  for (const token of tokens) {
    for (const field of fields) {
      if (field.value.includes(token)) {
        score += field.weight;
        matchedIn.add(field.label);
        matchedTokens.add(token);
      }
    }
  }
  if (matchedTokens.size < tokens.length) {
    return { paper, score: 0, matchedIn: [] };
  }
  if (paper.title.toLocaleLowerCase().includes(normalizedQuery)) score += 20;

  return { paper, score, matchedIn: Array.from(matchedIn) };
}

export function findRelatedPapers(paper: Paper, papers: Paper[], limit = 3): RelatedPaper[] {
  const sourceTokens = new Set(tokenize(`${paper.title} ${paper.summary}`).slice(0, 50));
  const sourceCategories = new Set(paper.categories);

  return papers
    .filter((candidate) => candidate.id !== paper.id)
    .map((candidate) => {
      const sharedCategories = candidate.categories.filter((category) => sourceCategories.has(category));
      const sharedTerms = tokenize(candidate.title).filter((term) => sourceTokens.has(term));
      const sameTheme = candidate.themeId === paper.themeId;
      const score = sharedCategories.length * 8 + sharedTerms.length * 3 + (sameTheme ? 2 : 0);
      let reason = "Same field";
      if (sharedCategories.length > 0) reason = `Shared category · ${sharedCategories[0]}`;
      else if (sharedTerms.length > 0) reason = `Shared concept · ${sharedTerms.slice(0, 2).join(", ")}`;
      return { paper: candidate, reason, score };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function makeBibtex(paper: Paper): string {
  const year = new Date(paper.publishedAt).getUTCFullYear();
  const firstAuthor = paper.authors[0] ?? "unknown";
  const nameParts = firstAuthor.split(" ");
  const surname = nameParts[nameParts.length - 1]?.replace(/[^a-z0-9]/gi, "") || "unknown";
  const key = `${surname.toLocaleLowerCase()}${year}${paper.id.replace(/[^a-z0-9]/gi, "")}`;
  const title = paper.title.replace(/[{}]/g, "");
  return `@misc{${key},\n  title = {${title}},\n  author = {${paper.authors.join(" and ")}},\n  year = {${year}},\n  eprint = {${paper.id.replace(/v\d+$/, "")}},\n  archivePrefix = {arXiv},\n  primaryClass = {${paper.primaryCategory}},\n  url = {${paper.arxivUrl}}\n}`;
}
