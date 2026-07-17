"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { SearchX } from "lucide-react";

import { PaperView } from "@/components/paper-view";
import { EmptyState } from "@/components/states";

const ARXIV_ID = /^([a-z-]+(\.[A-Z]{2})?\/\d{7}|\d{4}\.\d{4,5})(v\d+)?$/;

export function PaperPageClient() {
  const params = useSearchParams();
  const rawId = (params.get("id") ?? "").trim();
  const arxivId = rawId.replace(/v\d+$/, "");

  if (!ARXIV_ID.test(rawId)) {
    return (
      <div className="main__column">
        <EmptyState
          icon={SearchX}
          title="No paper here"
          body="This link is missing a valid arXiv identifier."
          action={
            <Link href="/search" className="btn btn--primary">
              Search papers
            </Link>
          }
        />
      </div>
    );
  }

  return <PaperView key={arxivId} arxivId={arxivId} />;
}
