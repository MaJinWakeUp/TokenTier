"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { modelCatalogUpdatedAt, planCatalogUpdatedAt } from "@/lib/catalog";
import {
  applyThemeMode,
  getServerThemeSnapshot,
  getThemeSnapshot,
  subscribeTheme,
  type ThemeAppearance,
  type ThemeMode,
} from "@/lib/browser/theme";
import { routes } from "@/lib/browser/url";

const navItems: Array<{ href: string; label: string; short: string }> = [
  { href: routes.rankings, label: "Rankings", short: "Rank" },
  { href: routes.recommend, label: "Recommend", short: "Advice" },
  { href: routes.tierList, label: "My tier list", short: "Mine" },
];

// One date for the whole catalog: the later of the two documents, because a
// reader asking "how fresh is this?" means the page, not a single file.
export const latestCatalogUpdate =
  modelCatalogUpdatedAt > planCatalogUpdatedAt ? modelCatalogUpdatedAt : planCatalogUpdatedAt;

export const catalogUpdatedLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
}).format(new Date(`${latestCatalogUpdate}T00:00:00Z`));

export function daysSinceCatalogUpdate(now: Date = new Date()): number {
  const updated = new Date(`${latestCatalogUpdate}T00:00:00Z`);
  const days = Math.floor((now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24));
  return Number.isFinite(days) ? days : 0;
}

export function useTheme(): [ThemeMode, ThemeAppearance] {
  const snapshot = useSyncExternalStore(subscribeTheme, getThemeSnapshot, getServerThemeSnapshot);
  const [mode, appearance] = snapshot.split(":") as [ThemeMode, ThemeAppearance];

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", appearance);
  }, [appearance]);

  return [mode, appearance];
}

export function SiteHeader() {
  const pathname = usePathname();
  const [themeMode] = useTheme();
  const stale = daysSinceCatalogUpdate() > 30;

  // The exported site can be served with or without a trailing slash, and the
  // root has to match exactly or every route would look active.
  const isActive = (href: string) => {
    const current = pathname.endsWith("/") ? pathname : `${pathname}/`;
    return href === routes.rankings ? current === "/" : current === href;
  };

  return (
    <header className="site-header">
      <Link className="brand" href={routes.rankings} aria-label="TokenTier home">
        <span className="brand-mark">T/T</span>
        <span>TokenTier</span>
      </Link>
      <nav className="workspace-tabs" aria-label="Sections">
        {navItems.map((item) => (
          <Link
            aria-current={isActive(item.href) ? "page" : undefined}
            className={isActive(item.href) ? "active" : ""}
            href={item.href}
            key={item.href}
            title={item.label}
          >
            <span aria-hidden="true" className="workspace-tab-long">{item.label}</span>
            <span aria-hidden="true" className="workspace-tab-short">{item.short}</span>
            <span className="visually-hidden">{item.label}</span>
          </Link>
        ))}
      </nav>
      <div className="header-actions">
        <span className={`freshness ${stale ? "stale" : ""}`} title={`Data updated ${catalogUpdatedLabel}`}>
          <i /> Updated {catalogUpdatedLabel}
        </span>
        <div className="theme-switcher" role="group" aria-label="Theme">
          <button aria-label="Auto theme (follow system)" aria-pressed={themeMode === "system"} className={themeMode === "system" ? "active" : ""} onClick={() => applyThemeMode("system")} title="Auto (system)" type="button">
            <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16"><rect height="14" rx="2" ry="2" width="20" x="2" y="3"/><line x1="8" x2="16" y1="21" y2="21"/><line x1="12" x2="12" y1="17" y2="21"/></svg>
          </button>
          <button aria-label="Light theme" aria-pressed={themeMode === "light"} className={themeMode === "light" ? "active" : ""} onClick={() => applyThemeMode("light")} title="Light" type="button">
            <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16"><circle cx="12" cy="12" r="5"/><line x1="12" x2="12" y1="1" y2="3"/><line x1="12" x2="12" y1="21" y2="23"/><line x1="4.22" x2="5.64" y1="4.22" y2="5.64"/><line x1="18.36" x2="19.78" y1="18.36" y2="19.78"/><line x1="1" x2="3" y1="12" y2="12"/><line x1="21" x2="23" y1="12" y2="12"/><line x1="4.22" x2="5.64" y1="19.78" y2="18.36"/><line x1="18.36" x2="19.78" y1="5.64" y2="4.22"/></svg>
          </button>
          <button aria-label="Dark theme" aria-pressed={themeMode === "dark"} className={themeMode === "dark" ? "active" : ""} onClick={() => applyThemeMode("dark")} title="Dark" type="button">
            <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width="16"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          </button>
        </div>
      </div>
    </header>
  );
}

export default SiteHeader;
