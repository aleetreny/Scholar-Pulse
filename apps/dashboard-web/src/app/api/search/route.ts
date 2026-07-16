import { sanitizeCategoryTokens } from "@/lib/categories";
import { searchPapers } from "@/lib/server/arxiv";
import type { SearchSort } from "@/lib/types";

const SORTS = new Set<SearchSort>(["relevance", "recent", "updated"]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 300);
  const categoryRaw = sanitizeCategoryTokens(url.searchParams.get("cat") ?? "");
  const category = categoryRaw[0] ?? null;
  const sortRaw = url.searchParams.get("sort") ?? "relevance";
  const sort: SearchSort = SORTS.has(sortRaw as SearchSort)
    ? (sortRaw as SearchSort)
    : "relevance";
  const start = Math.max(0, Number.parseInt(url.searchParams.get("start") ?? "0", 10) || 0);
  const max = Math.min(
    50,
    Math.max(1, Number.parseInt(url.searchParams.get("max") ?? "25", 10) || 25),
  );

  if (!query && !category) {
    return Response.json(
      { error: "Provide a query via ?q= or a category via ?cat=" },
      { status: 400 },
    );
  }

  try {
    const results = await searchPapers(query, category, sort, start, max);
    return Response.json(results);
  } catch (error) {
    const message = error instanceof Error ? error.message : "arXiv request failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
