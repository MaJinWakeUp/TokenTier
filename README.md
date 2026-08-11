# TokenTier

TokenTier is a price-aware comparison of current AI models and consumer plans.
It combines scenario tier lists, standard API token rates, and transparent
subscription-to-API spend estimates.

## What it compares

- Daily use, easy/medium/difficult coding, research, paper writing, and innovation
- Standard input, cached-input, and output prices in USD per 1M tokens
- Estimated per-call and monthly API spend from disclosed token profiles
- Consumer subscription prices and their theoretical API-cost equivalents

The equivalence figures are economic comparisons, not provider quotas or API
credits. Prices were checked against official provider sources on August 10,
2026; temporary, threshold, and volatile prices are labeled in the interface.

## Local development

Requires Node.js `>=22.13.0`.

```bash
npm install
npm run dev
```

Use `npm run build` for a deployment build and `npm test` for the rendered-page
checks. The site uses the bundled vinext and Sites hosting structure.
