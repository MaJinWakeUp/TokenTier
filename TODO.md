# TokenTier — UI/UX Cleanup TODO (declutter pass)

The last pass implemented almost every feature at once. The functionality is
good, but the page now feels messy: the same information is repeated in 2–3
places, emoji/glyphs/SVGs are mixed inconsistently, and several elements
compete for attention at full visual weight. This TODO is a **simplification
and polish pass** — no new features.

Design rules for this pass:

1. **Say it once.** Every fact (price, date, verdict, hint) appears in exactly
   one place per screen.
2. **One accent per element.** If a badge/chip/bar/kbd doesn't change a
   decision, remove it.
3. **One icon system.** Inline SVG only (match the theme-switcher icons:
   16 px, `stroke="currentColor"`, strokeWidth 2). No emoji, no text glyphs
   (✕ ↑ ↗ ⌕ ▾ ⓘ) where an SVG or plain word works.
4. Features stay — presentation gets quieter.

---

## A. Remove duplication — `[P0]`

- [x] **A1. Freshness is shown 3×.** It appears in the header (`.freshness`),
  the hero stats strip ("Verified {date}"), and the footer
  (`.footer-freshness`). Keep the footer one (visible on all screen sizes) and
  the header one on desktop; **remove "Verified …" from the hero stats strip**
  (`page.tsx` ~line 1211).
- [x] **A2. Decision banner says everything 3×.** The banner has the long
  verdict paragraph (`decision-verdict-text`) + a 3-fact strip
  (`decision-facts-strip`), and the two path cards directly below repeat the
  same numbers. **Delete the long verdict paragraph** and keep the facts strip
  (it is the scannable version). Move any unique nuance from `verdictCopy`
  into a one-line caption under the strip. Remove now-dead `verdictCopy`
  branches.
- [x] **A3. Two sort UIs.** Columns are sortable via clickable headers AND the
  "Sort" dropdown (`page.tsx` ~line 1378). **Remove the Sort dropdown**; keep
  header clicks (add `title="Sort by …"` on each sortable `th` for
  discoverability). Remove the now-unused `sortBy` option lists.
- [x] **A4. Two "go to recommendation" CTAs.** The hero has "Get a
  recommendation →" and the scenario dock has "Customize in Recommend →"
  (`.scenario-dock-action`, ~line 1235). Keep the dock one (it's contextual);
  make the hero button secondary/ghost style, or remove it and let the hero be
  just headline + stats. Pick one primary CTA for the explore view.
- [x] **A5. Shortcut hints are doubled.** Tab buttons have both
  `<kbd>⌘1</kbd>` and `title="… (⌘1)"`; the search field has `<kbd>/</kbd>`
  AND the placeholder text "(/ to focus)". Keep the `<kbd>` elements, drop the
  shortcut from the `title` attributes, and restore the plain placeholders
  ("Search model or provider" / "Search plan, client, or provider").

## B. Fix wrong-context / incorrect content — `[P0]`

- [x] **B1. "Recommended" chips in the Explore price book use the wrong
  context.** They are driven by recommendation-view state (custom tokens,
  calls, budget — `apiRecommendation`/`planRecommendation`), so the Explore
  table shows a chip computed from a different scenario than the one being
  viewed. **Remove the `recommended-row` / `recommended-chip` from the Explore
  tables entirely** (`page.tsx` ~lines 1499–1509, 1590–1600). Keep
  recommendation badges only inside the recommendation view.
- [x] **B2. Detail modal hardcodes "500 Calls / Month".** (`page.tsx` ~line
  1942) It ignores the user's actual `monthlyCalls`. Either compute from
  `monthlyCalls` and label it "{monthlyCalls} calls / month", or drop that
  spec box.
- [x] **B3. Footer anchor links are dead in the recommendation view.**
  `#methodology`, `#prices`, `#price-sources` live inside the explore panel,
  which is `hidden` when the recommendation view is active — clicking them
  does nothing there. Make these links call `switchView("explore")` first,
  then scroll to the anchor (or remove the in-page links and keep only
  GitHub/corrections).
- [x] **B4. The "Difference" fact caption is sometimes wrong.**
  (`page.tsx` ~line 1723) "Plan offers higher volume" is asserted whenever the
  plan path is preferred, but the plan may be preferred for budget reasons.
  Derive the caption from actual values: cheaper → "saves $X/mo", else "costs
  $X/mo more, covers N calls".
- [x] **B5. Don't compare apples to oranges.** The compare tray accepts API
  models AND subscription plans simultaneously, producing incoherent table
  rows ("Subscription plan" under "Est. Cost / Call"). Restrict the tray to
  one kind at a time: adding an item of the other kind clears or replaces, and
  the tray label should say "Compare models" / "Compare plans".

## C. Unify iconography — `[P0]`

- [x] **C1. Replace all emoji with SVG or words.** Current offenders:
  `⚠️` in `.budget-fallback-banner` (~line 1688) and `.confidence-caveat-badge`
  (~line 1834), `⎘` and `✓` in the copy-link button (~line 1704). Create a tiny
  `Icon` component (warning-triangle, check, copy/link, close, arrow-up) with
  the theme-switcher SVG style and use it everywhere. The copy button should
  swap icon + text ("Copy link" → "Copied") without emoji.
- [x] **C2. Replace text glyphs in chrome.** `✕` close buttons, `↑ Top`,
  `↗` source links, `⌕` search icon, `▾` columns trigger — convert to the same
  SVG set so weight/size/color are consistent in both themes.

## D. Calm the visual noise — `[P1]`

- [x] **D1. Preset chips: 4 rows × 4 chips is too much.** The settings card
  now has 16 chips (`page.tsx` lines 1744–1788), making it tall and busy —
  especially on mobile. Keep chips only for the two token fields (the tedious
  ones); remove the Calls and Budget chip rows (those are short numbers, easy
  to type).
- [x] **D2. Cost bars: keep one, drop one.** The recommendation "Monthly cost
  by model" list benefits from `cost-row-bar`. The price-book table
  (`.cost-bar-track`/`.cost-bar-fill` in the Est./call cell, ~line 1523) is
  already dense — remove the bars there and let the bold price + sorting do
  the work.
- [x] **D3. Info ⓘ icons inside sortable headers conflict.** Clicking ⓘ sorts
  the column, and `title`-only tooltips don't work on touch/keyboard. Remove
  the `<abbr className="info-tooltip">` from sortable `th`s; the methodology
  accordion already explains the terms. (Keep it, if anywhere, only on
  non-sortable headers like "API-cost equivalent".)
- [x] **D4. Reduce chip/badge stacking in table name cells.** The first column
  now stacks: name button + provider + Note + (currently) Recommended chip +
  source ↗. After B1 removes the chip, also tighten: keep `Note` disclosure
  and source link on one line or merge the source link into the detail modal
  only (the modal already has "Official source ↗"), so rows aren't triple
  height.
- [x] **D5. Quiet the fallback banner.** `role="alert"` + `⚠️` + "Notice:" is
  heavy for an expected state. Restyle as a neutral info line inside the
  decision banner (accent-soft background, no alert role — use the existing
  `aria-live` region), e.g. "No model fits this budget — showing the cheapest
  option."
- [x] **D6. One floating element at a time.** Compare tray (bottom-center) and
  back-to-top (bottom-right) can collide and both cover footer content. When
  the tray is visible, hide back-to-top (scroll position is recoverable; the
  tray is task-critical). Also give the tray `bottom: calc(24px +
  env(safe-area-inset-bottom))` and add page bottom padding while it's shown
  so it never covers the footer.

## E. Complete the accessibility work — `[P1]`

The last pass added ARIA in some places but left gaps:

- [x] **E1. Modal focus management.** Modals close on Escape (good) but: focus
  is not moved into the dialog on open, Tab is not trapped, focus is not
  restored to the trigger on close, and the body still scrolls behind the
  backdrop. Implement: on open, focus the close button (or dialog with
  `tabIndex={-1}`); trap Tab within; `document.body.style.overflow = "hidden"`
  while open; restore focus to the element that opened it.
- [x] **E2. Fix the half-done list roles.** Tier rows have `role="list"` but
  the cards are `<button>` without `role="listitem"`. Add the missing roles or
  drop `role="list"` — don't leave it ambiguous.
- [x] **E3. Tier card labels are too long.** `aria-label` includes the full
  price sentence plus "Click for details". Shorten to name + provider + price;
  add a single visually-hint text under the board ("Select a card for
  details") instead of repeating it on every card.
- [x] **E4. Compare tray announce.** When an item is added/removed, push a
  message to the existing `liveAnnouncement` region ("GPT-5.6 added to
  comparison, 2 of 3").
- [x] **E5. Keyboard operability check for compare.** There is no way to add
  to compare without opening the modal (the "+ Add to compare" button only
  exists in the modal footer). Add a small compare toggle on tier cards /
  table rows (icon button with `aria-pressed`), or accept modal-only but
  document it; don't ship a mouse-first flow.

## F. Mobile audit — `[P1]`

- [x] **F1.** Check 360–420 px widths end-to-end after A–D land: tab `<kbd>`
  hints should be hidden below 680 px (`.tab-shortcut-kbd`), the search `<kbd>`
  hidden on touch, tray collapses to a single "Compare (2)" bar, decision
  facts strip stacks vertically.
- [x] **F2. Settings card height.** After D1, verify the settings card fits a
  phone viewport without internal scroll traps; fieldsets should not require
  scrolling past 16 chips.
- [x] **F3. Table first-column sticky + name stacking.** Verify the sticky
  column (`.sticky-col`) doesn't consume >60% of viewport width on phones; if
  it does, reduce its content (drop the Note disclosure on small screens) or
  fall back to the stacked-card layout from the previous TODO.

## G. Code health — `[P2]`

- [x] **G1. Consolidate the new CSS.** The ~770 new lines were appended as one
  flat block (roughly `globals.css` 2785–3552). Move each rule next to its
  related existing section (modal styles near `.tier-*`/`.section`, header kbd
  styles near `.workspace-tabs`, footer styles near existing `footer`) so
  breakpoints and theme overrides stay discoverable.
- [x] **G2. Deduplicate modal markup.** `.detail-modal` and `.compare-modal`
  repeat backdrop/header/close markup. Extract a small `Modal` wrapper
  component (backdrop + Escape + focus trap from E1 + header slot).
- [x] **G3. Dead-code sweep.** After A2/A3/B1, remove unused state, CSS
  classes, and the `.tier-model.selected` style if compare no longer uses it
  (or wire it to the tray consistently).
- [x] **G4. Verify.** Run `npm run lint` and `npm test`; the rendered-page
  tests assert on markup that this pass changes — update assertions for
  removed elements (sort dropdown, verdict paragraph, explore-table chips).

---

## Explicitly out of scope for this pass

- New features (scenario comparison, density toggles, animations of price
  changes, glossary tooltips beyond methodology).
- Re-themeing or token changes — the current palette/type scale is fine; the
  problem is element count and repetition, not the design system.

## When done

The explore view should read top-to-bottom as: header → hero (headline, one
sub, one stats line, one CTA) → preset dock + tier list → price book →
methodology → sources → footer. The recommendation view: header → one banner
(verdict + 3 facts + share) → settings | best-path cards → detailed
comparison → footer. No element should repeat a fact already on screen.
