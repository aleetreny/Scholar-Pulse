import type { Metadata } from "next";
import { Suspense } from "react";

import { SearchView } from "@/components/search-view";
import { PaperListSkeleton } from "@/components/states";

export const metadata: Metadata = {
  title: "Search",
};

export default function SearchPage() {
  return (
    <Suspense
      fallback={
        <div className="main__column">
          <PaperListSkeleton />
        </div>
      }
    >
      <SearchView />
    </Suspense>
  );
}
