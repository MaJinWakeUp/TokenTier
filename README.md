# TokenTier

TokenTier is a price-aware comparison of current AI models and consumer plans.
It combines scenario tier lists, standard API token rates, and transparent
subscription-to-API spend estimates.

## Ownership and independence

TokenTier is an independent project created and maintained by Jin Ma. It is not
affiliated with or endorsed by the AI providers listed on the site. Product
names and trademarks belong to their respective owners. The source code is
available under the MIT License.

## What it compares

- Daily use, easy/medium/hard coding, research, paper writing, and innovation
- Standard input, cached-input, and output prices in USD per 1M tokens
- Estimated per-call and monthly API spend from disclosed token profiles
- Consumer subscription prices and their theoretical API-cost equivalents

The equivalence figures are economic comparisons, not provider quotas or API
credits. Prices were checked against official provider sources on August 16,
2026; temporary, threshold, and volatile prices are labeled in the interface.

## Refresh the API model catalog

API models live in `data/api-models.json`. To add one later, create a JSON file
containing one complete model record (or an array of records), then preview and
apply it:

```bash
npm run models:update -- add ./new-model.json --dry-run
npm run models:update -- add ./new-model.json
```

Use `update` instead of `add` to replace an existing record. Each record must
include its official source, verification date, token rates, context window,
and all seven scenario tiers. The updater validates the complete catalog and
will not scrape or guess provider data.

```bash
npm run models:update -- update ./updated-model.json
npm run models:validate
```

The page automatically picks up the refreshed model count, provider filters,
tier lists, recommendations, cost list, price book, source links, and update
date. Only one write runs at a time. If an updater is force-terminated and
leaves `data/api-models.json.lock`, confirm no update is still running, delete
that stale lock file, and retry.

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Use `npm run build` for a deployment build and `npm test` for the rendered-page
checks. The site uses the bundled vinext and Sites hosting structure.
