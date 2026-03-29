"use client";

import { Activity, Blocks, Clock3, Radar, Rows3, Waypoints } from "lucide-react";

import type { ControlResponse } from "@/lib/types";

type HeroPanelProps = {
  controls: ControlResponse | null;
  activeView: "map" | "latest";
  isBusy: boolean;
  onViewChange: (value: "map" | "latest") => void;
};

const metricIcons = {
  corpus: Rows3,
  sample: Blocks,
  latest: Clock3,
  taxonomy: Waypoints,
  years: Radar,
} as const;

export function HeroPanel({
  controls,
  activeView,
  isBusy,
  onViewChange,
}: HeroPanelProps) {
  const metrics = controls?.metrics ?? {
    corpus: "0",
    sample: "0",
    latest: "0",
    taxonomy: "0",
    years: "1991-2026",
  };

  const metricCards = [
    {
      key: "corpus" as const,
      label: "Corpus",
      value: metrics.corpus,
      copy: "papers ready in the active snapshot",
    },
    {
      key: "sample" as const,
      label: "Preview",
      value: metrics.sample,
      copy: "deterministic lightweight layer",
    },
    {
      key: "latest" as const,
      label: "Latest",
      value: metrics.latest,
      copy: "papers scored in the rolling window",
    },
    {
      key: "taxonomy" as const,
      label: "Taxonomy",
      value: metrics.taxonomy,
      copy: "available category lenses",
    },
    {
      key: "years" as const,
      label: "Years",
      value: metrics.years,
      copy: "publication range in scope",
    },
  ];

  return (
    <section className="panel hero-card">
      <div className="hero-top">
        <div className="hero-copy">
          <span className="eyebrow">Next.js product surface</span>
          <h2 className="hero-title">
            A proper web app for exploring the frontier, not a notebook disguised as
            one.
          </h2>
          <p className="hero-text">
            Split between a Python API and a TypeScript front-end so interaction,
            state, and rendering stop fighting each other.
          </p>
        </div>

        <div className="hero-actions">
          <div className="tab-switch" role="tablist" aria-label="Workspace view">
            <button
              type="button"
              className={`tab-button ${activeView === "map" ? "is-active" : ""}`}
              onClick={() => onViewChange("map")}
            >
              Map Studio
            </button>
            <button
              type="button"
              className={`tab-button ${activeView === "latest" ? "is-active" : ""}`}
              onClick={() => onViewChange("latest")}
            >
              Latest Radar
            </button>
          </div>
          <div className={`status-pill ${isBusy ? "is-busy" : ""}`}>
            <Activity size={14} strokeWidth={1.9} />
            <span>{isBusy ? "Refreshing workspace" : controls?.statusChip ?? "Waiting for snapshot"}</span>
          </div>
        </div>
      </div>

      <div className="metric-grid">
        {metricCards.map((metric) => {
          const Icon = metricIcons[metric.key];
          return (
            <article key={metric.key} className="metric-card">
              <div className="metric-topline">
                <span className="metric-label">{metric.label}</span>
                <Icon size={16} strokeWidth={1.8} />
              </div>
              <strong className="metric-value">{metric.value}</strong>
              <p className="metric-copy">{metric.copy}</p>
            </article>
          );
        })}
      </div>
    </section>
  );
}