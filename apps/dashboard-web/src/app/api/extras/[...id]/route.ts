import { fetchPaperExtras } from "@/lib/server/semantic-scholar";

const ARXIV_ID = /^([a-z-]+(\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?$/;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string[] }> },
) {
  const { id } = await params;
  const arxivId = id.map(decodeURIComponent).join("/").replace(/v\d+$/, "");

  if (!ARXIV_ID.test(arxivId)) {
    return Response.json({ error: "Invalid arXiv id" }, { status: 400 });
  }

  const extras = await fetchPaperExtras(arxivId);
  return Response.json(extras);
}
