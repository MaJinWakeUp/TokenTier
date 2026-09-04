import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
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
  const scenarios = JSON.parse(
    await readFile(new URL("../data/scenarios.json", import.meta.url), "utf8"),
  );
  const catalogDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${[catalog.updatedAt, "2026-08-21"].sort().at(-1)}T00:00:00Z`));
  assert.match(html, /<title>TokenTier — AI APIs vs subscription plans<\/title>/i);
  assert.match(html, /rel="canonical" href="https:\/\/majinwakeup\.github\.io\/TokenTier\/"/i);
  assert.match(html, /rel="icon" href="https:\/\/majinwakeup\.github\.io\/TokenTier\/favicon\.svg"/i);
  assert.match(html, /property="og:image" content="https:\/\/majinwakeup\.github\.io\/TokenTier\/og\.png"/i);
  assert.match(html, /name="twitter:card" content="summary_large_image"/i);
  assert.match(html, /API or plan/);
  assert.match(html, /Tier list/i);
  assert.match(html, /Compare AI APIs and plans/);
  assert.match(html, /Your recommendation/);
  assert.match(html, /Explore profiles/);
  assert.match(html, />Recommendation</);
  assert.match(html, /Rank plans/);
  assert.match(html, /Rank them your way/);
  assert.match(html, /Unranked plans/);
  assert.match(html, /Subscription plans/);
  assert.match(html, /API models/);
  assert.match(html, /Copy share link/);
  assert.match(html, /OpenCode Go/);
  assert.match(html, /ChatGPT Go/);
  assert.match(html, /SuperGrok Lite/);
  assert.match(html, /SuperGrok Plus/);
  assert.match(html, /Kimi K3/);
  assert.match(html, /Grok 4\.6/);
  assert.match(html, /Claude Fable 5\.1/);
  assert.match(html, /GLM-5\.3-Flash/);
  assert.match(html, /Grok 4\.3/);
  assert.match(html, /Gemini 3\.8 Flash/);
  assert.match(html, /Muse Spark 1\.3/);
  assert.match(html, /Qwen3\.8-Max/);
  // One Google Flash lane: 3.8 replaced both older Flash entries.
  assert.doesNotMatch(html, /Gemini 3\.6 Flash/);
  assert.doesNotMatch(html, /Gemini 3\.5 Flash-Lite/);
  // Retired in favour of a documented replacement.
  assert.doesNotMatch(html, /GLM-5\.2/);
  assert.doesNotMatch(html, />o3</);
  assert.doesNotMatch(html, /Claude Fable 5</);
  // The capability gate has to be stated on the page, not just applied.
  assert.match(html, /Artificial Analysis Intelligence Index/);
  assert.match(html, /Intelligence Index/);
  assert.match(html, /models qualify for/);
  assert.match(html, /Not on the board/);
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
  assert.match(html, /Typical month/);
  assert.match(html, /Work type/);
  assert.match(html, /Input tokens \/ call/);
  assert.match(html, /Output tokens \/ call/);
  assert.match(html, /BEST PATH/);
  assert.match(html, /\$[\d,.]+[^<]*[\s\S]*?[\d,]+ calls/);
  // The rendered defaults come from the shipped profile, not a hardcoded pair.
  const defaultProfile = scenarios.scenarios.find((entry) => entry.id === "code-medium");
  assert.ok(html.includes(defaultProfile.input.toLocaleString("en-US")), "renders the profile input tokens");
  assert.ok(html.includes(defaultProfile.calls.toLocaleString("en-US")), "renders the profile call count");
  // The work-type selector and the numbers under it must agree on first visit,
  // before any saved or URL state exists.
  assert.match(html, /<option value="code-medium" selected="">/);
  for (const field of [defaultProfile.input, defaultProfile.output, defaultProfile.calls]) {
    assert.ok(html.includes(`value="${field}"`), `initialises a recommendation field to ${field}`);
  }
  const otherProfile = scenarios.scenarios.find((entry) => entry.id !== "code-medium" && entry.calls !== defaultProfile.calls);
  assert.ok(
    !html.includes(`value="${otherProfile.calls}"`),
    `does not initialise the call count from ${otherProfile.id}`,
  );
  assert.match(html, /Input from cache/);
  assert.match(html, /Typical month/);
  // The frontier replaces the single "best API" pick.
  assert.match(html, /Lowest cost/);
  assert.match(html, /Best in budget/);
  assert.match(html, /Most capable/);
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
  const [page, rankPage, layout, styles, packageJson, readme, workflow, license, catalogSource, robots, sitemap, ogImage, planSource, scenarioSource, viteConfig, gitignore, updater] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/rank-board.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../README.md", import.meta.url), "utf8"),
    readFile(new URL("../.github/workflows/deploy.yml", import.meta.url), "utf8"),
    readFile(new URL("../LICENSE", import.meta.url), "utf8"),
    readFile(new URL("../data/api-models.json", import.meta.url), "utf8"),
    readFile(new URL("../public/robots.txt", import.meta.url), "utf8"),
    readFile(new URL("../public/sitemap.xml", import.meta.url), "utf8"),
    readFile(new URL("../public/og.png", import.meta.url)),
    readFile(new URL("../data/plans.json", import.meta.url), "utf8"),
    readFile(new URL("../data/scenarios.json", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.gitignore", import.meta.url), "utf8"),
    readFile(new URL("../scripts/update-models.mjs", import.meta.url), "utf8"),
  ]);
  const catalog = JSON.parse(catalogSource);
  const scenarios = JSON.parse(scenarioSource);

  assert.match(page, /TokenTier/);

  // Plan records live in a validated data file, not inside the component.
  const planCatalog = JSON.parse(await readFile(new URL("../data/plans.json", import.meta.url), "utf8"));
  const planNames = planCatalog.plans.map((entry) => entry.name);
  for (const name of [
    "Cursor Pro", "Cursor Pro Plus", "Cursor Ultra", "OpenCode Zen",
    "GLM Coding Lite", "GLM Coding Pro", "GLM Coding Max",
    "Kimi Moderato", "Kimi Allegretto", "Kimi Allegro", "Kimi Vivace",
    "Google AI Plus", "Google AI Pro", "Google AI Ultra (5x)", "Google AI Ultra (20x)",
    "SuperGrok Heavy",
  ]) {
    assert.ok(planNames.includes(name), `plan catalog keeps ${name}`);
  }
  const planById = new Map(planCatalog.plans.map((entry) => [entry.id, entry]));
  assert.equal(planById.get("chatgpt-go").monthly, 8);
  assert.equal(planById.get("grok-super-lite").monthly, 10);
  assert.equal(planById.get("grok-super-plus").monthly, 100);
  assert.equal(
    planById.get("grok-super-lite").source,
    "https://grok.com/supergrok?referrer=pricing&target=supergroklite",
  );
  assert.deepEqual(planById.get("grok-super-lite").modelIds, ["grok-4-6"]);
  assert.match(planById.get("grok-super").note, /Includes Grok 4\.6/);
  // Plans that pointed at a retired model were repointed, not left dangling.
  const modelIds = new Set(catalog.models.map((entry) => entry.id));
  for (const entry of planCatalog.plans) {
    assert.ok(entry.modelIds.length > 0, `${entry.id} lists at least one model`);
    for (const id of entry.modelIds) {
      assert.ok(modelIds.has(id), `${entry.id} references listed model ${id}`);
    }
  }
  // A plan is judged on the model the workload would actually use, so the
  // verified rosters have to carry more than one option.
  assert.ok(
    planById.get("opencode-go").modelIds.length > 5,
    "OpenCode Go lists the models its rate card publishes",
  );
  assert.deepEqual(planById.get("chatgpt-plus").modelIds, ["gpt-5-6-luna", "gpt-5-6-terra", "gpt-5-6-sol"]);
  assert.deepEqual(planById.get("glm-coding-lite").modelIds, ["glm-5-3", "glm-5-3-flash"]);
  // Credit multipliers are published per model, so they are keyed by model id.
  assert.deepEqual(planById.get("glm-coding-lite").creditMultipliers["glm-5-3"], [6.9, 1.7, 24]);
  assert.deepEqual(planById.get("glm-coding-lite").creditMultipliers["glm-5-3-flash"], [2.3, 0.56, 8]);
  // OpenCode Go meters in dollars, not credits.
  assert.equal(planById.get("opencode-go").includedApiValue, 60);
  assert.ok(!("weeklyCredits" in planById.get("opencode-go")), "OpenCode Go is not credit-metered");
  assert.doesNotMatch(planSource, /"tiers"/);
  assert.match(page, /function planQuota[\s\S]*?if \(plan\.id === "chatgpt-go"\) return plan\.quota;[\s\S]*?const modelClass/);
  assert.doesNotMatch(page, /"chatgpt-go": \{ Luna:/);
  assert.match(page, /Primary pricing and quota sources/);
  assert.match(page, /Grok plans ↗/);
  assert.match(page, /Artificial Analysis capability index ↗/);
  assert.match(readme, /## Ownership and independence/);
  assert.match(readme, /independent project created and maintained by Jin Ma/);
  assert.match(readme, /GitHub Pages is the published host/);
  // The Sites packaging plugin is local-only, so the build must not require it:
  // the path is probed at runtime and the import is hidden from the bundler.
  assert.match(viteConfig, /existsSync\(sitesPluginPath\)/);
  assert.match(viteConfig, /import\(\/\* @vite-ignore \*\/ pathToFileURL\(sitesPluginPath\)\.href\)/);
  assert.doesNotMatch(viteConfig, /^import \{ sites \}/m);
  // Neither Sites file may be tracked; both are ignored so a clone has no trace.
  assert.match(gitignore, /\/\.openai\//);
  assert.match(gitignore, /\/build\/sites-vite-plugin\.ts/);
  assert.match(readme, /majinwakeup\.github\.io\/TokenTier/);
  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /name: Verify Pages artifact contents/);
  assert.match(workflow, /path: \.\/out/);
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Jin Ma/);
  assert.equal(JSON.parse(packageJson).license, "MIT");
  assert.match(page, /api-models\.json/);
  assert.match(layout, /TokenTier/);
  assert.match(layout, /metadataBase:/);
  assert.match(layout, /alternates:\s*\{\s*canonical:/s);
  assert.match(layout, /summary_large_image/);
  assert.match(robots, /Sitemap: https:\/\/majinwakeup\.github\.io\/TokenTier\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/majinwakeup\.github\.io\/TokenTier\/<\/loc>/);
  assert.ok(ogImage.length > 1_000, "exports a non-empty social preview PNG");
  assert.match(layout, /prefers-color-scheme: light/);
  assert.match(styles, /\.explore-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 300px;/s);
  assert.match(styles, /\.scenario-dock\s*\{[^}]*position:\s*sticky;[^}]*grid-column:\s*2;/s);
  assert.match(styles, /@media \(max-width: 1120px\)[\s\S]*?\.scenario-dock\s*\{[^}]*position:\s*static;/s);
  assert.match(page, /const \[exploreScenarioId, setExploreScenarioId\]/);
  assert.match(page, /type View = "explore" \| "recommendation" \| "rank"/);
  assert.match(page, /<RankBoard models=\{rankableModels\} plans=\{rankablePlans\} \/>/);
  assert.match(page, /<span aria-hidden="true" className="workspace-tab-long">Recommendation<\/span>/);
  assert.doesNotMatch(page, /My recommendation/);
  assert.match(rankPage, /draggable/);
  assert.match(rankPage, /onDrop=\{\(event\) => handleDrop\(event, tier\.id\)\}/);
  assert.match(rankPage, /params\.set\("board", serializeBoard\(board\)\)/);
  assert.match(rankPage, /navigator\.clipboard\.writeText\(url\)/);
  assert.match(rankPage, /unrankedGroups\.map\(\(\[provider, providerItems\]\)/);
  assert.match(rankPage, /className="rank-company-grid"/);
  assert.match(rankPage, /className="provider-orb" data-provider=\{item\.provider\}/);
  assert.match(rankPage, /\+ Add tier/);
  assert.match(rankPage, /Move \{item\.name\}/);
  // Both subjects, each board kept separately and persisted.
  assert.match(rankPage, /type Subject = "plans" \| "models"/);
  assert.match(rankPage, /const \[boards, setBoards\] = useState<Record<Subject, Board>>/);
  assert.match(rankPage, /localStorage\.setItem\(\s*storageKey/);
  assert.match(rankPage, /params\.set\("subject", subject\)/);
  assert.match(rankPage, /className="rank-subject-switch book-switch"/);
  assert.match(page, /const \[recommendationScenarioId, setRecommendationScenarioId\]/);
  assert.match(page, /const \[exploreLane, setExploreLane\]/);
  assert.match(page, /document\.title = viewTitles\[activeView\]/);
  assert.match(page, /function parseColumnPreferences/);
  assert.doesNotMatch(page, /setVisible(?:Api|Plan)Columns\(JSON\.parse/);
  assert.match(page, /className="sortable-header"[\s\S]*?<button[\s\S]*?onClick=\{\(\) => handleHeaderSort/s);
  assert.doesNotMatch(page, /className="sortable-header"\s+onClick=/);
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
  assert.match(page, /Number\(b\.withinBudget\) - Number\(a\.withinBudget\)/);
  assert.doesNotMatch(page, /const withinBudgetOptions/);
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
  assert.match(styles, /\.workspace-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
  assert.match(styles, /\.rank-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  // Above 1180px the pool sits beside the tiers so a drag needs no mid-drag scroll.
  assert.match(styles, /@media \(min-width: 1180px\)[\s\S]*?\.rank-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(340px, 0\.62fr\);/s);
  assert.match(styles, /@media \(min-width: 1180px\)[\s\S]*?\.rank-pool\s*\{[^}]*position:\s*sticky;/s);
  // The move menu must be able to show its own option text.
  assert.match(styles, /\.rank-plan-card select\s*\{[^}]*min-width:\s*108px;/s);
  assert.match(styles, /\.rank-company-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(300px, 1fr\)\);/s);
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
  // The full labels stop fitting around 560px, not 420px: at 430px
  // "Recommendation" needs 109px inside a 70px button.
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*?\.workspace-tab-long\s*\{[^}]*display:\s*none;/s);
  // Even "Recommend" overflows the button at 360px.
  assert.match(page, /className="workspace-tab-short">Advice</);
  assert.match(styles, /\.columns-reset-btn\s*\{[^}]*color:\s*var\(--accent-readable\);/s);
  assert.doesNotMatch(page, /aria-haspopup="listbox"|className="columns-menu" role="menu"/);
  assert.match(page, /function monthlyPrice\(value: number\)/);
  assert.match(page, /setRecommendationInputTokens\(selectedScenario\.input\)/);
  // The updater must check the whole data set before it writes.
  assert.match(updater, /async function validateCompanions/);
  assert.match(updater, /await validateCompanions\(merged, resolvedCatalogPath, scenariosPath, plansPath\);/);
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
  // No stored tier letters anywhere: the board is derived from published scores.
  assert.doesNotMatch(catalogSource, /"tiers"/);
  assert.match(catalogSource, /"capabilityIndex"/);
  for (const model of catalog.models) {
    assert.ok("capability" in model, `${model.id} declares a capability block`);
    if (model.capability !== null) {
      assert.equal(model.capability.indexVersion, catalog.capabilityIndex.version);
      assert.match(model.capability.source, /^https:\/\//);
    }
  }
  const medium = scenarios.scenarios.find((entry) => entry.id === "code-medium");
  const mediumQualifying = catalog.models.filter(
    (model) => (model.capability?.metrics?.[medium.gate.metric] ?? -Infinity) >= medium.gate.minIndex,
  );
  assert.ok(
    mediumQualifying.length >= 3 && mediumQualifying.length < catalog.models.length,
    `keeps Medium coding selective; ${mediumQualifying.length} of ${catalog.models.length} qualify`,
  );
  assert.match(page, /function modelPlacements/);
  // Cost-minimising alone returns the floor on every workload, so the view
  // reports a frontier and the cache share is part of the cost model.
  assert.match(page, /type ApiPriority = "cost" \| "budget" \| "capability"/);
  assert.match(page, /const apiFrontier = useMemo/);
  assert.match(page, /const apiRecommendationModel = apiFrontier\[apiPriority\]/);
  assert.match(page, /cacheRatio: number;/);
  assert.match(page, /const cacheRatio = cacheRatioOverride \?\? settings\.cacheRatio/);
  // Unverifiable coverage is renormalised out, never scored as a penalty.
  assert.match(page, /if \(coverage !== null\) terms\.push\(\[weights\.coverage, coverage\]\)/);
  assert.doesNotMatch(page, /\(coverage \?\? 25\)/);
  assert.match(styles, /\.frontier-option\s*\{/);
  // Every profile has to explain its own numbers.
  for (const entry of scenarios.scenarios) {
    assert.ok(entry.rationale.length > 30, `${entry.id} explains its profile`);
    assert.ok(entry.calls > 0 && entry.cacheRatio >= 0, `${entry.id} carries a call count and cache share`);
  }
  assert.match(page, /function planPlacements/);
  assert.match(page, /function planWorkingModel/);
  // The index decides every tier, so it appears where a reader looks it up.
  assert.match(page, /<small>\{capabilityIndex\.name\}<\/small>/);
  assert.match(page, /label: capabilityIndex\.name,/);
  // A comparison table has to say which value is better.
  assert.match(page, /const compareRows = useMemo<CompareRow\[\]>/);
  assert.match(page, /className=\{isBest \? "compare-best" : undefined\}/);
  assert.match(page, /A tick marks the better value in a row\./);
  assert.match(styles, /\.compare-best-mark\s*\{[^}]*display:\s*inline;/s);
  // Dense table controls grow their hit box with padding and cancel the layout
  // shift with a matching negative margin.
  assert.match(styles, /\.table-item-name-btn\s*\{[^}]*padding:\s*12px 6px;[^}]*margin:\s*-12px -6px;/s);
  assert.match(styles, /\.index-value\s*\{[^}]*padding:\s*12px 10px;[^}]*margin:\s*-12px -10px;/s);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.source-link\s*\{[^}]*width:\s*40px;/s);
  // The cache field is a percentage and has to say so.
  assert.match(page, /<span id="cache-unit">% of input<\/span>/);
  // Over budget has two causes since the frontier landed: nothing affordable
  // clears the bar, or the reader is looking at an axis that ignores budget.
  // The old copy asserted the first whenever the shown model was over.
  assert.doesNotMatch(page, /No model fits within/);
  assert.match(page, /apiFrontier\.budgetFits \? \([\s\S]*?over your/);
  assert.match(page, /No model clears the \{recommendationScenario\.label\.toLowerCase\(\)\} bar within/);
  // Both branches name the axis being viewed. The no-fit branch used to call it
  // "the cheapest" while reporting whichever axis was selected, so with the
  // capability axis it labelled the most expensive model as the cheapest.
  assert.doesNotMatch(page, /Showing the cheapest at/);
  assert.match(page, /const costPick = frontierPicks\.find\(\(pick\) => pick\.id === "cost"\)/);
  assert.match(page, /costPick\.model\.id !== activePick\.model\.id/);
  assert.equal((page.match(/\{activePick\.label\.toLowerCase\(\)\}/g) ?? []).length, 2);
  // Whole-dollar rounding put figures on the wrong side of the budget they were
  // judged against: $3.33 rendered as "$3" beside an "over budget" tag on a $3
  // budget. Every amount shown against the budget keeps cents when it must.
  assert.match(page, /function monthlyPriceAgainst\(value: number, reference: number\)/);
  assert.match(page, /const contradicts = \(value > reference && rounded <= reference\)/);
  assert.match(page, /\|\| \(value < reference && rounded > reference\)/);
  assert.match(page, /monthlyPriceAgainst\(pick\.spend, monthlyBudget\)/);
  assert.match(page, /monthlyPriceAgainst\(recommendedApiSpend, monthlyBudget\)/);
  assert.match(page, /monthlyPriceAgainst\(costPick\.spend, monthlyBudget\)/);
  assert.match(page, /monthlyPriceAgainst\(budgetPick\.spend, monthlyBudget\)/);
  for (const unguarded of [
    /monthlyPrice\(pick\.spend\)/,
    /monthlyPrice\(costPick\.spend\)/,
    /monthlyPrice\(budgetPick\.spend\)/,
  ]) {
    assert.doesNotMatch(page, unguarded);
  }
  // The one remaining plain use is the plan-comparison caption, which states no
  // budget verdict, so rounding there cannot contradict anything.
  assert.equal((page.match(/monthlyPrice\(recommendedApiSpend\)/g) ?? []).length, 1);
  assert.match(page, /No subscription plan can be compared[\s\S]*?monthlyPrice\(recommendedApiSpend\)/);
  assert.match(page, /onClick=\{\(\) => setApiPriority\("budget"\)\}/);
  // Options the budget cannot cover say so before they are selected.
  assert.match(page, /overBudget: spend > monthlyBudget/);
  assert.match(page, /className="frontier-over">over budget/);
  // One source for every opening value, so the selector cannot drift from them.
  assert.match(page, /const defaultScenario = scenarioFor\("code-medium"\)/);
  assert.doesNotMatch(page, /useState\(scenarios\[0\]\./);
  assert.doesNotMatch(page, /useState<ScenarioId>\("code-medium"\)/);
  assert.match(page, /const workingModel = planWorkingModel\(plan, scenario, recommendationSettings\)/);
  assert.match(page, /via \{workingModel\.name\}/);
  assert.match(page, /const placementsByScenario/);
  assert.match(page, /function tierAtRank/);
  assert.match(styles, /\.mini-tier\.tier-c \{ background: var\(--tier-c-bg\); \}/);
  // Every provider in the catalog needs an orb colour of its own.
  for (const provider of new Set(catalog.models.map((model) => model.provider))) {
    assert.ok(
      styles.includes(`.provider-orb[data-provider="${provider}"]`),
      `styles define a provider orb for ${provider}`,
    );
  }
  assert.doesNotMatch(styles, /\.hero-card|\.scenario-tabs|\.price-scenario-tabs|\.call-profile/);
  assert.doesNotMatch(page, /className="hero-card|className="scenario-tabs|className="price-scenario-tabs|className="call-profile/);
  assert.doesNotMatch(page, /id:\s*"kimi-moderato"[\s\S]*?includedApiValue:/);
  assert.match(page, /apiPlanDifference < 0/);
  assert.match(page, /contextSize\(a\.context\) - contextSize\(b\.context\)/);
  assert.match(page, /placementSort\(modelPlacement\(a\.id, exploreScenarioId\), modelPlacement\(b\.id, exploreScenarioId\)\)/);
  // The recommender picks the cheapest model that clears the bar, not the top tier.
  assert.match(page, /Cheapest model that clears the/);
  assert.doesNotMatch(page, /tierScore/);
  assert.doesNotMatch(page, /codex-preview|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.doesNotMatch(packageJson, /drizzle/);
  await assert.rejects(access(new URL("app/rank-plans.tsx", projectRoot)));
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
  await assert.rejects(access(new URL("app/chatgpt-auth.ts", projectRoot)));
  await assert.rejects(access(new URL("public/opengraph-image.svg", projectRoot)));
  await assert.rejects(access(new URL("db/index.ts", projectRoot)));
  await assert.rejects(access(new URL("db/schema.ts", projectRoot)));
  await assert.rejects(access(new URL("drizzle.config.ts", projectRoot)));
  await assert.rejects(access(new URL("drizzle/meta/_journal.json", projectRoot)));
});

// --ink is the ink for coloured fills. On a dark inset panel it is invisible,
// which is how the capability bar and the index column came to render as blank
// gaps in dark mode while looking fine in light mode.
test("never puts fill-ink on a plain surface", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

  const darkTokens = styles.slice(0, styles.indexOf('html[data-theme="light"]'));
  const value = (name) => darkTokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
  assert.equal(value("ink"), "#0b0d13", "dark --ink stays the ink for coloured fills");

  // Every rule that paints with --ink must sit on a coloured fill.
  const onColouredFill = [
    "::selection", ".skip-link", ".brand-mark", ".workspace-tabs button.active",
    ".theme-switcher button.active", ".button-primary",
    ".tier-s .tier-label", ".tier-a .tier-label", ".tier-b .tier-label", ".tier-c .tier-label",
    ".mini-tier", ".rank-tier-label input", ".rank-tier-label button",
  ];
  const inkRules = [...styles.matchAll(/([^{}]+)\{([^}]*var\(--ink\)[^}]*)\}/g)]
    .map((match) => match[1].trim().split("\n").pop().trim());
  for (const selector of inkRules) {
    assert.ok(
      onColouredFill.includes(selector),
      `${selector} paints with --ink but is not a known coloured fill; use --text-primary`,
    );
  }

  // The two that regressed, pinned explicitly.
  assert.match(styles, /\.gate-banner-rule strong\s*\{[^}]*color:\s*var\(--text-primary\);/s);
  assert.match(styles, /\.index-value\s*\{[^}]*color:\s*var\(--text-primary\);/s);
});

test("keeps muted text and the readable accent above AA contrast", async () => {
  const styles = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const lightTokens = styles.slice(styles.indexOf('html[data-theme="light"]'));
  const value = (name) => lightTokens.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`))?.[1];

  const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const luminance = (hex) => {
    const [r, g, b] = channels(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };

  // The inset panels are the tightest background these two sit on.
  const inset = "#e2e8f0";
  for (const token of ["text-muted", "accent-readable"]) {
    const hex = value(token);
    assert.ok(hex, `light --${token} is a hex value`);
    const contrast = ratio(hex, inset);
    assert.ok(
      contrast >= 4.5,
      `light --${token} (${hex}) is ${contrast.toFixed(2)}:1 on ${inset}, below the 4.5 minimum`,
    );
  }
});
