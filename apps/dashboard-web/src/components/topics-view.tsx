"use client";

import { Compass, Rss } from "lucide-react";
import Link from "next/link";

import { TopicPicker } from "@/components/topic-picker";
import { showToast } from "@/components/toast";
import { withBase } from "@/lib/data/base";
import { useT } from "@/lib/i18n";
import { useHydrated, useTopics } from "@/lib/store";

export function TopicsView() {
  const { topics, toggleTopic } = useTopics();
  const mounted = useHydrated();
  const { t } = useT();

  return (
    <div className="main__column main__column--wide">
      <div className="page-head">
        <div>
          <h1>{t("topics.titleFollow")}</h1>
          <p className="page-head__sub">
            {mounted && topics.length > 0
              ? topics.length === 1
                ? t("topics.subCountOne")
                : t("topics.subCountMany", { n: topics.length })
              : t("topics.subChoose")}
          </p>
        </div>
        <div className="page-head__actions">
          <Link href="/" className="btn btn--primary btn--small">
            <Compass />
            {t("topics.goToFeed")}
          </Link>
        </div>
      </div>

      {mounted && topics.length > 0 ? (
        <p className="rss-row">
          <Rss aria-hidden />
          {t("topics.rss")}
          {topics.map((id) => (
            <button
              key={id}
              type="button"
              title={t("topics.rssCopyAria", { cat: id })}
              onClick={async () => {
                const url = `${window.location.origin}${withBase(`/data/rss/${id}.xml`)}`;
                try {
                  await navigator.clipboard.writeText(url);
                  showToast(t("topics.rssCopied"));
                } catch {
                  showToast(url);
                }
              }}
            >
              {id}
            </button>
          ))}
        </p>
      ) : null}

      {mounted ? <TopicPicker selected={topics} onToggle={toggleTopic} /> : null}
    </div>
  );
}
