import type { Metadata } from "next";

import { PaperView } from "@/components/paper-view";
import { fetchPaperById } from "@/lib/server/arxiv";

type Props = { params: Promise<{ id: string[] }> };

const ARXIV_ID = /^([a-z-]+(\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?$/;

async function arxivIdFromParams(params: Props["params"]): Promise<string> {
  const { id } = await params;
  return id.map(decodeURIComponent).join("/");
}

/**
 * Server-side title/description so shared links unfurl with the actual
 * paper instead of a generic "Paper". Uses the same cached arXiv client
 * as /api/paper, so the client fetch that follows hits a warm cache.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const arxivId = await arxivIdFromParams(params);
  if (!ARXIV_ID.test(arxivId)) {
    return { title: "Paper" };
  }
  try {
    const paper = await fetchPaperById(arxivId.replace(/v\d+$/, ""));
    if (!paper) {
      return { title: "Paper" };
    }
    const description =
      paper.abstract.length > 240
        ? `${paper.abstract.slice(0, 239).trimEnd()}…`
        : paper.abstract;
    return {
      title: paper.title,
      description,
      openGraph: {
        title: paper.title,
        description,
        type: "article",
      },
    };
  } catch {
    return { title: "Paper" };
  }
}

export default async function PaperPage({ params }: Props) {
  const arxivId = await arxivIdFromParams(params);
  return <PaperView arxivId={arxivId} />;
}
