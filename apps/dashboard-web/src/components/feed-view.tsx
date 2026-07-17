"use client";

import { ArrowRight, Loader2, Rss, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { PaperCard } from "@/components/paper-card";
import { EmptyState, ErrorBox, PaperListSkeleton } from "@/components/states";
import { TopicPicker } from "@/components/topic-picker";
import { categoryLabel } from "@/lib/categories";
import { getFeed, getManifest } from "@/lib/data/feed";
import { formatRelativeDate } from "@/lib/format";
import { useHydrated, useTopics } from "@/lib/store";
import { PAGE_SIZE, usePaginatedPapers } from "@/lib/use-papers";

function Onboarding() {
  const { topics, setTopics } = useTopics();
  const [draft, setDraft] = useState<string[]>(topics);

  return (
    <div className="onboard">
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

const LAST_VISIT_KEY = "scholarpulse.feed-last-visit.v1";

function Feed({ topics }: { topics: string[] }) {
  const [focusRaw, setFocus] = useState<string | null>(null);
  // A focused topic the user stopped following silently falls back to "all".
  const focus = focusRaw && topics.includes(focusRaw) ? focusRaw : null;

  // What was new when this visit started; recorded once, so the markers
  // stay stable while the user browses. (Feed only mounts post-hydration.)
  const [lastVisit] = useState<string | null>(() => {
    try {
      return window.localStorage.getItem(LAST_VISIT_KEY);
    } catch {
      return null;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString());
    } catch {
      // Private browsing: every visit simply counts as the first.
    }
  }, []);

  // Snapshot metadata: when the feed was last rebuilt, and whether any
  // followed field has no snapshot in this deployment.
  const [manifest, setManifest] = useState<{ generatedAt: string; categories: string[] } | null>(null);
  useEffect(() => {
    let cancelled = false;
    getManifest()
      .then((data) => {
        if (!cancelled) {
          setManifest(data);
        }
      })
      .catch(() => {
        // The feed itself will surface an error if snapshots are missing.
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const missingTopics = manifest
    ? topics.filter((id) => !manifest.categories.includes(id))
    : [];

  const activeCategories = useMemo(
    () => (focus ? [focus] : topics),
    [focus, topics],
  );

  const queryKey = activeCategories.join(",");
  const fetchPage = useCallback(
    (start: number) => getFeed(queryKey.split(","), start, PAGE_SIZE),
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
            {manifest ? (
              <span className="page-head__stamp">
                {" "}
                Updated {formatRelativeDate(manifest.generatedAt)}.
              </span>
            ) : null}
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

      {missingTopics.length > 0 ? (
        <p className="notice notice--quiet">
          No snapshot yet for {missingTopics.map(categoryLabel).join(", ")} —
          these fields will appear after the next site update.
        </p>
      ) : null}

      {loading ? (
        <PaperListSkeleton />
      ) : error ? (
        <ErrorBox message={error} onRetry={retry} />
      ) : papers.length === 0 ? (
        <EmptyState
          icon={Rss}
          title="Nothing here yet"
          body="No recent papers for this selection. Try another topic or widen your feed."
        />
      ) : (
        <>
          <div className="paper-list">
            {papers.map((paper, index) => {
              const isNew = lastVisit !== null && paper.published > lastVisit;
              const prevWasNew =
                index > 0 && lastVisit !== null && papers[index - 1].published > lastVisit;
              return (
                <Fragment key={paper.id}>
                  {prevWasNew && !isNew ? (
                    <div className="feed-divider" role="separator">
                      <span>You&apos;re caught up — earlier papers below</span>
                    </div>
                  ) : null}
                  <PaperCard paper={paper} isNew={isNew} />
                </Fragment>
              );
            })}
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
