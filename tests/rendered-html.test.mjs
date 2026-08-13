import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the TokenTier product", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  const catalog = JSON.parse(
    await readFile(new URL("../data/api-models.json", import.meta.url), "utf8"),
  );
  const catalogDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${catalog.updatedAt}T00:00:00Z`));
  assert.match(html, /<title>TokenTier — AI APIs vs subscription plans<\/title>/i);
  assert.match(html, /API or plan/);
  assert.match(html, /Tier list/i);
  assert.match(html, /Compare AI APIs and plans/);
  assert.match(html, /Your recommendation/);
  assert.match(html, /Explore profiles/);
  assert.match(html, /My recommendation/);
  assert.match(html, /OpenCode Go/);
  assert.match(html, /GLM-5\.2/);
  assert.match(html, /Kimi K3/);
  assert.match(html, /Grok 4\.6/);
  for (const model of catalog.models) {
    assert.ok(html.includes(model.name), `renders catalog model ${model.name}`);
  }
  assert.match(html, /Monthly cost by model/i);
  assert.match(html, /Plans &amp; access/i);
  assert.match(html, /© 2026 Jin Ma · Open-source code under MIT · Independent project/);
  assert.doesNotMatch(html, /not affiliated with or endorsed by the AI providers/i);
  assert.match(html, /id="profile-preset-title"/);
  assert.match(html, /id="explore-scenario"/);
  assert.match(html, /id="recommendation-profile"/);
  assert.match(html, /Preset per API call/);
  assert.match(html, /Work type/);
  assert.match(html, /Input tokens \/ call/);
  assert.match(html, /Output tokens \/ call/);
  assert.match(html, /BEST PATH/);
  assert.match(html, /\$[\d,.]+[^<]*[\s\S]*?[\d,]+ calls/);
  assert.match(html, /18,000/);
  assert.match(html, /6,000/);
  assert.match(html, /Easy coding/);
  assert.match(html, /Medium coding/);
  assert.match(html, /Hard coding/);
  assert.match(html, />Research</);
  assert.ok(
    html.includes(`Updated <!-- -->${catalogDate}`) || html.includes(`Updated ${catalogDate}`),
    "renders the catalog update date",
  );
  assert.doesNotMatch(html, /(?:01|02|03|04) \/|Editorial value picks|2 LANES|Recommendation choice|Choose the lane\. Know the limit\./i);
  assert.doesNotMatch(html, /Best value for|Current best value snapshot|Use this profile|Use in My recommendation/i);
  assert.doesNotMatch(html, /Research exploration|Coding · (?:easy|medium|difficult)/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("removes the disposable starter preview", async () => {
  const [page, layout, styles, packageJson, readme, license, catalogSource] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../LICENSE", import.meta.url), "utf8"),
    readFile(new URL("../data/api-models.json", import.meta.url), "utf8"),
  ]);
  const catalog = JSON.parse(catalogSource);

  assert.match(page, /TokenTier/);
  assert.match(page, /Cursor Pro/);
  assert.match(page, /OpenCode Zen/);
  assert.match(page, /GLM Coding Lite/);
  assert.match(page, /Kimi Moderato/);
  assert.match(page, /Primary pricing and quota sources/);
  assert.match(page, /modelId: "grok-4-6"/);
  assert.match(page, /Includes Grok 4\.6/);
  assert.match(page, /Grok plans ↗/);
  assert.match(readme, /## Ownership and independence/);
  assert.match(readme, /independent project created and maintained by Jin Ma/);
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Jin Ma/);
  assert.equal(JSON.parse(packageJson).license, "MIT");
  assert.match(page, /api-models\.json/);
  assert.match(layout, /TokenTier/);
  assert.match(layout, /prefers-color-scheme: light/);
  assert.match(styles, /\.explore-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 300px;/s);
  assert.match(styles, /\.scenario-dock\s*\{[^}]*position:\s*sticky;[^}]*grid-column:\s*2;/s);
  assert.match(styles, /@media \(max-width: 1120px\)[\s\S]*?\.scenario-dock\s*\{[^}]*position:\s*static;/s);
  assert.match(page, /const \[exploreScenarioId, setExploreScenarioId\]/);
  assert.match(page, /const \[recommendationScenarioId, setRecommendationScenarioId\]/);
  assert.match(page, /const \[exploreLane, setExploreLane\]/);
  assert.doesNotMatch(page, /const \[(?:tierLane|priceLane),/);
  assert.equal((page.match(/aria-pressed=\{exploreLane === "api"\}/g) ?? []).length, 2);
  assert.equal((page.match(/aria-pressed=\{exploreLane === "plans"\}/g) ?? []).length, 2);
  assert.match(page, /const useExploreProfile = \(\) =>/);
  assert.match(page, /updateRecommendationProfile\(exploreScenarioId\)/);
  assert.equal((page.match(/onClick=\{useExploreProfile\}/g) ?? []).length, 1);
  assert.equal((page.match(/Get a recommendation/g) ?? []).length, 1);
  assert.match(page, /callCost\(model, recommendationSettings\)/);
  assert.match(page, /function planCoverageScore[\s\S]*?return null;\n}/);
  assert.match(page, /planWithinBudget && planCoversVolume && !apiWithinBudget/);
  assert.doesNotMatch(page, /calls <= 2000/);
  const visiblePixelFontSizes = [...styles.matchAll(/font-size:\s*(\d+)px/g)]
    .map((match) => Number(match[1]))
    .filter((size) => size > 0);
  assert.ok(
    visiblePixelFontSizes.every((size) => size >= 13),
    "keeps every visible fixed pixel font at 13px or larger",
  );
  assert.match(styles, /\.tier-models\s*\{[^}]*grid-auto-rows:\s*82px;/s);
  assert.match(styles, /\.tier-model\s*\{[^}]*height:\s*82px;[^}]*min-height:\s*82px;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.tier-model strong\s*\{[^}]*font-size:\s*15px;/s);
  assert.match(styles, /\.workspace-tabs\s*\{/);
  assert.match(styles, /\.workspace-tabs button\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(styles, /\.theme-switcher\s*\{/);
  assert.match(styles, /\.theme-switcher button\s*\{[^}]*min-width:\s*38px;[^}]*min-height:\s*44px;/s);
  assert.match(styles, /\.provider-filters button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(styles, /\.book-switch button\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(page, /Scroll sideways to see all columns\./);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.cost-model \.recommendation-badge,[\s\S]*?grid-column:\s*1 \/ -1;/s);
  assert.match(styles, /\.recommendation-workspace\s*\{/);
  assert.match(styles, /\.plan-match-grid\s*\{/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.scenario-dock\s*\{[^}]*grid-template-columns:\s*minmax\(0, 0\.8fr\) minmax\(0, 1\.2fr\);/s);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.table-tools-top\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
  assert.match(styles, /@media \(max-width: 420px\)[\s\S]*?\.workspace-tab-long\s*\{[^}]*display:\s*none;/s);
  assert.match(styles, /\.columns-reset-btn\s*\{[^}]*color:\s*var\(--accent-readable\);/s);
  assert.doesNotMatch(page, /aria-haspopup="listbox"|className="columns-menu" role="menu"/);
  assert.match(page, /function monthlyPrice\(value: number\)/);
  assert.match(page, /setRecommendationInputTokens\(selectedScenario\.input\)/);
  assert.match(page, /setRecommendationOutputTokens\(selectedScenario\.output\)/);
  assert.match(page, /activeView === "recommendation" \? recommendationScenarioId : exploreScenarioId/);
  assert.ok(
    page.indexOf('className="freshness"') < page.indexOf('className="theme-switcher"'),
    "places the update timestamp before the theme control",
  );
  assert.match(
    styles,
    /\.columns-trigger\s*\{[^}]*font-family:\s*var\(--font-geist-sans\), sans-serif;[^}]*font-size:\s*14px;/s,
  );
  assert.match(page, /<details className="row-note"><summary>Note<\/summary><p>\{model\.note\}<\/p><\/details>/);
  assert.match(page, /<details className="row-note"><summary>Note<\/summary><p>\{plan\.note\}<\/p><\/details>/);
  assert.match(styles, /\.row-note summary\s*\{[^}]*background:\s*var\(--note-soft\);/s);
  assert.doesNotMatch(page, /className="recommendation-intro"|Build your|best-fit month|published capacity evidence/);
  assert.doesNotMatch(styles, /\.recommendation-intro/);
  assert.ok(
    page.indexOf('className={`decision-banner recommendation-summary') < page.indexOf('className="recommendation-workspace"'),
    "shows the numerical verdict before the recommendation settings workspace",
  );
  assert.match(styles, /@media \(max-width: 420px\)[\s\S]*?\.tier-model\s*\{[^}]*grid-template-rows:[^}]*height:\s*94px;/s);
  assert.doesNotMatch(styles, /@media \(max-width: 360px\)[\s\S]*?\.theme-switcher button:first-child\s*\{[^}]*display:\s*none;/s);
  const mediumSModels = catalog.models.filter((model) => model.tiers["code-medium"] === "S");
  assert.ok(mediumSModels.length >= 1 && mediumSModels.length <= 5, `keeps Medium coding selective; found ${mediumSModels.length} S-tier models`);
  assert.doesNotMatch(styles, /\.hero-card|\.scenario-tabs|\.price-scenario-tabs|\.call-profile/);
  assert.doesNotMatch(page, /className="hero-card|className="scenario-tabs|className="price-scenario-tabs|className="call-profile/);
  assert.doesNotMatch(page, /codex-preview|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
