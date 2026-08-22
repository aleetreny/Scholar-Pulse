/** Which band of the ranking a paper landed in. */
export type PulseTier = "headline" | "notable" | "rest";

/** Evidence that was available when the paper was scored. */
export type PulseLane = "signals" | "references" | "reception";

export type PulseReason = {
  /** Signal name, as used by the model. See lib/ranking/signals.ts. */
  signal: string;
  /** Signed: positive means this signal pushed the paper up. */
  contribution: number;
};

/**
 * The ranking attached to a paper at build time.
 *
 * Computed by lib/ranking against the snapshot the paper appeared in, so it is
 * a standing among that field's recent submissions rather than an absolute
 * quantity. See research/ranking for how the model was fitted and validated.
 */
export type Pulse = {
  /** 0-100 percentile among comparable papers in the same field. */
  score: number;
  tier: PulseTier;
  /** Calibrated share of papers in this band that became references. */
  probability: number;
  lanes: PulseLane[];
  /** Nothing is known about any of its authors yet. */
  newcomer: boolean;
  /** The signals that moved it most, strongest first. */
  reasons: PulseReason[];
};

/**
 * Counts an external index reported when the site last built.
 *
 * They are written into the feed snapshot because the paper page could not
 * otherwise show them: Semantic Scholar's anonymous pool answers a browser
 * about one time in five, so a reader arriving at a paper usually saw nothing
 * at all where the citation and reference counts should be. The build already
 * asks for both in order to rank, four hundred papers per request and with a
 * key, so this costs one field per paper and no extra call.
 *
 * Stale by up to a week by construction. The page still asks Semantic Scholar
 * live and prefers the answer when it arrives; this is the floor, not the
 * ceiling.
 */
export type PaperMetrics = {
  /** Citations recorded at build time. Zero here is a measurement. */
  citations: number | null;
  /** Bibliography length. Null means not parsed yet, which is not zero. */
  references: number | null;
  /** When the build asked. */
  asOf: string;
};

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
  /** Present in feed snapshots; absent for papers fetched live from search. */
  pulse?: Pulse;
  /** Present in feed snapshots when the index answered for this paper. */
  metrics?: PaperMetrics;
};

export type FeedResponse = {
  papers: Paper[];
  totalResults: number;
  start: number;
};

export type SearchSort = "relevance" | "recent";

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
  referenceCount: number | null;
  venue: string | null;
  tldr: string | null;
  semanticScholarUrl: string | null;
  related: RelatedPaper[];
  /** Present when the enrichment service could not be reached. */
  partial: boolean;
};

/** One edge of the citation graph: a work this paper cites, or one citing it. */
export type GraphPaper = {
  title: string;
  authors: string[];
  year: number | null;
  arxivId: string | null;
  externalUrl: string | null;
  citationCount: number | null;
};

export type ReadingStatus = "to-read" | "reading" | "read";

export type LibraryEntry = {
  paper: Paper;
  savedAt: string;
  status: ReadingStatus;
  note: string;
};
