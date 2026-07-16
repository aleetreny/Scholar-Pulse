const DAY_MS = 24 * 60 * 60 * 1000;

const ABSOLUTE_DATE = new Intl.DateTimeFormat("en", {
  day: "numeric",
  month: "short",
  year: "numeric",
});

/** "2h ago" / "3d ago" for fresh papers, absolute date beyond two weeks. */
export function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60 * 60 * 1000) {
    return "just now";
  }
  if (elapsed < DAY_MS) {
    return `${Math.floor(elapsed / (60 * 60 * 1000))}h ago`;
  }
  if (elapsed < 14 * DAY_MS) {
    const days = Math.floor(elapsed / DAY_MS);
    return `${days}d ago`;
  }
  return ABSOLUTE_DATE.format(date);
}

export function formatAbsoluteDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return ABSOLUTE_DATE.format(date);
}

/** "Vaswani, Shazeer +6" style compact author line. */
export function formatAuthors(authors: string[], max = 3): string {
  if (authors.length === 0) {
    return "Unknown authors";
  }
  if (authors.length <= max) {
    return authors.join(", ");
  }
  return `${authors.slice(0, max).join(", ")} +${authors.length - max}`;
}

export function formatCount(value: number): string {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }
  if (value >= 10_000) {
    return `${Math.round(value / 1000)}k`;
  }
  if (value >= 1_000) {
    return `${(value / 1000).toFixed(1)}k`;
  }
  return String(value);
}
