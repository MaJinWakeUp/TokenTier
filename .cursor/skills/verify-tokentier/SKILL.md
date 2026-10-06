---
name: verify-tokentier
description: "Drive the TokenTier web app the way a reader does — rankings presets, the price book, recommendations, and the personal tier list — and keep screenshots plus page state as proof. Use for a TokenTier UI change, or when rankings, recommend, or my tier list behavior has to be shown working."
---

# Verify TokenTier

TokenTier is a local web app. A reader uses three routes: Rankings (`/`), Recommend (`/recommend/`), and My tier list (`/tier-list/`). This skill launches a dev server this run owns, drives it with headless Chrome, and stores proof under the run directory.

The feature map in `features/` is the source for what to drive. A proof that uses one convenient entry point is incomplete when the map lists others.

## Launch

From the TokenTier repo root:

```bash
eval "$(node .cursor/skills/verify-tokentier/scripts/verify.mjs launch)"
```

That starts `npm run dev -- --port <free> --hostname 127.0.0.1` on a port at or above `4173`, waits until `http://127.0.0.1:<port>/` returns HTTP 200 and a body that contains `TokenTier`, and prints `export TOKENTIER_VERIFY_DIR=...`. Pass `--port` only when a specific port is required. Pass `--dir` to choose the run directory; the default is `/tmp/tokentier-verify/<run-id>`.

Ready means that HTTP response, not a fixed sleep. The dev log is `$TOKENTIER_VERIFY_DIR/dev.log`.

vinext allows one dev server per checkout. The lock is `.vinext/dev/lock.json`. If another server is already running, `launch` exits and names that server. Do not kill its pid, and do not drive its URL. Two verification runs cannot share this checkout. Browser profiles are separate per `TOKENTIER_VERIFY_DIR`, but the server is not.

Node.js `>=22.13.0` is required, the same as the repo. Driving the page requires `google-chrome` on `PATH`, or `CHROME_PATH`.

## Doctor

```bash
node .cursor/skills/verify-tokentier/scripts/verify.mjs doctor
```

Run this before driving whenever something looks off. It exits 0 only when all of these are true:

- `state.json` says `running` and the recorded pid is alive
- the listener on that port is in that pid's process tree
- `GET /` is HTTP 200 and the HTML title contains `TokenTier`

A foreign process on the port fails the doctor. Do not point Chrome at it.

## Drive

Every command below reads `TOKENTIER_VERIFY_DIR`. Chrome starts on the first browser command, headless, `--lang=en-US`, with a user-data-dir inside the run directory so theme, workload, and boards do not leak into another run or into a reader's browser.

```bash
node .cursor/skills/verify-tokentier/scripts/verify.mjs open /
node .cursor/skills/verify-tokentier/scripts/verify.mjs open /recommend/
node .cursor/skills/verify-tokentier/scripts/verify.mjs open /tier-list/
node .cursor/skills/verify-tokentier/scripts/verify.mjs click --label "Dark theme"
node .cursor/skills/verify-tokentier/scripts/verify.mjs click --role link --name "Recommend"
node .cursor/skills/verify-tokentier/scripts/verify.mjs click --role button --name "Plans" --group "Tier list lane"
node .cursor/skills/verify-tokentier/scripts/verify.mjs select --id explore-scenario --value research
node .cursor/skills/verify-tokentier/scripts/verify.mjs fill --label "Search api" --value "Haiku"
node .cursor/skills/verify-tokentier/scripts/verify.mjs fill --labeled "Board title" --value "Verification board"
node .cursor/skills/verify-tokentier/scripts/verify.mjs text --id profile-preset-title
node .cursor/skills/verify-tokentier/scripts/verify.mjs attr --id explore-scenario --name value
node .cursor/skills/verify-tokentier/scripts/verify.mjs url
node .cursor/skills/verify-tokentier/scripts/verify.mjs storage --key tokentier.v1.boards
node .cursor/skills/verify-tokentier/scripts/verify.mjs wait --url-includes "scenario=research"
node .cursor/skills/verify-tokentier/scripts/verify.mjs wait --id profile-preset-title --text "Research"
node .cursor/skills/verify-tokentier/scripts/verify.mjs snapshot --path rankings-preset/page.aria.txt
node .cursor/skills/verify-tokentier/scripts/verify.mjs screenshot --path rankings-preset/page.png
```

`--label` matches an `aria-label` exactly. `--role` and `--name` match the visible accessible name, and a trailing count still matches (`Plans` matches `Plans 12`). `--group` limits the search to a `role="group"` with that `aria-label`. `--labeled` finds a `<label>` whose first `<span>` text is exact, then the control inside it. `select` and `fill` set the DOM value and dispatch `input` and `change`, which is what the React controls listen to.

Wait for hydration before changing a control. Rankings writes `?scenario=code-medium` only after it has read the URL. Recommend writes the full workload query only after the same. Changing either select earlier races that write.

Follow `features/` for the entry points, commands, and end states. Stable handles:

| Handle | Where |
|---|---|
| `aria-label="TokenTier home"` | Brand link |
| `nav[aria-label="Sections"]` links `Rankings`, `Recommend`, `My tier list` | Header |
| `#explore-scenario` | Rankings use-case `<select>` |
| `#profile-preset-title` | Rankings preset heading |
| `.preset-call` `aria-label` | Rankings typical-month summary |
| `role="group" aria-label="Tier list lane"` | `API models` / `Plans` |
| `role="group" aria-label="Price book lane"` | `API rates` / `Plans & access` |
| `aria-label="Search api"` or `aria-label="Search plans"` | Price book search |
| `#recommendation-profile` | Recommend work type |
| `#recommendation-title` | `Best path` |
| `.decision-workload` | Recommend verdict line |
| `#rank-top-heading` | `Rank them your way.` |
| `role="group" aria-label="Rank subject"` | `Subscription plans` / `API models` |
| label span `Board title` | Personal board title |
| `.rank-status` | Includes `Saved in this browser.` after a real write |
| `aria-label="Theme"` | `Auto theme (follow system)`, `Light theme`, `Dark theme` |

## Evidence

Write proof under `$TOKENTIER_VERIFY_DIR/evidence/`. Relative `--path` values are resolved there. Capture the action and the resulting state:

- the command stdout (selected value, heading text, URL)
- an accessibility snapshot (`snapshot`)
- a screenshot (`screenshot`) that shows the heading the action changed
- a side effect, not only the screen. Rankings and Recommend persist the choice in the URL (`history.replaceState`). My tier list persists the board in `localStorage` key `tokentier.v1.boards`. Read it with `storage`. Theme persists in `tokentier-theme` and on `document.documentElement` `data-theme`.

Exercise the page a reader loads. Do not call catalog functions, test-only endpoints, or React state setters. There is no separate dry-run mode. The dev server serves the same UI as `npm run dev`.

Number formatting in aria text uses the browser locale. Chrome is started with `--lang=en-US`, so token counts render as `60,000`.

## Cleanup

```bash
node .cursor/skills/verify-tokentier/scripts/verify.mjs stop
```

`stop` sends `SIGTERM`, then `SIGKILL`, to the process groups of the dev server and Chrome that this run started. It deletes the Chrome profile. It does not delete `$TOKENTIER_VERIFY_DIR/evidence`. After `stop`, `state.json` has `"status": "stopped"` and `doctor` fails. Confirm the screenshot and snapshot are still in `evidence/` before treating the run as finished.

Do not kill a process by name. Do not stop a vinext pid that `launch` did not record.

## Helpers

The only helper is `scripts/verify.mjs`, already executable. Invoke it as shown above from the repo root. `node --check .cursor/skills/verify-tokentier/scripts/verify.mjs` parses it. Commands: `launch`, `doctor`, `stop`, `open`, `click`, `select`, `fill`, `text`, `attr`, `url`, `storage`, `wait`, `snapshot`, `screenshot`.
