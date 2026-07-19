import { formatCoverage } from "@/lib/research";
import type { Paper, Theme } from "@/lib/showroom";

type ThemeNavProps = {
  activeThemeId: string;
  papers: Paper[];
  themes: Theme[];
  onThemeChange: (themeId: string) => void;
};

export function ThemeNav({ activeThemeId, papers, themes, onThemeChange }: ThemeNavProps) {
  return (
    <aside className="theme-nav" aria-label="Research fields">
      <div className="theme-nav-heading">
        <span>Explore by field</span>
        <small>Newest available</small>
      </div>
      <nav>
        <button
          type="button"
          className={activeThemeId === "overview" ? "is-active" : ""}
          aria-pressed={activeThemeId === "overview"}
          onClick={() => onThemeChange("overview")}
        >
          <span>Overview</span>
          <small>All fields</small>
        </button>
        {themes.map((theme) => {
          const themePapers = papers.filter((paper) => paper.themeId === theme.id);
          return (
            <button
              type="button"
              key={theme.id}
              className={activeThemeId === theme.id ? "is-active" : ""}
              aria-pressed={activeThemeId === theme.id}
              onClick={() => onThemeChange(theme.id)}
            >
              <i style={{ backgroundColor: theme.accent }} aria-hidden="true" />
              <span>{theme.name}</span>
              <small>{themePapers.length} · {formatCoverage(themePapers)}</small>
            </button>
          );
        })}
      </nav>
      <p className="source-disclaimer">
        Latest arXiv submissions in each field. Refreshed daily; no quality ranking.
      </p>
    </aside>
  );
}
