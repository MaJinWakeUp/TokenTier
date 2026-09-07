// What actually ships: the server-rendered HTML of every route, the catalog it
// renders, and the delivery guarantees around it.
//
// These are deliberately about behaviour and contracts, not component names or
// exact prose. Where a source check remains it is because the source structure
// is itself the contract being kept (a local-only build plugin, a licence, a
// stylesheet token).

import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

// The deploy mounts the site under the repository name on GitHub Pages and at
// the root everywhere else, so the routes these tests request depend on how the
// bundle was built. Rather than recompute next.config's rule here — where it
// would silently drift — read it off the artifact: the build emits its assets
// under the base path, so whichever directory holds `_next` names it.
async function discoverBasePath() {
  const serverDir = new URL("../dist/server/", import.meta.url);
  const entries = await readdir(serverDir, { withFileTypes: true });
  if (entries.some((entry) => entry.isDirectory() && entry.name === "_next")) return "";
  for (const entry of entries.filter((e) => e.isDirectory() && e.name !== "ssr")) {
    const nested = await readdir(new URL(`${entry.name}/`, serverDir)).catch(() => []);
    if (nested.includes("_next")) return `/${entry.name}`;
  }
  throw new Error("could not find the built assets, so the base path is unknown");
}

const basePath = await discoverBasePath();

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${basePath}${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

async function html(path = "/") {
  const response = await render(path);
  assert.equal(response.status, 200, `${basePath}${path} responds 200`);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i, `${path} is HTML`);
  return response.text();
}

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

// -- Routes -------------------------------------------------------------------

test("every section is its own route with its own title and canonical", async () => {
  const routes = [
    { path: "/", canonical: "https://majinwakeup.github.io/TokenTier/", marker: /Compare AI APIs and plans/ },
    { path: "/recommend/", canonical: "https://majinwakeup.github.io/TokenTier/recommend/", marker: /Your recommendation/ },
    { path: "/tier-list/", canonical: "https://majinwakeup.github.io/TokenTier/tier-list/", marker: /Rank them your way/ },
  ];

  for (const route of routes) {
    const markup = await html(route.path);
    assert.match(markup, route.marker, `${route.path} renders its own content`);
    assert.match(markup, new RegExp(`rel="canonical" href="${route.canonical.replace(/[/.]/g, "\\$&")}"`), `${route.path} canonical`);
    const title = markup.match(/<title>([^<]*)<\/title>/)?.[1];
    assert.ok(title && title.includes("TokenTier"), `${route.path} has a TokenTier title`);
    // The shell is shared, so every route carries the nav to the other two.
    assert.ok(markup.includes(`href="${basePath}/recommend/"`), `${route.path} links to Recommend`);
    assert.ok(markup.includes(`href="${basePath}/tier-list/"`), `${route.path} links to the tier list`);
    assert.match(markup, /© 2026 Jin Ma · Open-source code under MIT · Independent project/, `${route.path} footer identity`);
  }

  // Each route's own content stays on its own route.
  const rankings = await html("/");
  assert.doesNotMatch(rankings, /Rank them your way/, "the board does not render on Rankings");
  const tierList = await html("/tier-list/");
  assert.doesNotMatch(tierList, /id="tier-board"|id="prices"/, "the Rankings board and price book do not render on the tier list");
});

test("Rankings answers the cheapest-qualified question above the board", async () => {
  const markup = await html("/");
  const catalog = JSON.parse(await read("data/api-models.json"));
  const scenarios = JSON.parse(await read("data/scenarios.json"));
  const catalogDate = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${[catalog.updatedAt, "2026-08-21"].sort().at(-1)}T00:00:00Z`));

  assert.match(markup, /rel="icon" href="https:\/\/majinwakeup\.github\.io\/TokenTier\/favicon\.svg"/i);
  assert.match(markup, /property="og:image" content="https:\/\/majinwakeup\.github\.io\/TokenTier\/og\.png"/i);
  assert.match(markup, /name="twitter:card" content="summary_large_image"/i);

  // The first viewport: preset selector, the cheapest qualified option, the
  // lane switch, and the start of the board.
  assert.match(markup, /id="explore-scenario"/);
  assert.match(markup, /Cheapest that clears the bar/);
  assert.match(markup, /Tier list/i);
  assert.match(markup, /Price book/);
  assert.match(markup, /models qualify for/);
  assert.match(markup, /Artificial Analysis Intelligence Index/);
  // Nothing unscored is silently dropped.
  assert.match(markup, /Not on the board/);

  // The board is curved, so every letter it prints has something in it and the
  // letters run contiguously from S. A row reading "No models ranked in this
  // tier" in the middle of the board is the bug this replaced.
  const letters = [...markup.matchAll(/class="tier-row tier-([sabcd])"/g)].map((m) => m[1].toUpperCase());
  assert.ok(letters.length > 0, "the board renders tier rows");
  assert.deepEqual(letters, ["S", "A", "B", "C", "D"].slice(0, letters.length), "letters are contiguous from S");
  assert.doesNotMatch(markup, /No models ranked in this tier/, "no letter is printed empty");
  assert.doesNotMatch(markup, /No plans ranked in this tier/, "no letter is printed empty");
  assert.match(markup, /Primary pricing and quota sources/);
  assert.match(markup, /Artificial Analysis capability index ↗/);
  assert.match(markup, /Typical month/);
  assert.ok(
    markup.includes(`Updated <!-- -->${catalogDate}`) || markup.includes(`Updated ${catalogDate}`),
    "renders the catalog update date",
  );

  // Real catalog rows, from the data file rather than the component.
  for (const name of ["Kimi K3", "Grok 4.6", "Claude Fable 5.1", "GLM-5.3-Flash", "Grok 4.3", "Gemini 3.8 Flash", "Muse Spark 1.3", "Qwen3.8-Max"]) {
    assert.ok(markup.includes(name), `renders ${name}`);
  }
  for (const scenario of scenarios.scenarios) {
    assert.ok(markup.includes(scenario.label), `offers the ${scenario.label} preset`);
  }
  // Retired copy from earlier drafts must not come back.
  assert.doesNotMatch(markup, /(?:01|02|03|04) \/|Editorial value picks|2 LANES|Recommendation choice|Choose the lane\. Know the limit\./i);
  assert.doesNotMatch(markup, /Best value for|Current best value snapshot|Use this profile|Use in My recommendation/i);
  assert.doesNotMatch(markup, /codex-preview|react-loading-skeleton/i);
});

test("Recommend puts the decision before the explanation", async () => {
  const markup = await html("/recommend/");

  // The primary questions come before the token detail, and every one of them
  // is on the page rather than behind a separate screen.
  assert.match(markup, /Work type/);
  assert.match(markup, /id="recommendation-profile"/);
  assert.match(markup, />Access</);
  assert.match(markup, /Calls \/ month/);
  assert.match(markup, /Budget \/ month/);
  assert.match(markup, /Token sizes and cache share/);
  assert.match(markup, /Input tokens \/ call/);
  assert.match(markup, /Output tokens \/ call/);
  assert.match(markup, /<span id="cache-unit">% of input<\/span>/);
  assert.ok(
    markup.indexOf("Token sizes and cache share") > markup.indexOf("Calls <!-- -->/<!-- --> month")
      || markup.indexOf("Token sizes and cache share") > markup.indexOf("Calls / month"),
    "volume and budget come before the token detail",
  );

  // One main recommendation, then the alternatives.
  assert.match(markup, /BEST PATH/);
  assert.match(markup, /Best path/);
  assert.match(markup, /Lowest cost/);
  assert.match(markup, /Best in budget/);
  assert.match(markup, /Most capable/);
  assert.match(markup, /Monthly cost by model/i);
  // Every access surface is selectable.
  for (const surface of ["Any surface", "Direct API", "Chat app", "Coding client"]) {
    assert.ok(markup.includes(surface), `offers the ${surface} requirement`);
  }
  // The verdict is above the settings that produced it.
  assert.ok(
    markup.indexOf("decision-banner") < markup.indexOf("recommendation-workspace"),
    "shows the verdict before the settings workspace",
  );
  // A share link is offered with a selectable fallback, not clipboard only.
  assert.match(markup, /Copy link/);
  assert.match(markup, /Share this comparison/);
});

test("the personal board is labelled as opinion and offers a non-drag path", async () => {
  const markup = await html("/tier-list/");

  assert.match(markup, /YOUR OPINION/);
  assert.match(markup, /your own opinion, kept separate from the calculated rankings/);
  assert.match(markup, /Board title/);
  assert.match(markup, /Use-case note/);
  assert.match(markup, /Unranked plans/);
  assert.match(markup, /Subscription plans/);
  assert.match(markup, /API models/);
  assert.match(markup, /Copy share link/);
  assert.match(markup, /Export/);
  assert.match(markup, /Import/);
  // WCAG 2.2 requires a non-drag alternative for a dragging interaction.
  assert.match(markup, /use each card’s move menu and the/);
  assert.match(markup, /class="visually-hidden">Move /);
  assert.match(markup, /Search name or provider/);
  assert.match(markup, /Filter by provider/);
  assert.match(markup, /draggable="true"/);
});

// -- Catalog is data, not code ------------------------------------------------

test("the catalog stays in validated data files", async () => {
  const [catalogSource, planSource, scenarioSource, formatLib, catalogIndex, catalogTypes] = await Promise.all([
    read("data/api-models.json"),
    read("data/plans.json"),
    read("data/scenarios.json"),
    read("lib/format.ts"),
    read("lib/catalog/index.ts"),
    read("lib/catalog/types.ts"),
  ]);
  const catalog = JSON.parse(catalogSource);
  const planCatalog = JSON.parse(planSource);
  const scenarios = JSON.parse(scenarioSource);
  const planById = new Map(planCatalog.plans.map((entry) => [entry.id, entry]));
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
  assert.ok(planById.get("opencode-go").modelIds.length > 5, "OpenCode Go lists the models its rate card publishes");
  assert.deepEqual(planById.get("chatgpt-plus").modelIds, ["gpt-5-6-luna", "gpt-5-6-terra", "gpt-5-6-sol"]);
  assert.deepEqual(planById.get("glm-coding-lite").modelIds, ["glm-5-3", "glm-5-3-flash"]);
  assert.deepEqual(planById.get("glm-coding-lite").creditMultipliers["glm-5-3"], [6.9, 1.7, 24]);
  assert.deepEqual(planById.get("glm-coding-lite").creditMultipliers["glm-5-3-flash"], [2.3, 0.56, 8]);
  assert.equal(planById.get("opencode-go").includedApiValue, 60);
  assert.ok(!("weeklyCredits" in planById.get("opencode-go")), "OpenCode Go is not credit-metered");

  // No stored tier letters anywhere: the board is derived from published scores.
  assert.doesNotMatch(catalogSource, /"tiers"/);
  assert.doesNotMatch(planSource, /"tiers"/);
  assert.match(catalogSource, /"capabilityIndex"/);
  for (const model of catalog.models) {
    assert.ok("capability" in model, `${model.id} declares a capability block`);
    if (model.capability !== null) {
      assert.equal(model.capability.indexVersion, catalog.capabilityIndex.version);
      assert.match(model.capability.source, /^https:\/\//);
    }
  }

  // Access surfaces are classified, and a surface claim has to be justified by
  // the plan's own recorded evidence rather than assigned in bulk.
  const surfaces = new Set();
  for (const plan of planCatalog.plans) {
    assert.ok(Array.isArray(plan.access) && plan.access.length > 0, `${plan.id} declares an access surface`);
    for (const surface of plan.access) {
      assert.ok(["api", "chat-app", "coding-client"].includes(surface), `${plan.id} surface ${surface} is known`);
      surfaces.add(surface);
    }
  }
  assert.deepEqual([...surfaces].sort(), ["api", "chat-app", "coding-client"], "every surface has at least one plan");
  assert.deepEqual(planById.get("cursor-pro").access, ["coding-client"], "an editor pool is not a chat app");
  assert.ok(planById.get("opencode-go").access.includes("api"), "an included API is recorded as one");
  assert.ok(planById.get("glm-coding-lite").access.includes("coding-client"));

  const medium = scenarios.scenarios.find((entry) => entry.id === "code-medium");
  const mediumQualifying = catalog.models.filter(
    (model) => (model.capability?.metrics?.[medium.gate.metric] ?? -Infinity) >= medium.gate.minIndex,
  );
  assert.ok(
    mediumQualifying.length >= 3 && mediumQualifying.length < catalog.models.length,
    `keeps Medium coding selective; ${mediumQualifying.length} of ${catalog.models.length} qualify`,
  );
  for (const entry of scenarios.scenarios) {
    assert.ok(entry.rationale.length > 30, `${entry.id} explains its profile`);
    assert.ok(entry.calls > 0 && entry.cacheRatio >= 0, `${entry.id} carries a call count and cache share`);
  }

  assert.match(formatLib, /function planQuota[\s\S]*?if \(plan\.id === "chatgpt-go"\) return plan\.quota;[\s\S]*?const modelClass/);
  assert.match(formatLib, /function monthlyPrice\(value: number\)/);
  assert.match(catalogIndex, /api-models\.json/);
  assert.match(catalogIndex, /const defaultScenario = scenarioFor\("code-medium"\)/);
  assert.match(catalogIndex, /const placementsByScenario/);
  assert.match(catalogTypes, /cacheRatio: number;/);
});

// -- Engine boundaries --------------------------------------------------------

test("the engine stays pure and the views stay presentational", async () => {
  const [placementLib, pricingLib, formatLib, decisionLib, workloadLib, urlStateLib, boardCodec, boardActions] =
    await Promise.all([
      read("lib/domain/placement.ts"),
      read("lib/domain/pricing.ts"),
      read("lib/format.ts"),
      read("lib/domain/decision.ts"),
      read("lib/domain/workload.ts"),
      read("lib/domain/url-state.ts"),
      read("lib/boards/codec.ts"),
      read("lib/boards/actions.ts"),
    ]);

  // Nothing in the engine may reach for React, the DOM, or the filesystem.
  for (const [name, source] of Object.entries({
    placementLib, pricingLib, formatLib, decisionLib, workloadLib, urlStateLib, boardCodec, boardActions,
  })) {
    // Word-boundary anchored so ordinary prose in a comment ("a chat window.")
    // is not mistaken for a browser global.
    assert.doesNotMatch(source, /from "react"|\bwindow\.[A-Za-z]|\bdocument\.[A-Za-z]|\blocalStorage\b|node:fs/, `${name} stays free of React, the DOM and the filesystem`);
    assert.doesNotMatch(source, /^"use client";/m, `${name} is not a client module`);
  }

  assert.match(placementLib, /function modelPlacements/);
  assert.match(placementLib, /function planPlacements/);
  assert.match(placementLib, /function planWorkingModel/);
  assert.match(placementLib, /function curveTiers/);
  assert.match(pricingLib, /const cacheRatio = cacheRatioOverride \?\? settings\.cacheRatio/);
  assert.match(pricingLib, /function planCoverageScore[\s\S]*?return null;[\s\S]*?\n}/);
  assert.match(formatLib, /function monthlyPriceAgainst\(value: number, reference: number\)/);
  assert.match(formatLib, /const contradicts = \(value > reference && rounded <= reference\)/);
  assert.match(formatLib, /\|\| \(value < reference && rounded > reference\)/);

  // Each route owns its own state; none of them mounts another route's feature.
  const rankings = await read("features/rankings/rankings-view.tsx");
  const recommend = await read("features/recommend/recommend-view.tsx");
  assert.doesNotMatch(rankings, /tier-list/);
  assert.doesNotMatch(recommend, /tier-list/);
  assert.doesNotMatch(rankings, /readBoards|writeBoards/, "visiting Rankings never touches a personal board");
  assert.doesNotMatch(recommend, /readBoards|writeBoards/, "visiting Recommend never touches a personal board");
});

// -- Ownership, licence, and delivery ----------------------------------------

test("keeps its ownership, licence and delivery guarantees", async () => {
  const [layout, packageJson, readme, workflow, license, robots, sitemap, viteConfig, gitignore, updater, nextConfig] =
    await Promise.all([
      read("app/layout.tsx"),
      read("package.json"),
      read("README.md"),
      read(".github/workflows/deploy.yml"),
      read("LICENSE"),
      read("public/robots.txt"),
      read("public/sitemap.xml"),
      read("vite.config.ts"),
      read(".gitignore"),
      read("scripts/update-models.mjs"),
      read("next.config.ts"),
    ]);
  const ogImage = await readFile(new URL("../public/og.png", import.meta.url));

  assert.match(readme, /## Ownership and independence/);
  assert.match(readme, /independent project created and maintained by Jin Ma/);
  assert.match(readme, /GitHub Pages is the published host/);
  assert.match(readme, /majinwakeup\.github\.io\/TokenTier/);
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Jin Ma/);
  assert.equal(JSON.parse(packageJson).license, "MIT");

  // The Sites packaging plugin is local-only, so the build must not require it.
  assert.match(viteConfig, /existsSync\(sitesPluginPath\)/);
  assert.match(viteConfig, /import\(\/\* @vite-ignore \*\/ pathToFileURL\(sitesPluginPath\)\.href\)/);
  assert.doesNotMatch(viteConfig, /^import \{ sites \}/m);
  assert.match(gitignore, /\/\.openai\//);
  assert.match(gitignore, /\/build\/sites-vite-plugin\.ts/);

  assert.match(workflow, /run: npm ci/);
  assert.match(workflow, /name: Verify Pages artifact contents/);
  assert.match(workflow, /path: \.\/out/);
  // Every route has to exist in the artifact, or a deep link 404s.
  assert.match(workflow, /test -f out\/recommend\/index\.html/);
  assert.match(workflow, /test -f out\/tier-list\/index\.html/);
  assert.match(workflow, /! -name recommend/);
  assert.match(workflow, /! -name tier-list/);
  // The exported routes are directories, so any static host can serve them.
  assert.match(nextConfig, /trailingSlash: true/);
  assert.match(nextConfig, /output: "export"/);

  assert.match(robots, /Sitemap: https:\/\/majinwakeup\.github\.io\/TokenTier\/sitemap\.xml/);
  for (const loc of ["", "recommend/", "tier-list/"]) {
    assert.ok(
      sitemap.includes(`<loc>https://majinwakeup.github.io/TokenTier/${loc}</loc>`),
      `sitemap lists /${loc}`,
    );
  }
  assert.ok(ogImage.length > 1_000, "exports a non-empty social preview PNG");

  assert.match(layout, /TokenTier/);
  assert.match(layout, /metadataBase:/);
  assert.match(layout, /alternates:\s*\{\s*canonical:/s);
  assert.match(layout, /summary_large_image/);
  assert.match(layout, /prefers-color-scheme: light/);

  // The updater checks the whole data set before it writes.
  assert.match(updater, /async function validateCompanions/);
  assert.match(updater, /await validateCompanions\(merged, resolvedCatalogPath, scenariosPath, plansPath\);/);

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

// -- Layout, density, and touch targets --------------------------------------

test("keeps its layout, density and touch-target contracts", async () => {
  const styles = await read("app/globals.css");
  const catalog = JSON.parse(await read("data/api-models.json"));

  const visiblePixelFontSizes = [...styles.matchAll(/font-size:\s*(\d+)px/g)]
    .map((match) => Number(match[1]))
    .filter((size) => size > 0);
  assert.ok(
    visiblePixelFontSizes.every((size) => size >= 13),
    "keeps every visible fixed pixel font at 13px or larger",
  );

  assert.match(styles, /\.explore-workspace\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 300px;/s);
  assert.match(styles, /\.scenario-dock\s*\{[^}]*position:\s*sticky;[^}]*grid-column:\s*2;/s);
  assert.match(styles, /@media \(max-width: 1120px\)[\s\S]*?\.scenario-dock\s*\{[^}]*position:\s*static;/s);
  assert.match(styles, /\.tier-models\s*\{[^}]*grid-auto-rows:\s*82px;/s);
  assert.match(styles, /\.tier-model\s*\{[^}]*height:\s*82px;[^}]*min-height:\s*82px;[^}]*overflow:\s*hidden;/s);
  assert.match(styles, /\.tier-model strong\s*\{[^}]*font-size:\s*15px;/s);
  assert.match(styles, /\.workspace-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3,/s);
  assert.match(styles, /\.rank-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  // Above 1180px the pool sits beside the tiers so a drag needs no mid-drag scroll.
  assert.match(styles, /@media \(min-width: 1180px\)[\s\S]*?\.rank-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(340px, 0\.62fr\);/s);
  assert.match(styles, /@media \(min-width: 1180px\)[\s\S]*?\.rank-pool\s*\{[^}]*position:\s*sticky;/s);
  // The move menu must be able to show its own option text.
  assert.match(styles, /\.rank-plan-card select\s*\{[^}]*min-width:\s*108px;/s);
  assert.match(styles, /\.rank-company-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit, minmax\(300px, 1fr\)\);/s);
  assert.match(styles, /\.recommendation-workspace\s*\{/);
  assert.match(styles, /\.plan-match-grid\s*\{/);
  assert.match(styles, /\.frontier-option\s*\{/);
  assert.match(styles, /\.mini-tier\.tier-c \{ background: var\(--tier-c-bg\); \}/);
  assert.match(styles, /\.mini-tier\.tier-d \{ background: var\(--tier-d-bg\); \}/);
  assert.match(styles, /\.compare-best-mark\s*\{[^}]*display:\s*inline;/s);
  assert.match(styles, /\.columns-reset-btn\s*\{[^}]*color:\s*var\(--accent-readable\);/s);
  assert.match(styles, /\.row-note summary\s*\{[^}]*background:\s*var\(--note-soft\);/s);
  assert.match(
    styles,
    /\.columns-trigger\s*\{[^}]*font-family:\s*var\(--font-geist-sans\), sans-serif;[^}]*font-size:\s*14px;/s,
  );

  // Every interactive control keeps a 44px hit box.
  assert.match(styles, /\.workspace-tabs button,\s*\n\.workspace-tabs a\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(styles, /\.theme-switcher button\s*\{[^}]*min-width:\s*38px;[^}]*min-height:\s*44px;/s);
  assert.match(styles, /\.provider-filters button\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(styles, /\.book-switch button\s*\{[^}]*min-height:\s*44px;/s);
  assert.match(styles, /\.rank-card-order button\s*\{[^}]*height:\s*44px;/s);
  assert.match(styles, /\.rank-meta-fields input\s*\{[^}]*min-height:\s*44px;/s);
  // Dense table controls grow their hit box with padding and cancel the shift.
  assert.match(styles, /\.table-item-name-btn\s*\{[^}]*padding:\s*12px 6px;[^}]*margin:\s*-12px -6px;/s);
  assert.match(styles, /\.index-value\s*\{[^}]*padding:\s*12px 10px;[^}]*margin:\s*-12px -10px;/s);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.source-link\s*\{[^}]*width:\s*40px;/s);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.cost-model \.recommendation-badge,[\s\S]*?grid-column:\s*1 \/ -1;/s);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.scenario-dock\s*\{[^}]*grid-template-columns:\s*minmax\(0, 0\.8fr\) minmax\(0, 1\.2fr\);/s);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*?\.table-tools-top\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s);
  assert.match(styles, /@media \(max-width: 560px\)[\s\S]*?\.workspace-tab-long\s*\{[^}]*display:\s*none;/s);
  assert.match(styles, /@media \(max-width: 420px\)[\s\S]*?\.tier-model\s*\{[^}]*grid-template-rows:[^}]*height:\s*94px;/s);
  assert.doesNotMatch(styles, /@media \(max-width: 360px\)[\s\S]*?\.theme-switcher button:first-child\s*\{[^}]*display:\s*none;/s);

  // Every provider in the catalog needs an orb colour of its own.
  for (const provider of new Set(catalog.models.map((model) => model.provider))) {
    assert.ok(
      styles.includes(`.provider-orb[data-provider="${provider}"]`),
      `styles define a provider orb for ${provider}`,
    );
  }
  assert.doesNotMatch(styles, /\.hero-card|\.scenario-tabs|\.price-scenario-tabs|\.call-profile/);
  assert.doesNotMatch(styles, /\.recommendation-intro/);
  assert.doesNotMatch(styles, /\.view-panel\[hidden\]/, "routes replaced the hidden view panels");
});

// --ink is the ink for coloured fills. On a dark inset panel it is invisible,
// which is how the capability bar and the index column came to render as blank
// gaps in dark mode while looking fine in light mode.
test("never puts fill-ink on a plain surface", async () => {
  const styles = await read("app/globals.css");

  const darkTokens = styles.slice(0, styles.indexOf('html[data-theme="light"]'));
  const value = (name) => darkTokens.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
  assert.equal(value("ink"), "#0b0d13", "dark --ink stays the ink for coloured fills");

  // Every rule that paints with --ink must sit on a coloured fill.
  const onColouredFill = [
    "::selection", ".skip-link", ".brand-mark", ".workspace-tabs a.active",
    ".theme-switcher button.active", ".button-primary",
    ".tier-s .tier-label", ".tier-a .tier-label", ".tier-b .tier-label", ".tier-c .tier-label",
    ".tier-d .tier-label",
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
  const styles = await read("app/globals.css");
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
