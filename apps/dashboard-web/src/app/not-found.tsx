"use client";

import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/states";

// Static export ships this as 404.html, which GitHub Pages serves for any
// unknown path — so it must look like the rest of the site.
export default function NotFound() {
  return (
    <div className="main__column">
      <EmptyState
        icon={FileQuestion}
        title="This page doesn't exist"
        body="The link may be old or mistyped. The feed, search, and your library are all still where they should be."
        action={
          <Link href="/" className="btn btn--primary">
            Back to your feed
          </Link>
        }
      />
    </div>
  );
}
