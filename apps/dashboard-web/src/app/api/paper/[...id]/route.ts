import { fetchPaperById } from "@/lib/server/arxiv";

/** Old-style ids like "math/0211159" contain a slash, hence the catch-all. */
const ARXIV_ID = /^([a-z-]+(\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string[] }> },
) {
  const { id } = await params;
  const arxivId = id.map(decodeURIComponent).join("/");

  if (!ARXIV_ID.test(arxivId)) {
    return Response.json({ error: "Invalid arXiv id" }, { status: 400 });
  }

  try {
    const paper = await fetchPaperById(arxivId);
    if (!paper) {
      return Response.json({ error: "Paper not found" }, { status: 404 });
    }
    return Response.json({ paper });
  } catch (error) {
    const message = error instanceof Error ? error.message : "arXiv request failed";
    return Response.json({ error: message }, { status: 502 });
  }
}
