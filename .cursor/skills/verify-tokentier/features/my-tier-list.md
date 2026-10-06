# My tier list

My tier list is the reader's own board, stored in this browser. A title edit that succeeds says `Saved in this browser.` and is readable from `localStorage`.

## Sub-features

- `board-open` shows an empty personal board titled from the placeholder.
- `board-title` saves a title into `tokentier.v1.boards`.
- `board-subject` switches between subscription plans and API models.

## How to get to it (user POV)

- Choose `My tier list` in the Sections nav.
- Open `/tier-list/`.
- Choose `Subscription plans` or `API models` in the group named `Rank subject`.

## Driving it with verify-tokentier

Preconditions:

- `doctor` reports `listener: owned`.
- The Chrome profile has no `tokentier.v1.boards` entry. A fresh `launch` profile satisfies this.

- **Open.** Open the board. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs open /tier-list/`. The heading is present. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs wait --id rank-top-heading --text "Rank them your way."`.
- **Title.** Type a title. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs fill --labeled "Board title" --value "Verification board"`. The status line says it was saved. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs wait --selector ".rank-status" --text "Saved in this browser."`. The stored record contains the title. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs storage --key tokentier.v1.boards`.
- **Subject.** Switch to API models. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs click --role button --name "API models" --group "Rank subject"`. A snapshot shows that button `pressed=true`. The plans board title is not required to match the models board; each subject is stored separately.
- **Proof.** Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs snapshot --path my-tier-list/title.aria.txt` and `node .cursor/skills/verify-tokentier/scripts/verify.mjs screenshot --path my-tier-list/title.png` after the title save. The screenshot shows `Verification board` in the title field and `Saved in this browser.`

## Gotchas

- `Saved in this browser.` is absent when the write failed or the board is still pristine. An empty title on a fresh board does not show it.
- The storage key is `tokentier.v1.boards`. Theme uses the separate key `tokentier-theme`.
- Subject buttons include a count (`API models 30`). Match the prefix `API models`.
- A shared board link opens a preview and does not replace the saved board until `Use this board` is pressed. Do not treat a preview as a saved board.
