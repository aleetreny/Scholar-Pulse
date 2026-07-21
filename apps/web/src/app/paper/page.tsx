import type { Metadata } from "next";
import { Suspense } from "react";

import { PaperPageClient } from "@/components/paper-page-client";
import { PaperListSkeleton } from "@/components/states";

export const metadata: Metadata = {
  title: "Paper",
};

// Static export cannot render dynamic /paper/<id> routes, so papers live at
// /paper?id=<arxiv-id>; the query string works on any static host.
export default function PaperPage() {
  return (
    <Suspense
      fallback={
        <div className="main__column">
          <PaperListSkeleton count={3} />
        </div>
      }
    >
      <PaperPageClient />
    </Suspense>
  );
}
