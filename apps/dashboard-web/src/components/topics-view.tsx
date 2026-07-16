"use client";

import { Compass } from "lucide-react";
import Link from "next/link";

import { TopicPicker } from "@/components/topic-picker";
import { useHydrated, useTopics } from "@/lib/store";

export function TopicsView() {
  const { topics, toggleTopic } = useTopics();
  const mounted = useHydrated();

  return (
    <div className="main__column main__column--wide">
      <div className="page-head">
        <div>
          <h1>Topics you follow</h1>
          <p className="page-head__sub">
            {mounted && topics.length > 0
              ? `${topics.length} field${topics.length === 1 ? "" : "s"} feeding your home page.`
              : "Choose the arXiv fields that shape your feed."}
          </p>
        </div>
        <div className="page-head__actions">
          <Link href="/" className="btn btn--primary btn--small">
            <Compass />
            Go to feed
          </Link>
        </div>
      </div>

      {mounted ? <TopicPicker selected={topics} onToggle={toggleTopic} /> : null}
    </div>
  );
}
