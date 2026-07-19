import { formatPaperDate, getActivity, getThemeSignals } from "@/lib/research";
import type { Paper, Theme } from "@/lib/showroom";

type ThemeOverviewProps = {
  generatedAt: string;
  papers: Paper[];
  themes: Theme[];
  onOpenTheme: (themeId: string) => void;
  onSelectPaper: (paperId: string) => void;
};

export function ThemeOverview({
  generatedAt,
  papers,
  themes,
  onOpenTheme,
  onSelectPaper,
}: ThemeOverviewProps) {
  return (
    <section className="overview-panel" aria-labelledby="overview-title">
      <div className="content-heading">
        <div>
          <p>Research overview</p>
          <h1 id="overview-title">The latest edge, field by field</h1>
        </div>
        <p className="content-note">Six live thematic windows. Open one to browse its recent archive.</p>
      </div>

      <div className="theme-overview-grid">
        {themes.map((theme, index) => {
          const themePapers = papers
            .filter((paper) => paper.themeId === theme.id)
            .sort((left, right) => right.publishedAt.localeCompare(left.publishedAt));
          const latestPaper = themePapers[0];
          const activity = getActivity(themePapers, generatedAt);
          const maxActivity = Math.max(1, ...activity.map((point) => point.count));
          const signals = getThemeSignals(themePapers, 3);

          return (
            <article className="theme-overview-card" key={theme.id}>
              <div className="theme-card-head">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <i style={{ backgroundColor: theme.accent }} aria-hidden="true" />
                <h2>{theme.name}</h2>
                <small>{themePapers.length} papers</small>
              </div>

              <div
                className="activity-strip"
                role="img"
                aria-label={`Seven day submission activity for ${theme.name}`}
              >
                {activity.map((point) => (
                  <span key={point.date} title={`${point.date}: ${point.count} papers`}>
                    <i style={{ height: `${Math.max(8, (point.count / maxActivity) * 100)}%` }} />
                    <small>{point.label.slice(0, 1)}</small>
                  </span>
                ))}
              </div>

              {latestPaper ? (
                <div className="latest-paper">
                  <span>Latest · {formatPaperDate(latestPaper.publishedAt)}</span>
                  <button type="button" onClick={() => onSelectPaper(latestPaper.id)}>
                    {latestPaper.title}
                  </button>
                </div>
              ) : null}

              <div className="theme-card-foot">
                <p>{signals.length > 0 ? signals.join(" · ") : theme.description}</p>
                <button type="button" onClick={() => onOpenTheme(theme.id)}>Browse field →</button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
