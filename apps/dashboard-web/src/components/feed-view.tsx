"use client";

import { Activity, ArrowRight, Loader2, Rss, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { PaperCard } from "@/components/paper-card";
import { EmptyState, ErrorBox, PaperListSkeleton } from "@/components/states";
import { TopicPicker } from "@/components/topic-picker";
import { categoryLabel } from "@/lib/categories";
import { getFeed } from "@/lib/client-api";
import { useHydrated, useTopics } from "@/lib/store";
import { PAGE_SIZE, usePaginatedPapers } from "@/lib/use-papers";

function Onboarding() {
  const { topics, setTopics } = useTopics();
  const [draft, setDraft] = useState<string[]>(topics);

  return (
    <div className="onboard">
      <span className="onboard__mark">
        <Activity size={30} strokeWidth={2.3} />
      </span>
      <h1>What are you researching?</h1>
      <p>
        Pick the fields you care about and ScholarPulse turns them into a daily
        feed of the newest papers on arXiv — searchable, citable, and yours to
        collect.
      </p>

      <div className="onboard__topics">
        <TopicPicker
          selected={draft}
          onToggle={(id) =>
            setDraft((current) =>
              current.includes(id)
                ? current.filter((value) => value !== id)
                : [...current, id],
            )
          }
        />
      </div>

      <div className="onboard__cta">
        <button
          type="button"
          className="btn btn--primary"
          disabled={draft.length === 0}
          onClick={() => setTopics(draft)}
        >
          {draft.length === 0
            ? "Pick at least one field"
            : `Build my feed (${draft.length} ${draft.length === 1 ? "field" : "fields"})`}
          <ArrowRight />
        </button>
      </div>
    </div>
  );
}

function Feed({ topics }: { topics: string[] }) {
  const [focusRaw, setFocus] = useState<string | null>(null);
  // A focused topic the user stopped following silently falls back to "all".
  const focus = focusRaw && topics.includes(focusRaw) ? focusRaw : null;

  const activeCategories = useMemo(
    () => (focus ? [focus] : topics),
    [focus, topics],
  );

  const queryKey = activeCategories.join(",");
  const fetchPage = useCallback(
    (start: number, signal: AbortSignal) =>
      getFeed(queryKey.split(","), start, PAGE_SIZE, signal),
    [queryKey],
  );

  const { papers, loading, loadingMore, error, hasMore, loadMore, retry } =
    usePaginatedPapers(fetchPage, queryKey, activeCategories.length > 0);

  return (
    <div className="main__column">
      <div className="page-head">
        <div>
          <h1>For you</h1>
          <p className="page-head__sub">
            The newest submissions across the fields you follow.
          </p>
        </div>
        <div className="page-head__actions">
          <Link href="/topics" className="btn btn--ghost btn--small">
            <SlidersHorizontal />
            Edit topics
          </Link>
        </div>
      </div>

      <div className="feed-toolbar">
        <div className="feed-toolbar__topics" role="group" aria-label="Filter by topic">
          <button
            type="button"
            className="topic-pill"
            data-active={focus === null}
            aria-pressed={focus === null}
            onClick={() => setFocus(null)}
          >
            All fields
          </button>
          {topics.map((id) => (
            <button
              key={id}
              type="button"
              className="topic-pill"
              data-active={focus === id}
              aria-pressed={focus === id}
              onClick={() => setFocus((current) => (current === id ? null : id))}
              title={id}
            >
              {categoryLabel(id)}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <PaperListSkeleton />
      ) : error ? (
        <ErrorBox
          message={`Couldn't reach arXiv right now. ${error}`}
          onRetry={retry}
        />
      ) : papers.length === 0 ? (
        <EmptyState
          icon={Rss}
          title="Nothing here yet"
          body="arXiv returned no recent papers for this selection. Try another topic or widen your feed."
        />
      ) : (
        <>
          <div className="paper-list">
            {papers.map((paper) => (
              <PaperCard key={paper.id} paper={paper} />
            ))}
          </div>
          {hasMore ? (
            <div className="load-more">
              <button
                type="button"
                className="btn"
                onClick={loadMore}
                disabled={loadingMore}
              >
                {loadingMore ? <Loader2 className="spin" /> : null}
                {loadingMore ? "Loading" : "Load more papers"}
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

export function FeedView() {
  const { topics } = useTopics();
  const hydrated = useHydrated();

  // localStorage is unavailable during SSR; wait for hydration before
  // deciding between the onboarding hero and the feed to avoid a flash.
  if (!hydrated) {
    return (
      <div className="main__column">
        <PaperListSkeleton />
      </div>
    );
  }

  if (topics.length === 0) {
    return (
      <div className="main__column main__column--wide">
        <Onboarding />
      </div>
    );
  }

  return <Feed topics={topics} />;
}
