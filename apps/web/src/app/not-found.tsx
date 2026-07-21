"use client";

import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/states";
import { useT } from "@/lib/i18n";

// Static export ships this as 404.html, which GitHub Pages serves for any
// unknown path — so it must look like the rest of the site.
export default function NotFound() {
  const { t } = useT();
  return (
    <div className="main__column">
      <EmptyState
        icon={FileQuestion}
        title={t("notFound.title")}
        body={t("notFound.body")}
        action={
          <Link href="/" className="btn btn--primary">
            {t("notFound.back")}
          </Link>
        }
      />
    </div>
  );
}
