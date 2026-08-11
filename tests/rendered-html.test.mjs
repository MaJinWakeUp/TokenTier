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
  assert.match(html, /Choose the lane/);
  assert.match(html, /API VS PLAN RECOMMENDER/i);
  assert.match(html, /OpenCode Go/);
  assert.match(html, /GLM-5\.2/);
  assert.match(html, /Kimi K3/);
  for (const model of catalog.models) {
    assert.ok(html.includes(model.name), `renders catalog model ${model.name}`);
  }
  assert.match(html, /Every model at your monthly volume/i);
  assert.match(html, /Easy coding/);
  assert.match(html, /Medium coding/);
  assert.match(html, /Hard coding/);
  assert.match(html, />Research</);
  assert.match(html, /Updated\s*(?:<!-- -->)?\s*Aug 11, 2026/);
  assert.doesNotMatch(html, /04 \/ READ THE LABEL/);
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
  assert.match(styles, /\.hero-card::before\s*\{[^}]*inset:\s*0;[^}]*border-radius:\s*27px;/s);
  assert.doesNotMatch(page, /codex-preview|_sites-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
