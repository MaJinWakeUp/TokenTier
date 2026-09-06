"use client";

// Theme is a browser preference, not application state: it is read straight
// from storage and the media query through useSyncExternalStore, so a change in
// another tab or a change of the system setting is picked up without a reload.
// The server snapshot is fixed so the markup React renders on the server always
// matches the first client render; the inline script in the layout applies the
// real theme before paint.

import { storageKeys } from "./storage.js";

export type ThemeMode = "system" | "light" | "dark";
export type ThemeAppearance = "light" | "dark";

export function getThemeSnapshot(): string {
  if (typeof window === "undefined") return "system:dark";
  const system = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  try {
    const saved = localStorage.getItem(storageKeys.theme);
    if (saved === "light" || saved === "dark") return `${saved}:${saved}`;
    if (saved === "system") return `system:${system}`;
  } catch {
    // Site data can be blocked outright; the system preference still works.
  }
  return `system:${system}`;
}

export function getServerThemeSnapshot(): string {
  return "system:dark";
}

export function subscribeTheme(callback: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: light)");
  media.addEventListener("change", callback);
  window.addEventListener("storage", callback);
  return () => {
    media.removeEventListener("change", callback);
    window.removeEventListener("storage", callback);
  };
}

export function applyThemeMode(mode: ThemeMode): void {
  try {
    if (mode === "system") {
      localStorage.removeItem(storageKeys.theme);
    } else {
      localStorage.setItem(storageKeys.theme, mode);
    }
    const system = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", mode === "system" ? system : mode);
    // useSyncExternalStore listens for `storage`, which only fires in *other*
    // tabs. Dispatching it here re-reads the snapshot in this one too.
    window.dispatchEvent(new Event("storage"));
  } catch {
    // ignore
  }
}
