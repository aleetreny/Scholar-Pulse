import type { Paper } from "./types.ts";

export function makePaper(id: string, values: Partial<Paper> = {}): Paper {
  return { id, versionedId: `${id}v1`, title: "A result", abstract: "A shared abstract.",
    authors: ["Unknown author"], published: "2026-09-01T00:00:00Z", updated: "2026-09-01T00:00:00Z",
    primaryCategory: "cs.LG", categories: ["cs.LG"], doi: null, journalRef: null, comment: null,
    absUrl: `https://arxiv.org/abs/${id}`, pdfUrl: `https://arxiv.org/pdf/${id}`, ...values };
}
