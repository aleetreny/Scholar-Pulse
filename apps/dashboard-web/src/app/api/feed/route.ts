import { sanitizeCategoryTokens } from "@/lib/categories";
import { fetchLatestByCategories } from "@/lib/server/arxiv";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const categories = sanitizeCategoryTokens(url.searchParams.get("cats") ?? "");
  const start = Math.max(0, Number.parseInt(url.searchParams.get("start") ?? "0", 10) || 0);
  const max = Math.min(
    50,
    Math.max(1, Number.parseInt(url.searchParams.get("max") ?? "25", 10) || 25),
  );

  if (categories.length === 0) {
    return Response.json(
      { error: "Provide at least one category via ?cats=cs.LG,stat.ML" },
      { status: 400 },
    );
  }

  try {
    const feed = await fetchLatestByCategories(categories.slice(0, 24), start, max);
    return Response.json(feed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "arXiv request failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
