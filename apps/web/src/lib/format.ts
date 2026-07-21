import type { Lang } from "@/lib/store";

const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_LOCALE: Record<Lang, string> = { en: "en", es: "es" };

const absoluteFormats = new Map<Lang, Intl.DateTimeFormat>();

function absoluteFormat(lang: Lang): Intl.DateTimeFormat {
  let format = absoluteFormats.get(lang);
  if (!format) {
    format = new Intl.DateTimeFormat(DATE_LOCALE[lang], {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
    absoluteFormats.set(lang, format);
  }
  return format;
}

const RELATIVE_STRINGS: Record<Lang, { justNow: string; hours: string; days: string }> = {
  en: { justNow: "just now", hours: "{n}h ago", days: "{n}d ago" },
  es: { justNow: "ahora mismo", hours: "hace {n} h", days: "hace {n} d" },
};

/** "2h ago" / "3d ago" for fresh papers, absolute date beyond two weeks. */
export function formatRelativeDate(iso: string, lang: Lang = "en"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const strings = RELATIVE_STRINGS[lang];
  const elapsed = Date.now() - date.getTime();
  if (elapsed < 60 * 60 * 1000) {
    return strings.justNow;
  }
  if (elapsed < DAY_MS) {
    return strings.hours.replace("{n}", String(Math.floor(elapsed / (60 * 60 * 1000))));
  }
  if (elapsed < 14 * DAY_MS) {
    return strings.days.replace("{n}", String(Math.floor(elapsed / DAY_MS)));
  }
  return absoluteFormat(lang).format(date);
}

export function formatAbsoluteDate(iso: string, lang: Lang = "en"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return absoluteFormat(lang).format(date);
}

/** "Vaswani, Shazeer +6" style compact author line. */
export function formatAuthors(
  authors: string[],
  max = 3,
  unknownLabel = "Unknown authors",
): string {
  if (authors.length === 0) {
    return unknownLabel;
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
