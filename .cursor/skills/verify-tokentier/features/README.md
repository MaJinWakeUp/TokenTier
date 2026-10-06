# TokenTier verification map

This directory is the maintained source for verifying the user-facing behavior of TokenTier. Read the index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `node .cursor/skills/verify-tokentier/scripts/verify.mjs launch` and export `TOKENTIER_VERIFY_DIR`.
- Run `doctor` and require `listener: owned`, HTTP 200, and a title containing `TokenTier`.
- Chrome uses a fresh profile inside that directory. Theme, workload, and boards start empty.
- vinext allows one dev server per checkout. Never drive a server this run did not start.
- The app opens on the Medium coding preset (`code-medium`).

## Driving conventions

- Start every recipe from a fresh profile unless its preconditions say otherwise.
- Prefer ids, `aria-label`s, and group names over CSS position.
- Treat every command as literal. Keep quoted names and flags unchanged.
- Wait until the URL shows the hydrated preset before changing a select.
- Restore nothing on the server. Rankings and Recommend state live in the URL. My tier list state lives in this profile's `localStorage`.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- UI proof includes an accessibility snapshot and a screenshot with the changed heading visible.
- URL proof is `url` after the page has replaced the query.
- Board proof is `storage --key tokentier.v1.boards` plus the `.rank-status` text `Saved in this browser.`
- Record the feature file and the entry point with the artifacts.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with verify-tokentier` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Rankings preset](./rankings-preset.md) covers the use-case select and a direct `?scenario=` link.
- [Tier list lane](./tier-lane.md) covers switching the rankings board between API models and plans.
- [Price book search](./price-book.md) covers search on the rankings price book.
- [Recommend](./recommend.md) covers choosing a work type and reading the best path.
- [My tier list](./my-tier-list.md) covers the personal board title and subject switch.
