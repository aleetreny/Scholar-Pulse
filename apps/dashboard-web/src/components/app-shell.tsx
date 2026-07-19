"use client";

import { Bookmark, Compass, Moon, Search, SlidersHorizontal, Sun } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { Toaster } from "@/components/toast";
import { useT, type StringKey } from "@/lib/i18n";
import { useHydrated, useLibrary, useTheme } from "@/lib/store";

const NAV_ITEMS: { href: string; labelKey: StringKey; icon: typeof Compass }[] = [
  { href: "/", labelKey: "nav.forYou", icon: Compass },
  { href: "/search", labelKey: "nav.search", icon: Search },
  { href: "/library", labelKey: "nav.library", icon: Bookmark },
  { href: "/topics", labelKey: "nav.topics", icon: SlidersHorizontal },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname.startsWith("/paper");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * The wordmark IS the logo: "ScholarPulse" in the serif with a hand-set
 * pulse line running under "Pulse" — no icon in a rounded box.
 */
function Wordmark() {
  return (
    <span className="brand__name">
      Scholar<em>Pulse</em>
      <svg
        className="brand__pulse"
        viewBox="0 0 56 10"
        aria-hidden="true"
        preserveAspectRatio="none"
      >
        <path
          d="M0 6.5 H14 L18 6.5 22 1 27 9 31 3.5 33.5 6.5 H56"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

function DateLine({ locale }: { locale: string }) {
  const hydrated = useHydrated();
  if (!hydrated) {
    return <span className="masthead__date" />;
  }
  const now = new Date();
  return (
    <span className="masthead__date">
      {now.toLocaleDateString(locale, {
        weekday: "short",
        month: "short",
        day: "numeric",
      })}
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { entries } = useLibrary();
  const { t, lang, setLang } = useT();
  const savedCount = Object.keys(entries).length;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      router.push("/search");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [router]);

  const themeButton = (
    <button
      type="button"
      className="icon-btn"
      onClick={toggle}
      aria-label={theme === "dark" ? t("theme.toLight") : t("theme.toDark")}
      title={theme === "dark" ? t("theme.light") : t("theme.dark")}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </button>
  );

  const langButton = (
    <button
      type="button"
      className="lang-btn"
      onClick={() => setLang(lang === "es" ? "en" : "es")}
      aria-label={t("lang.switch")}
      title={t("lang.switch")}
    >
      {lang === "es" ? "EN" : "ES"}
    </button>
  );

  return (
    <div className="shell">
      <header className="masthead">
        <div className="masthead__inner">
          <Link href="/" className="brand" aria-label={t("nav.home")}>
            <Wordmark />
          </Link>

          <nav className="masthead__nav" aria-label="Main">
            {NAV_ITEMS.map(({ href, labelKey }) => (
              <Link
                key={href}
                href={href}
                className="masthead__link"
                data-active={isActive(pathname, href)}
              >
                {t(labelKey)}
                {href === "/library" && savedCount > 0 ? (
                  <sup className="masthead__badge">{savedCount}</sup>
                ) : null}
              </Link>
            ))}
          </nav>

          <div className="masthead__meta">
            <DateLine locale={lang === "es" ? "es-ES" : "en-US"} />
            {langButton}
            {themeButton}
          </div>
        </div>
      </header>

      <main className="main">{children}</main>

      <footer className="colophon">
        <div className="colophon__inner">
          <span>
            {t("colophon.tagline")}{" "}
            <a href="https://arxiv.org" target="_blank" rel="noreferrer">
              arXiv
            </a>
          </span>
          <span className="colophon__sep" />
          <span>
            {t("colophon.enriched")}{" "}
            <a href="https://www.semanticscholar.org" target="_blank" rel="noreferrer">
              Semantic Scholar
            </a>
          </span>
          <span className="colophon__sep" />
          <span className="colophon__hint">
            {t("colophon.press")} <kbd>/</kbd> {t("colophon.toSearch")}
          </span>
        </div>
      </footer>

      <nav className="tabbar" aria-label="Main">
        {NAV_ITEMS.map(({ href, labelKey, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="tabbar__item"
            data-active={isActive(pathname, href)}
          >
            <Icon />
            {t(labelKey)}
          </Link>
        ))}
      </nav>

      <Toaster />
    </div>
  );
}
