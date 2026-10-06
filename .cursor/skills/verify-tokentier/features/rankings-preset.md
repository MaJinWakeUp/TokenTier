# Rankings preset

The rankings page prices one workload preset at a time. Changing the use case updates the dock heading, the typical-month summary, and the `scenario` query.

## Sub-features

- `preset-default` opens on Medium coding.
- `preset-select` changes the use case from the dock select.
- `preset-link` opens a preset from `/?scenario=research`.

## How to get to it (user POV)

- Open `/`.
- Choose a use case in the Profile preset dock.
- Open `/?scenario=research`.
- Choose the `Rankings` link in the Sections nav from another route.

## Driving it with verify-tokentier

Preconditions:

- `doctor` reports `listener: owned` and a TokenTier title.
- `TOKENTIER_VERIFY_DIR` is the directory `launch` printed.

- **Default preset.** Open rankings. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs open /`. Wait for hydration. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs wait --url-includes "scenario=code-medium"`. The heading is Medium coding. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs text --id profile-preset-title`. The select value is `code-medium`. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs attr --id explore-scenario --name value`.
- **Select Research.** Change the use case. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs select --id explore-scenario --value research`. The command prints `research`. The heading becomes Research. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs wait --id profile-preset-title --text "Research"`. The URL contains `scenario=research`. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs wait --url-includes "scenario=research"`. The typical-month summary names 60,000 input and 4,000 output tokens. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs attr --selector ".preset-call" --name aria-label`.
- **Direct link.** Open the research URL. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs open "/?scenario=research"`. The same heading and `scenario=research` URL appear after `wait --id profile-preset-title --text "Research"`.
- **Proof.** Capture the Research dock. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs snapshot --path rankings-preset/page.aria.txt` and `node .cursor/skills/verify-tokentier/scripts/verify.mjs screenshot --path rankings-preset/page.png`. The snapshot contains a heading `Research` and the screenshot shows that heading.

## Gotchas

- The page writes `?scenario=code-medium` during hydration. Selecting a preset before `wait --url-includes "scenario=code-medium"` can be overwritten.
- `scenario` values are ids (`code-medium`, `research`), not labels (`Medium coding`, `Research`).
- The typical-month `aria-label` uses the browser locale. This harness runs Chrome with `--lang=en-US`.
- The preset is kept in the URL, not in `localStorage`.
