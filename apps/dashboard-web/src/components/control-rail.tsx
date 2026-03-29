"use client";

import type { ControlResponse } from "@/lib/types";

type ControlRailProps = {
  controls: ControlResponse | null;
  taxonomyTokens: string[];
  search: string;
  yearRange: [number, number];
  isBusy: boolean;
  onToggleTaxonomy: (value: string) => void;
  onClearTaxonomy: () => void;
  onSearchChange: (value: string) => void;
  onYearRangeChange: (value: [number, number]) => void;
};

export function ControlRail({
  controls,
  taxonomyTokens,
  search,
  yearRange,
  isBusy,
  onToggleTaxonomy,
  onClearTaxonomy,
  onSearchChange,
  onYearRangeChange,
}: ControlRailProps) {
  const yearMin = controls?.yearMin ?? 1991;
  const yearMax = controls?.yearMax ?? 2026;
  const taxonomyOptions = controls?.taxonomyOptions ?? [];
  const metrics = controls?.metrics ?? {
    corpus: "-",
    sample: "-",
    latest: "-",
    taxonomy: "-",
    years: `${yearMin}-${yearMax}`,
  };
  const yearOptions = Array.from(
    { length: yearMax - yearMin + 1 },
    (_, index) => yearMax - index,
  );
  const hasActiveYearFilter = yearRange[0] !== yearMin || yearRange[1] !== yearMax;
  const hasActiveTaxonomy = taxonomyTokens.length > 0;

  function handleStartYear(value: number) {
    onYearRangeChange([Math.min(value, yearRange[1]), yearRange[1]]);
  }

  function handleEndYear(value: number) {
    onYearRangeChange([yearRange[0], Math.max(value, yearRange[0])]);
  }

  return (
    <aside className="control-panel">
      <section className="panel title-card">
        <div className="title-copy">
          <h1 className="page-title">Scholar Pulse</h1>
          <p className="page-description">
            Explore the published research map, filter by topic and year, and inspect
            individual papers.
          </p>
        </div>

        <div className="overview-list" aria-label="Corpus overview">
          <div className="overview-row">
            <span className="overview-label">Corpus</span>
            <strong className="overview-value">{metrics.corpus}</strong>
          </div>
          <div className="overview-row">
            <span className="overview-label">Recent</span>
            <strong className="overview-value">{metrics.latest}</strong>
          </div>
          <div className="overview-row">
            <span className="overview-label">Years</span>
            <strong className="overview-value">{metrics.years}</strong>
          </div>
        </div>
      </section>

      <section className="panel filters-card">
        <div className="section-head">
          <div>
            <span className="eyebrow">Filters</span>
            <h2 className="section-title">Refine the map</h2>
          </div>
          <span className={`status-indicator ${isBusy ? "is-busy" : ""}`}>
            {isBusy ? "Updating" : "Live"}
          </span>
        </div>

        <label className="field-block">
          <span className="field-label">Search</span>
          <input
            className="search-field"
            type="text"
            value={search}
            placeholder="Search title or abstract"
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </label>

        <div className="field-block">
          <div className="field-line">
            <span className="field-label">Years</span>
            <span className="field-pill">
              {yearRange[0]} - {yearRange[1]}
            </span>
          </div>

          <div className="year-grid">
            <label className="subfield">
              <span className="mini-label">From</span>
              <select
                className="select-field"
                value={yearRange[0]}
                onChange={(event) => handleStartYear(Number(event.target.value))}
              >
                {yearOptions.map((year) => (
                  <option key={`from-${year}`} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>

            <label className="subfield">
              <span className="mini-label">To</span>
              <select
                className="select-field"
                value={yearRange[1]}
                onChange={(event) => handleEndYear(Number(event.target.value))}
              >
                {yearOptions.map((year) => (
                  <option key={`to-${year}`} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {hasActiveYearFilter ? (
            <button
              type="button"
              className="text-button"
              onClick={() => onYearRangeChange([yearMin, yearMax])}
            >
              Reset year filter
            </button>
          ) : null}
        </div>

        <div className="field-block taxonomy-block">
          <div className="field-line">
            <span className="field-label">Topics</span>
            {hasActiveTaxonomy ? (
              <button type="button" className="text-button" onClick={onClearTaxonomy}>
                Clear selection
              </button>
            ) : (
              <span className="field-pill">{metrics.taxonomy} total</span>
            )}
          </div>

          {taxonomyOptions.length > 0 ? (
            <div className="taxonomy-grid">
              {taxonomyOptions.map((option) => {
                const active = taxonomyTokens.includes(option.value);
                const metaParts = [
                  option.count ? `${option.count.toLocaleString()} papers` : null,
                  option.description ?? null,
                ].filter(Boolean);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`taxonomy-option ${active ? "is-active" : ""}`}
                    onClick={() => onToggleTaxonomy(option.value)}
                    aria-pressed={active}
                  >
                    <span className="taxonomy-title">{option.label}</span>
                    {metaParts.length > 0 ? (
                      <span className="taxonomy-meta">{metaParts.join(" · ")}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="helper-copy">Topic filters will appear once the published data is loaded.</p>
          )}
        </div>
      </section>

      <section className="panel info-card">
        <span className="eyebrow">Map guide</span>
        <p className="helper-copy">
          Start broad with density, then narrow the scope with topic, year, or search.
          Click any visible paper to open its abstract and related work.
        </p>
      </section>
    </aside>
  );
}