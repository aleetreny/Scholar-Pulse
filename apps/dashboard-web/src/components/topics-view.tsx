"use client";

import { Compass, Rss } from "lucide-react";
import Link from "next/link";

import { TopicPicker } from "@/components/topic-picker";
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
            <a
              key={id}
              href={withBase(`/data/rss/${id}.xml`)}
              target="_blank"
              rel="noreferrer"
            >
              {id}
            </a>
          ))}
        </p>
      ) : null}

      {mounted ? <TopicPicker selected={topics} onToggle={toggleTopic} /> : null}
    </div>
  );
}
