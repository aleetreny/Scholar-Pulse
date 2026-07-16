import type { Metadata } from "next";

import { PaperView } from "@/components/paper-view";

export const metadata: Metadata = {
  title: "Paper",
};

export default async function PaperPage({
  params,
}: {
  params: Promise<{ id: string[] }>;
}) {
  const { id } = await params;
  const arxivId = id.map(decodeURIComponent).join("/");
  return <PaperView arxivId={arxivId} />;
}
