/**
 * Papers live at /paper?id=<arxiv-id> (static export cannot serve dynamic
 * path segments). Old-style ids contain a slash, so the id must always be
 * URI-encoded — every link goes through here to keep that true.
 */
export function paperHref(arxivId: string): string {
  return `/paper?id=${encodeURIComponent(arxivId)}`;
}
