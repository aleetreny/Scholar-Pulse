export type Paper = {
  /** Bare arXiv id without version, e.g. "2401.12345" or "math/0211159". */
  id: string;
  /** Id with version suffix as returned by the API, e.g. "2401.12345v2". */
  versionedId: string;
  title: string;
  abstract: string;
  authors: string[];
  published: string;
  updated: string;
  primaryCategory: string;
  categories: string[];
  doi: string | null;
  journalRef: string | null;
  comment: string | null;
  pdfUrl: string;
  absUrl: string;
};

export type FeedResponse = {
  papers: Paper[];
  totalResults: number;
  start: number;
};

export type SearchSort = "relevance" | "recent" | "updated";

export type RelatedPaper = {
  title: string;
  authors: string[];
  year: number | null;
  arxivId: string | null;
  externalUrl: string | null;
  abstractSnippet: string | null;
};

export type PaperExtras = {
  citationCount: number | null;
  influentialCitationCount: number | null;
  venue: string | null;
  tldr: string | null;
  semanticScholarUrl: string | null;
  related: RelatedPaper[];
  /** Present when the enrichment service could not be reached. */
  partial: boolean;
};

export type ReadingStatus = "to-read" | "reading" | "read";

export type LibraryEntry = {
  paper: Paper;
  savedAt: string;
  status: ReadingStatus;
  note: string;
};
