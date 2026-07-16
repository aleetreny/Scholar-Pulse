"use client";

import type { CSSProperties } from "react";
import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  Clock3,
  ExternalLink,
  Layers3,
  Map as MapIcon,
  Radio,
  Search,
  Sparkles,
} from "lucide-react";

import type { Paper, PulseData, Theme } from "@/lib/showroom";

const MAP_URL = "https://aleetreny.github.io/Mapping-Science/";
const REPO_URL = "https://github.com/aleetreny/Scholar-Pulse";

function formatIssueDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatPaperDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function relativeAge(publishedAt: string, generatedAt: string) {
  const elapsed = Math.max(
    0,
    new Date(generatedAt).getTime() - new Date(publishedAt).getTime(),
  );
  const days = Math.floor(elapsed / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function authorLine(authors: string[]) {
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} +${authors.length - 3}`;
}

function themeStyle(theme: Theme): CSSProperties {
  return { "--theme-accent": theme.accent } as CSSProperties;
}

type PaperCardProps = {
  paper: Paper;
  theme: Theme;
  generatedAt: string;
  selected: boolean;
  onSelect: (paper: Paper) => void;
};

function PaperCard({ paper, theme, generatedAt, selected, onSelect }: PaperCardProps) {
  return (
    <article className={`paper-card ${selected ? "is-selected" : ""}`} style={themeStyle(theme)}>
      <div className="paper-card-topline">
        <span className="theme-mark">
          <i aria-hidden="true" />
          {theme.shortName}
        </span>
        <span>{relativeAge(paper.publishedAt, generatedAt)}</span>
      </div>
      <button className="paper-card-title" type="button" onClick={() => onSelect(paper)}>
        {paper.title}
      </button>
      <p className="paper-card-authors">{authorLine(paper.authors)}</p>
      <p className="paper-card-summary">{paper.summary}</p>
      <div className="paper-card-footer">
        <span className="category-code">{paper.primaryCategory}</span>
        <a href={paper.arxivUrl} target="_blank" rel="noreferrer">
          Open paper <ArrowUpRight size={14} aria-hidden="true" />
        </a>
      </div>
    </article>
  );
}

export function ShowroomShell({ data }: { data: PulseData }) {
  const [activeTheme, setActiveTheme] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedPaper, setSelectedPaper] = useState<Paper>(data.papers[0]);

  const themeById = useMemo(
    () => new Map(data.themes.map((theme) => [theme.id, theme])),
    [data.themes],
  );

  const filteredPapers = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return data.papers.filter((paper) => {
      const matchesTheme = activeTheme === "all" || paper.themeId === activeTheme;
      if (!matchesTheme) return false;
      if (!query) return true;
      return [
        paper.title,
        paper.summary,
        paper.authors.join(" "),
        paper.categories.join(" "),
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query);
    });
  }, [activeTheme, data.papers, search]);

  const selectedTheme = themeById.get(selectedPaper.themeId) ?? data.themes[0];
  const leadPaper = filteredPapers[0];
  const remainingPapers = filteredPapers.slice(1);
  const latestTimestamp = data.papers[0]?.publishedAt ?? data.generatedAt;

  function chooseTheme(themeId: string) {
    setActiveTheme(themeId);
    setSearch("");
    const firstPaper = data.papers.find((paper) => paper.themeId === themeId);
    if (firstPaper) setSelectedPaper(firstPaper);
    document.getElementById("latest")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="studio-shell">
      <div className="pulse-layout">
        <header className="panel topbar">
          <a className="brand" href="#top" aria-label="Scholar Pulse home">
            <span className="brand-signal" aria-hidden="true"><i /><i /><i /></span>
            <span>Scholar Pulse</span>
          </a>
          <nav aria-label="Primary navigation">
            <a href="#latest">Latest</a>
            <a href="#showrooms">Showrooms</a>
            <a href="#method">Method</a>
          </nav>
          <a className="map-link" href={MAP_URL} target="_blank" rel="noreferrer">
            <MapIcon size={15} aria-hidden="true" /> Science map <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </header>

        <main id="top">
          <section className="hero-grid" aria-labelledby="hero-title">
            <div className="panel hero-card">
              <div className="hero-orbit orbit-one" aria-hidden="true" />
              <div className="hero-orbit orbit-two" aria-hidden="true" />
              <div className="hero-copy">
                <span className="eyebrow">Fresh research · {formatIssueDate(data.generatedAt)}</span>
                <h1 id="hero-title">A pulse on what science is thinking <em>now.</em></h1>
                <p>
                  The newest papers across six research frontiers, arranged to browse rather
                  than buried in a feed.
                </p>
                <div className="hero-actions">
                  <a className="primary-action" href="#latest">
                    Browse today&apos;s pulse <ArrowDown size={16} aria-hidden="true" />
                  </a>
                  <a className="secondary-action" href="#showrooms">
                    Explore showrooms
                  </a>
                </div>
              </div>
              <div className="hero-index" aria-label="Current issue summary">
                <span>Issue</span><strong>{formatIssueDate(data.generatedAt).slice(0, 2)}</strong>
                <span>{data.papers.length} papers · {data.themes.length} lenses</span>
              </div>
            </div>

            <aside className="panel pulse-card">
              <div className="section-head">
                <div>
                  <span className="eyebrow">Live edition</span>
                  <h2>Today&apos;s signal</h2>
                </div>
                <span className="live-dot"><i /> updated</span>
              </div>
              <div className="pulse-stats">
                <div><strong>{data.papers.length}</strong><span>new papers</span></div>
                <div><strong>{data.themes.length}</strong><span>showrooms</span></div>
              </div>
              <div className="source-note">
                <Radio size={17} aria-hidden="true" />
                <p>
                  Latest submission: <strong>{formatPaperDate(latestTimestamp)}</strong>.<br />
                  Sourced from <a href={data.source.url} target="_blank" rel="noreferrer">{data.source.name}</a>.
                </p>
              </div>
              <p className="transparent-note">{data.source.note}</p>
            </aside>
          </section>

          <section id="latest" className="content-grid">
            <div className="feed-column">
              <div className="panel filter-card">
                <div className="filter-title">
                  <span className="eyebrow">The daily pulse</span>
                  <h2>Newest across the frontier</h2>
                </div>
                <label className="search-control">
                  <Search size={17} aria-hidden="true" />
                  <span className="sr-only">Search papers</span>
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search ideas, authors, categories…"
                  />
                </label>
                <div className="theme-tabs" role="group" aria-label="Filter by showroom">
                  <button
                    type="button"
                    className={activeTheme === "all" ? "is-active" : ""}
                    onClick={() => setActiveTheme("all")}
                  >
                    All <span>{data.papers.length}</span>
                  </button>
                  {data.themes.map((theme) => (
                    <button
                      type="button"
                      key={theme.id}
                      className={activeTheme === theme.id ? "is-active" : ""}
                      onClick={() => setActiveTheme(theme.id)}
                      style={themeStyle(theme)}
                    >
                      {theme.shortName}
                    </button>
                  ))}
                </div>
              </div>

              {leadPaper ? (
                <article className="panel lead-paper" style={themeStyle(themeById.get(leadPaper.themeId) ?? data.themes[0])}>
                  <div className="lead-number">01</div>
                  <div className="lead-body">
                    <div className="paper-card-topline">
                      <span className="theme-mark"><i aria-hidden="true" />{themeById.get(leadPaper.themeId)?.name}</span>
                      <span>{relativeAge(leadPaper.publishedAt, data.generatedAt)}</span>
                    </div>
                    <button type="button" className="lead-title" onClick={() => setSelectedPaper(leadPaper)}>
                      {leadPaper.title}
                    </button>
                    <p className="lead-authors">{authorLine(leadPaper.authors)}</p>
                    <p className="lead-summary">{leadPaper.summary}</p>
                    <div className="lead-actions">
                      <button type="button" className="text-action" onClick={() => setSelectedPaper(leadPaper)}>
                        Read abstract <BookOpen size={15} aria-hidden="true" />
                      </button>
                      <a href={leadPaper.arxivUrl} target="_blank" rel="noreferrer">
                        View on arXiv <ArrowUpRight size={15} aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                </article>
              ) : (
                <div className="panel empty-state">
                  <Search size={26} aria-hidden="true" />
                  <h3>No papers match that search.</h3>
                  <button type="button" onClick={() => { setSearch(""); setActiveTheme("all"); }}>Clear filters</button>
                </div>
              )}

              <div className="paper-grid">
                {remainingPapers.map((paper) => {
                  const theme = themeById.get(paper.themeId) ?? data.themes[0];
                  return (
                    <PaperCard
                      key={paper.id}
                      paper={paper}
                      theme={theme}
                      generatedAt={data.generatedAt}
                      selected={selectedPaper.id === paper.id}
                      onSelect={setSelectedPaper}
                    />
                  );
                })}
              </div>
            </div>

            <aside className="sidebar-stack">
              <section className="panel selected-card" style={themeStyle(selectedTheme)}>
                <div className="section-head">
                  <div>
                    <span className="eyebrow">Open on the desk</span>
                    <h2>Paper details</h2>
                  </div>
                  <Sparkles size={20} aria-hidden="true" />
                </div>
                <div className="selected-theme"><i aria-hidden="true" />{selectedTheme.name}</div>
                <h3>{selectedPaper.title}</h3>
                <p className="selected-authors">{authorLine(selectedPaper.authors)}</p>
                <p className="selected-summary">{selectedPaper.summary}</p>
                <div className="selected-meta">
                  <span><Clock3 size={14} aria-hidden="true" />{formatPaperDate(selectedPaper.publishedAt)}</span>
                  <span>{selectedPaper.primaryCategory}</span>
                </div>
                <a className="primary-action full-action" href={selectedPaper.arxivUrl} target="_blank" rel="noreferrer">
                  Read on arXiv <ExternalLink size={15} aria-hidden="true" />
                </a>
              </section>

              <section id="showrooms" className="panel showroom-card">
                <div className="section-head">
                  <div>
                    <span className="eyebrow">Topic showrooms</span>
                    <h2>Choose a lens</h2>
                  </div>
                  <Layers3 size={20} aria-hidden="true" />
                </div>
                <div className="showroom-list">
                  {data.themes.map((theme) => {
                    const count = data.papers.filter((paper) => paper.themeId === theme.id).length;
                    return (
                      <button
                        type="button"
                        key={theme.id}
                        className={activeTheme === theme.id ? "is-active" : ""}
                        onClick={() => chooseTheme(theme.id)}
                        style={themeStyle(theme)}
                      >
                        <i aria-hidden="true" />
                        <span><strong>{theme.name}</strong><small>{theme.description}</small></span>
                        <b>{count}</b>
                      </button>
                    );
                  })}
                </div>
              </section>
            </aside>
          </section>

          <section id="method" className="panel method-card">
            <div>
              <span className="eyebrow">A new role for Scholar Pulse</span>
              <h2>The map explains science&apos;s shape. This shows what is arriving.</h2>
            </div>
            <p>
              Scholar Pulse is now the living front door: recent papers and themed windows,
              refreshed daily. The full cartographic work remains a distinct companion project.
            </p>
            <a href={MAP_URL} target="_blank" rel="noreferrer">
              Explore Mapping Science <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </section>
        </main>

        <footer>
          <span>Scholar Pulse · an open research showroom</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer">View the project on GitHub <ArrowUpRight size={13} aria-hidden="true" /></a>
        </footer>
      </div>
    </div>
  );
}
