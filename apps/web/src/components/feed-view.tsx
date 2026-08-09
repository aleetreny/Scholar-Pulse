"use client";

import { Activity, ArrowRight, Clock, Loader2, Rss, SlidersHorizontal } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";

import { PaperCard } from "@/components/paper-card";
import { EmptyState, ErrorBox, PaperListSkeleton } from "@/components/states";
import { TopicPicker } from "@/components/topic-picker";
import { categoryLabel } from "@/lib/categories";
import { getFeed, getManifest } from "@/lib/data/feed";
import { formatRelativeDate } from "@/lib/format";
import { type StringKey, useT } from "@/lib/i18n";
import { MODEL_INFO } from "@/lib/ranking/score";
import { useFeedSort, useHydrated, useTopics } from "@/lib/store";
import type { PulseTier } from "@/lib/types";
import { PAGE_SIZE, usePaginatedPapers } from "@/lib/use-papers";

function Onboarding() {
  const { topics, setTopics } = useTopics();
  const [draft, setDraft] = useState<string[]>(topics);
  const { t } = useT();

  return (
    <div className="onboard">
      <h1>{t("onboard.title")}</h1>
      <p>{t("onboard.body")}</p>

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
            ? t("onboard.pickOne")
            : draft.length === 1
              ? t("onboard.buildOne")
              : t("onboard.buildMany", { n: draft.length })}
          <ArrowRight />
        </button>
      </div>
    </div>
  );
}

const LAST_VISIT_KEY = "scholarpulse.feed-last-visit.v1";

const TIER_HEADING: Record<PulseTier, StringKey> = {
  headline: "pulse.band.headline",
  notable: "pulse.band.notable",
  rest: "pulse.band.rest",
};

function Feed({ topics }: { topics: string[] }) {
  const [focusRaw, setFocus] = useState<string | null>(null);
  const { sort, setSort } = useFeedSort();
  const { t, lang } = useT();
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

  // The key identifies the query for the pagination hook; the fetcher closes
  // over the categories directly rather than parsing them back out of it.
  const queryKey = `${sort}|${activeCategories.join(",")}`;
  const fetchPage = useCallback(
    (start: number) => getFeed(activeCategories, start, PAGE_SIZE, focus, sort),
    [activeCategories, focus, sort],
  );

  const { papers, loading, loadingMore, error, hasMore, loadMore, retry } =
    usePaginatedPapers(fetchPage, queryKey, activeCategories.length > 0);

  // Snapshots built before the ranking shipped carry no scores; the feed then
  // silently behaves as it always did rather than showing empty furniture.
  const ranked = sort === "pulse" && papers.some((paper) => paper.pulse);

  return (
    <div className="main__column">
      <div className="page-head">
        <div>
          <h1>{t("feed.title")}</h1>
          <p className="page-head__sub">
            {t("feed.sub")}
            {manifest ? (
              <span className="page-head__stamp">
                {" "}
                {t("feed.updated", {
                  when: formatRelativeDate(manifest.generatedAt, lang),
                })}
              </span>
            ) : null}
          </p>
        </div>
        <div className="page-head__actions">
          <Link href="/topics" className="btn btn--ghost btn--small">
            <SlidersHorizontal />
            {t("feed.editTopics")}
          </Link>
        </div>
      </div>

      <div className="feed-toolbar">
        <div className="feed-toolbar__sort" role="group" aria-label={t("feed.sortAria")}>
          <button
            type="button"
            className="topic-pill"
            data-active={sort === "pulse"}
            aria-pressed={sort === "pulse"}
            onClick={() => setSort("pulse")}
          >
            <Activity />
            {t("feed.sortPulse")}
          </button>
          <button
            type="button"
            className="topic-pill"
            data-active={sort === "recent"}
            aria-pressed={sort === "recent"}
            onClick={() => setSort("recent")}
          >
            <Clock />
            {t("feed.sortRecent")}
          </button>
        </div>
        <div className="feed-toolbar__topics" role="group" aria-label={t("feed.filterAria")}>
          <button
            type="button"
            className="topic-pill"
            data-active={focus === null}
            aria-pressed={focus === null}
            onClick={() => setFocus(null)}
          >
            {t("feed.allFields")}
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
          {t("feed.missingSnapshot", {
            fields: missingTopics.map(categoryLabel).join(", "),
          })}
        </p>
      ) : null}

      {loading ? (
        <PaperListSkeleton />
      ) : error ? (
        <ErrorBox message={error} onRetry={retry} />
      ) : papers.length === 0 ? (
        <EmptyState
          icon={Rss}
          title={t("feed.emptyTitle")}
          body={t("feed.emptyBody")}
        />
      ) : (
        <>
          {ranked ? (
            <p className="notice notice--quiet feed-method">
              {t("feed.rankedNote", {
                lift: MODEL_INFO.liftAt10.toFixed(1),
                auc: MODEL_INFO.auc.toFixed(2),
              })}
            </p>
          ) : null}
          <div className="paper-list" data-sort={ranked ? "pulse" : "recent"}>
            {papers.map((paper, index) => {
              const isNew = lastVisit !== null && paper.published > lastVisit;
              const prevWasNew =
                index > 0 && lastVisit !== null && papers[index - 1].published > lastVisit;
              // Bands, not positions: the study found the exact order inside
              // the head of the list unstable, while the band held. So the
              // list is broken by band and never numbered when ranked.
              const tier = ranked ? paper.pulse?.tier : undefined;
              const previousTier = ranked ? papers[index - 1]?.pulse?.tier : undefined;
              return (
                <Fragment key={paper.id}>
                  {tier && tier !== previousTier ? (
                    <div className="feed-divider feed-divider--tier" role="separator">
                      <span>{t(TIER_HEADING[tier])}</span>
                    </div>
                  ) : null}
                  {!ranked && prevWasNew && !isNew ? (
                    <div className="feed-divider" role="separator">
                      <span>{t("feed.caughtUp")}</span>
                    </div>
                  ) : null}
                  <PaperCard paper={paper} isNew={isNew} showPulse={ranked} />
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
                {loadingMore ? t("feed.loading") : t("feed.loadMore")}
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
