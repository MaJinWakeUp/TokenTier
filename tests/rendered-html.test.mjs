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
  assert.match(html, /<title>TokenTier — AI APIs vs subscription plans<\/title>/i);
  assert.match(html, /API or plan/);
  assert.match(html, /Compare by/);
  assert.match(html, /Build your/);
  assert.match(html, /Explore profiles/);
  assert.match(html, /My recommendation/);
  assert.match(html, /OpenCode Go/);
  assert.match(html, /GLM-5\.2/);
  assert.match(html, /Kimi K3/);
  for (const model of catalog.models) {
    assert.ok(html.includes(model.name), `renders catalog model ${model.name}`);
  }
  assert.match(html, /Monthly cost by model/i);
  assert.match(html, /Suitable subscriptions/i);
  assert.match(html, /aria-label="Profile assumptions"/);
  assert.match(html, /id="explore-scenario"/);
  assert.match(html, /id="recommendation-profile"/);
  assert.match(html, /Updates the tier list and price book in Explore/);
  assert.match(html, /Work type/);
  assert.match(html, /Input tokens \/ call/);
  assert.match(html, /Output tokens \/ call/);
  assert.match(html, /BEST PATH/);
  assert.match(html, /How this profile works/);
  assert.match(html, /18,000/);
  assert.match(html, /6,000/);
  assert.match(html, /24,000/);
  assert.match(html, /Easy coding/);
  assert.match(html, /Medium coding/);
  assert.match(html, /Hard coding/);
  assert.match(html, />Research</);
  assert.match(html, /Updated\s*(?:<!-- -->)?\s*Aug 11, 2026/);
  assert.doesNotMatch(html, /(?:01|02|03|04) \/|Editorial value picks|2 LANES|Recommendation choice|Choose the lane\. Know the limit\./i);
  assert.doesNotMatch(html, /Best value for|Current best value snapshot/i);
  assert.doesNotMatch(html, /Research exploration|Coding · (?:easy|medium|difficult)/i);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("removes the disposable starter preview", async () => {
  const [page, layout, styles, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /TokenTier/);
  assert.match(page, /Cursor Pro/);
  assert.match(page, /OpenCode Zen/);
  assert.match(page, /GLM Coding Lite/);
  assert.match(page, /Kimi Moderato/);
  assert.match(page, /Primary pricing and quota sources/);
  assert.match(page, /api-models\.json/);
  assert.match(layout, /TokenTier/);
  assert.match(styles, /\.scenario-dock\s*\{[^}]*position:\s*fixed;[^}]*max-height:\s*calc\(100vh - 116px\);[^}]*overflow-y:\s*auto;/s);
  assert.match(styles, /@media \(max-width: 1279px\)[\s\S]*?\.scenario-dock\s*\{[^}]*position:\s*sticky;/s);
  assert.match(page, /const \[exploreScenarioId, setExploreScenarioId\]/);
  assert.match(page, /const \[recommendationScenarioId, setRecommendationScenarioId\]/);
  assert.match(page, /const useExploreProfile = \(\) =>/);
  assert.match(page, /updateRecommendationProfile\(exploreScenarioId\)/);
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
  assert.match(styles, /\.recommendation-workspace\s*\{/);
  assert.match(styles, /\.plan-match-grid\s*\{/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.scenario-dock\s*\{[^}]*grid-template-columns:\s*minmax\(0, 0\.75fr\) minmax\(0, 1\.25fr\);/s);
  assert.doesNotMatch(styles, /\.hero-card|\.scenario-tabs|\.price-scenario-tabs|\.call-profile/);
  assert.doesNotMatch(page, /className="hero-card|className="scenario-tabs|className="price-scenario-tabs|className="call-profile/);
  assert.doesNotMatch(page, /codex-preview|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
