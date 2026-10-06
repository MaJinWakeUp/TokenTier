# Price book search

The price book on rankings filters the current lane by provider and name. On the API lane the searchbox is named `Search api`.

## Sub-features

- `search-match` keeps rows whose provider or name contains the query.
- `search-miss` shows the empty price book when nothing matches.
- `search-clear` restores the full API table.

## How to get to it (user POV)

- Open `/` and use the search field in the Price book section.
- Press `/` while focus is outside an input, select, or textarea. That focuses the same search field.
- Switch to `Plans & access` in the group `Price book lane` to search plans instead. That searchbox is named `Search plans`.

## Driving it with verify-tokentier

Preconditions:

- `doctor` reports `listener: owned`.
- `open /` has reached `scenario=code-medium`.
- The price book lane is still API rates, the default.

- **Match.** Type `Haiku`. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs fill --label "Search api" --value "Haiku"`. The Price book text contains `Claude Haiku 4.5` and does not contain `GPT-6 Astra`. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs text --id prices`.
- **Miss.** Replace the query with `zzznomatch`. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs fill --label "Search api" --value "zzznomatch"`. The Price book text contains `No entries match that search or provider filter.`
- **Clear.** Empty the field. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs fill --label "Search api" --value ""`. The Price book text contains `GPT-6 Astra` again.
- **Proof.** After the Haiku query, run `node .cursor/skills/verify-tokentier/scripts/verify.mjs snapshot --path price-book/haiku.aria.txt` and `node .cursor/skills/verify-tokentier/scripts/verify.mjs screenshot --path price-book/haiku.png`. The snapshot contains a searchbox named `Search api` and the screenshot shows `Claude Haiku 4.5`.

## Gotchas

- The API search `aria-label` is `Search api`, lowercase, because the lane id is `api`. The placeholder is `Search model or provider`.
- `/` types a slash into the field when the searchbox, another input, or a select already has focus.
- The `API rates` button count is the full catalog size. It does not shrink when the query filters the table. Read the table text, not that count.
- Search is page state only. Reload clears it. The `scenario` query stays.
