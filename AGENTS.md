# Agent instructions

## Prove it works before calling a task done

Before you report any task as done, check the real result: run the feature or
test, read the actual value, or inspect the diff. A proxy, a self-report, or
"it compiles" doesn't count. If you couldn't check something, say so. The full
rule is the `principle-prove-it-works` skill in
`.agents/skills/principle-prove-it-works/SKILL.md`. Load it before finishing
any task.
