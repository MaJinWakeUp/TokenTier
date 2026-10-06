# Recommend

Recommend asks for a work type, access, call volume, and budget, then shows a best path. A fresh profile already has Medium coding selected, a $30 budget, and any surface.

## Sub-features

- `recommend-default` opens with Medium coding and a best path.
- `recommend-work-type` replaces the token profile with the chosen preset and keeps the budget.
- `recommend-link` opens a shared workload from the query string.

## How to get to it (user POV)

- Choose `Recommend` in the Sections nav.
- Open `/recommend/`.
- Open a shared URL that includes `scenario`, `input`, `output`, `calls`, `cache`, `budget`, `access`, `preference`, and `priority`.
- From rankings, choose `Get a recommendation`. That link carries the current preset's token counts and does not reset budget or access.

## Driving it with verify-tokentier

Preconditions:

- `doctor` reports `listener: owned`.
- The Chrome profile has no saved workload. A fresh `launch` profile satisfies this.

- **Default.** Open Recommend. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs open /recommend/`. Wait for hydration. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs wait --url-includes "scenario=code-medium"`. The work-type select value is `code-medium`. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs attr --id recommendation-profile --name value`. The heading Best path is on the page. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs text --id recommendation-title`.
- **Work type.** Choose Research. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs select --id recommendation-profile --value research`. The URL contains `scenario=research`, `input=60000`, `output=4000`, `calls=200`, and `budget=30`. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs wait --url-includes "scenario=research"`. The verdict line names Research. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs wait --selector ".decision-workload" --text "Research"`.
- **Shared link.** Open the research workload directly. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs open "/recommend/?scenario=research&input=60000&output=4000&calls=200&cache=0.25&budget=30&preference=either&priority=cost&access=any"`. After hydration the work-type value is `research` and `.decision-workload` contains `Research`.
- **Proof.** Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs snapshot --path recommend/research.aria.txt` and `node .cursor/skills/verify-tokentier/scripts/verify.mjs screenshot --path recommend/research.png` on the Research verdict. The snapshot contains the heading `Best path` and the screenshot shows `Research`.

## Gotchas

- Wait for `scenario=code-medium` in the URL before changing the work type. Hydration writes the query and would otherwise put Medium coding back.
- Choosing a work type replaces input, output, calls, and cache with that preset. Budget and access stay.
- Until a work type is chosen, the page shows a prompt instead of Best path. A fresh profile has already chosen Medium coding. A profile migrated from the old flat keys has not.
- The capability bar depends on the work type. Do not treat a model name from Medium coding as the Research answer.
