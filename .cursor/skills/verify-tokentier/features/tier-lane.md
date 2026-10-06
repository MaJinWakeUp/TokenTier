# Tier list lane

On rankings, the tier board shows either API models or subscription plans for the current preset. The lane buttons sit in the group named `Tier list lane`.

## Sub-features

- `lane-default` opens on API models.
- `lane-plans` switches the board to plans.
- `lane-api` switches the board back to API models.

## How to get to it (user POV)

- Open `/` and scroll to the Tier list section.
- Choose `Plans` or `API models` in that section's switch.
- The price book has a separate switch. It is not this control.

## Driving it with verify-tokentier

Preconditions:

- `doctor` reports `listener: owned`.
- Rankings has hydrated: `wait --url-includes "scenario=code-medium"` after `open /`.

- **Default lane.** The API models button in `Tier list lane` is pressed. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs snapshot --path tier-lane/before.aria.txt`. The snapshot contains `pressed=true` on the button whose name starts with `API models` and `pressed=false` on the button whose name starts with `Plans`.
- **Plans lane.** Choose Plans. Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs click --role button --name "Plans" --group "Tier list lane"`. A new snapshot at `tier-lane/plans.aria.txt` shows `pressed=true` on the Plans button in that group.
- **Back to API models.** Run `node .cursor/skills/verify-tokentier/scripts/verify.mjs click --role button --name "API models" --group "Tier list lane"`. The API models button is pressed again.
- **Proof.** Save `tier-lane/plans.png` with `screenshot --path tier-lane/plans.png` while Plans is pressed. The shot shows the Tier list heading and the Plans button active.

## Gotchas

- `Plans` also appears in the price book as `Plans & access`. Without `--group "Tier list lane"` the click can hit the wrong switch.
- The accessible name includes a live count (`Plans 12`). Match the prefix `Plans`, not a hardcoded count.
- Switching lanes does not change the `scenario` query.
