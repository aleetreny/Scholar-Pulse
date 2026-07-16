import type { DateRange, SortMode } from "@/lib/research";
import type { Theme } from "@/lib/showroom";

type ScopePanelProps = {
  activeTheme: string;
  dateRange: DateRange;
  isOpen: boolean;
  paperCount: number;
  sortMode: SortMode;
  themes: Theme[];
  themeCounts: Map<string, number>;
  onClose: () => void;
  onDateRangeChange: (range: DateRange) => void;
  onReset: () => void;
  onSortModeChange: (mode: SortMode) => void;
  onThemeChange: (themeId: string) => void;
};

const DATE_OPTIONS: Array<{ id: DateRange; label: string }> = [
  { id: "all", label: "Current edition" },
  { id: "24h", label: "Last 24 hours" },
  { id: "3d", label: "Last 3 days" },
];

const SORT_OPTIONS: Array<{ id: SortMode; label: string }> = [
  { id: "relevance", label: "Best query match" },
  { id: "newest", label: "Newest first" },
  { id: "title", label: "Title A–Z" },
];

export function ScopePanel({
  activeTheme,
  dateRange,
  isOpen,
  paperCount,
  sortMode,
  themes,
  themeCounts,
  onClose,
  onDateRangeChange,
  onReset,
  onSortModeChange,
  onThemeChange,
}: ScopePanelProps) {
  return (
    <aside className={isOpen ? "scope-panel is-open" : "scope-panel"} aria-label="Research scope">
      <div className="scope-mobile-head">
        <strong>REFINE SCOPE</strong>
        <button type="button" onClick={onClose}>CLOSE ×</button>
      </div>

      <section className="scope-section">
        <div className="scope-heading"><span>FIELD</span><b>01</b></div>
        <div className="scope-options">
          <button
            type="button"
            className={activeTheme === "all" ? "is-active" : ""}
            aria-pressed={activeTheme === "all"}
            onClick={() => onThemeChange("all")}
          >
            <i aria-hidden="true">{activeTheme === "all" ? "■" : "□"}</i>
            <span>All fields</span>
            <b>{paperCount}</b>
          </button>
          {themes.map((theme) => (
            <button
              type="button"
              key={theme.id}
              className={activeTheme === theme.id ? "is-active" : ""}
              aria-pressed={activeTheme === theme.id}
              onClick={() => onThemeChange(theme.id)}
            >
              <i aria-hidden="true">{activeTheme === theme.id ? "■" : "□"}</i>
              <span>{theme.name}</span>
              <b>{themeCounts.get(theme.id) ?? 0}</b>
            </button>
          ))}
        </div>
      </section>

      <section className="scope-section">
        <div className="scope-heading"><span>PUBLISHED</span><b>02</b></div>
        <div className="scope-options compact-options">
          {DATE_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.id}
              className={dateRange === option.id ? "is-active" : ""}
              aria-pressed={dateRange === option.id}
              onClick={() => onDateRangeChange(option.id)}
            >
              <i aria-hidden="true">{dateRange === option.id ? "■" : "□"}</i>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="scope-section">
        <div className="scope-heading"><span>ORDER</span><b>03</b></div>
        <div className="scope-options compact-options">
          {SORT_OPTIONS.map((option) => (
            <button
              type="button"
              key={option.id}
              className={sortMode === option.id ? "is-active" : ""}
              aria-pressed={sortMode === option.id}
              onClick={() => onSortModeChange(option.id)}
            >
              <i aria-hidden="true">{sortMode === option.id ? "■" : "□"}</i>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="coverage-note">
        <span>WHAT THIS INDEX IS</span>
        <p>
          A daily scan of the newest arXiv submissions in six broad fields. Useful for
          frontier monitoring; deliberately not a complete literature search.
        </p>
      </div>

      <button type="button" className="reset-scope" onClick={onReset}>RESET SCOPE</button>
    </aside>
  );
}
