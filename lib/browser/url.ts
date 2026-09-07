"use client";

// The browser half of the link contract. Parsing and serialising live in
// lib/domain/url-state.ts so they can be tested without a DOM; only the parts
// that genuinely need `window` are here.

export {
  legacyRouteFor,
  parseRankingsScenario,
  parseRecommendState,
  recommendParams,
  routes,
  type RecommendState,
  type RouteKey,
} from "../domain/url-state.js";

// Transient edits replace the current history entry; only navigation between
// routes should add one, so Back leaves the route rather than stepping through
// every keystroke.
export function replaceQuery(params: URLSearchParams): void {
  if (typeof window === "undefined") return;
  const query = params.toString();
  const next = `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", next);
}

export function absoluteUrl(path: string, params?: URLSearchParams, fragment?: string): string {
  if (typeof window === "undefined") return path;
  const query = params?.toString();
  return `${window.location.origin}${path}${query ? `?${query}` : ""}${fragment ? `#${fragment}` : ""}`;
}

// `usePathname` reports the route without the deployment base path, but
// `window.location.pathname` includes it. Keeping the current pathname is what
// makes a share link work under `/TokenTier/` as well as at a domain root.
export function currentPathname(): string {
  return typeof window === "undefined" ? "/" : window.location.pathname;
}
