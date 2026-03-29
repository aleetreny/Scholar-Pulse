const TOPIC_TOKEN_PATTERN = /[A-Za-z0-9][A-Za-z0-9.-]*/g;

function uniqueTokens(tokens: string[]): string[] {
  return Array.from(new Set(tokens.filter(Boolean)));
}

export function parseTopicTokens(raw: string | string[]): string[] {
  if (Array.isArray(raw)) {
    return uniqueTokens(raw.flatMap((value) => parseTopicTokens(value)));
  }

  const matches = raw.match(TOPIC_TOKEN_PATTERN);
  return uniqueTokens(matches ?? []);
}

export function summarizeTopicGroup(raw: string): {
  title: string;
  meta: string;
} {
  const tokens = parseTopicTokens(raw);

  if (tokens.length === 0) {
    const fallback = raw.trim() || "Unknown topic";
    return {
      title: fallback,
      meta: "1 topic",
    };
  }

  const visibleTokens = tokens.slice(0, 3);
  const remaining = tokens.length - visibleTokens.length;

  return {
    title: visibleTokens.join(" · "),
    meta: remaining > 0 ? `+${remaining} more topics` : `${tokens.length} topic${tokens.length === 1 ? "" : "s"}`,
  };
}

export function formatTopicLine(raw: string | string[]): string {
  const tokens = parseTopicTokens(raw);
  return tokens.length > 0 ? tokens.join(" · ") : "No topic labels";
}

export function formatTopicList(raw: string | string[]): string[] {
  return parseTopicTokens(raw);
}