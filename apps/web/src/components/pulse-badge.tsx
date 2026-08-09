"use client";

import { type StringKey, useT } from "@/lib/i18n";
import type { Pulse, PulseTier } from "@/lib/types";

/**
 * The ranking, as the reader sees it.
 *
 * Deliberately a band and a number, in that order. The study behind
 * lib/ranking found that the strict order inside the head of the list is not
 * stable — a 5% wobble in the inputs replaced three of the top ten — while the
 * band assignment held 95% of the time. So the band is the claim; the number
 * is context.
 */

const TIER_LABEL: Record<PulseTier, StringKey> = {
  headline: "pulse.tier.headline",
  notable: "pulse.tier.notable",
  rest: "pulse.tier.rest",
};

/**
 * Marks a paper whose authors the site has never seen publish.
 *
 * It earns its place by explaining the list order: these papers are ranked in
 * their own lane and hold a reserved share of the positions, so without the
 * mark a reader sees a 97 sitting above a 99 and reasonably concludes the
 * ranking is broken. It is also the more interesting of the two possible
 * labels — a group nobody is watching yet.
 */
export function NewcomerMark({ pulse }: { pulse: Pulse }) {
  const { t } = useT();
  if (!pulse.newcomer) {
    return null;
  }
  return (
    <span className="pulse-newcomer" title={t("pulse.newcomerWhy")}>
      <span className="pulse-newcomer__mark" aria-hidden="true" />
      {t("pulse.newcomerShort")}
    </span>
  );
}

/** The score itself, as a monospaced numeral in the card's ledger column. */
export function PulseScore({ pulse }: { pulse: Pulse }) {
  const { t } = useT();
  return (
    <span
      className="pulse-score"
      data-tier={pulse.tier}
      title={t("pulse.scoreTitle", { score: pulse.score })}
    >
      {pulse.score}
    </span>
  );
}

const SIGNAL_LABEL: Record<string, StringKey> = {
  team_size: "pulse.signal.team_size",
  author_new_frac: "pulse.signal.author_new_frac",
  author_degree_max: "pulse.signal.author_degree_max",
  author_recency: "pulse.signal.author_recency",
  author_reach: "pulse.signal.author_reach",
  n_categories: "pulse.signal.n_categories",
  title_words: "pulse.signal.title_words",
  title_has_colon: "pulse.signal.title_has_colon",
  abstract_words: "pulse.signal.abstract_words",
  has_named_system: "pulse.signal.has_named_system",
  term_burst_mean: "pulse.signal.term_burst_mean",
  term_rarity: "pulse.signal.term_rarity",
  pair_novelty: "pulse.signal.pair_novelty",
};

const LANE_LABEL = {
  signals: "pulse.lane.signals",
  references: "pulse.lane.references",
  reception: "pulse.lane.reception",
} as const;

/**
 * Why this paper is where it is.
 *
 * Every contribution here is non-negative by construction: the model was
 * fitted with each signal pre-oriented and its weight pinned at or above zero,
 * so a paper's score decomposes into reasons that can be read aloud without
 * caveats. That property is the whole reason the model is fitted that way.
 */
export function PulseExplainer({ pulse }: { pulse: Pulse }) {
  const { t } = useT();
  const strongest = pulse.reasons[0]?.contribution ?? 1;

  return (
    <div className="pulse-panel">
      <div className="pulse-panel__head">
        <span className="pulse-panel__score" data-tier={pulse.tier}>
          {pulse.score}
        </span>
        <div>
          <p className="pulse-panel__tier">{t(TIER_LABEL[pulse.tier])}</p>
          <p className="pulse-panel__gloss">
            {t("pulse.standing", { score: pulse.score })}
          </p>
        </div>
      </div>

      <p className="pulse-panel__calibration">
        {t("pulse.calibrated", {
          rate: (pulse.probability * 100).toFixed(1),
        })}
      </p>

      {pulse.reasons.length > 0 ? (
        <ul className="pulse-reasons">
          {pulse.reasons.map((reason) => (
            <li key={reason.signal}>
              <span className="pulse-reasons__label">
                {t(SIGNAL_LABEL[reason.signal])}
              </span>
              <span
                className="pulse-reasons__bar"
                style={{
                  // Relative to the strongest reason, so the bars compare
                  // within this paper rather than against an absolute scale
                  // that would mean nothing to a reader.
                  ["--share" as string]: `${Math.round(
                    (reason.contribution / Math.max(strongest, 1e-9)) * 100,
                  )}%`,
                }}
                aria-hidden="true"
              />
            </li>
          ))}
        </ul>
      ) : null}

      <p className="pulse-panel__lanes">
        {t("pulse.lanesLabel")}{" "}
        {pulse.lanes.map((lane) => t(LANE_LABEL[lane])).join(" · ")}
        {pulse.newcomer ? ` · ${t("pulse.newcomer")}` : null}
      </p>
    </div>
  );
}
