"use client";

import {
  Activity,
  Bookmark,
  Compass,
  Moon,
  Search,
  SlidersHorizontal,
  Sun,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

import { Toaster } from "@/components/toast";
import { useLibrary, useTheme } from "@/lib/store";

const NAV_ITEMS = [
  { href: "/", label: "For you", icon: Compass },
  { href: "/search", label: "Search", icon: Search },
  { href: "/library", label: "Library", icon: Bookmark },
  { href: "/topics", label: "Topics", icon: SlidersHorizontal },
] as const;

function isActive(pathname: string, href: string): boolean {
  if (href === "/") {
    return pathname === "/" || pathname.startsWith("/paper");
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function BrandMark() {
  return (
    <span className="brand__mark" aria-hidden>
      <Activity size={19} strokeWidth={2.4} />
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { theme, toggle } = useTheme();
  const { entries } = useLibrary();
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
      aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={theme === "dark" ? "Light theme" : "Dark theme"}
    >
      {theme === "dark" ? <Sun /> : <Moon />}
    </button>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <BrandMark />
          <span className="brand__name">
            Scholar<em>Pulse</em>
          </span>
        </Link>

        <nav className="sidebar__nav" aria-label="Main">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className="nav-item"
              data-active={isActive(pathname, href)}
            >
              <Icon />
              {label}
              {href === "/library" && savedCount > 0 ? (
                <span className="nav-item__badge">{savedCount}</span>
              ) : null}
            </Link>
          ))}
        </nav>

        <div className="sidebar__footer">
          <p className="sidebar__hint">
            Press <kbd>/</kbd> to search arXiv from anywhere.
          </p>
          {themeButton}
        </div>
      </aside>

      <div className="app-wrap">
        <header className="mobile-topbar">
          <Link href="/" className="brand">
            <BrandMark />
            <span className="brand__name">
              Scholar<em>Pulse</em>
            </span>
          </Link>
          {themeButton}
        </header>

        <main className="main">{children}</main>
      </div>

      <nav className="tabbar" aria-label="Main">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="tabbar__item"
            data-active={isActive(pathname, href)}
          >
            <Icon />
            {label}
          </Link>
        ))}
      </nav>

      <Toaster />
    </div>
  );
}
