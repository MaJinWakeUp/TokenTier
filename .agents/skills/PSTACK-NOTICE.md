# Third-party skills from pstack-claude

The skill directories in `.agents/skills/` are copied without changes from
[michael-denyer/pstack-claude](https://github.com/michael-denyer/pstack-claude),
`plugins/pstack/skills/`, at commit
[`d56fdb0`](https://github.com/michael-denyer/pstack-claude/tree/d56fdb02770f53a42e5101e3dd9daa4f96dde92c/plugins/pstack/skills)
(release 0.9.96).

| Skill | Why it is here |
| --- | --- |
| `blast-radius/` | Requested. Finds what a change could break outside the diff and proves the one fact that makes it safe. |
| `principle-prove-it-works/` | Requested. Before calling work done, check the real result instead of a proxy. `user-invocable: false` only hides it from the `/` menu and doesn't load it automatically, so the repo's `AGENTS.md` (imported by `CLAUDE.md`) states the rule in every session and points to this skill. |
| `why/` | Needed by `blast-radius`. Its step 1 runs `why` step 2 to collect PR and commit history, and its step 4 uses the citation rules from `why`. |
| `how/` | The companion skill that `blast-radius` and `why` refer to for "what does this code do" questions. |
| `unslop/` | Needed by `blast-radius`, which says to write its report through `unslop`. |

`.claude/skills/update-catalog/` is TokenTier's own skill and is not part of
this notice.

## License

pstack-claude is released under the MIT License. Copyright (c) 2026 Lauren Tan
and (c) 2026 Michael Denyer. The full license text is in
[`LICENSE-pstack`](LICENSE-pstack). These skills come from Lauren Tan's
[cursor/plugins/pstack](https://github.com/cursor/plugins/tree/main/pstack), as
ported by Michael Denyer. The full history is in the upstream
[NOTICE.md](https://github.com/michael-denyer/pstack-claude/blob/main/NOTICE.md).
This repository's own `LICENSE` file does not cover these files.

## Known gaps

These skills come from a larger plugin, so some of their references point to
skills that are not copied here. The skills still work without them:

- **`poteto-mode`** is not included. It runs the whole pstack workflow: about 60
  other skills, a plugin-registered `pstack:poteto-agent` subagent, hooks, and
  Bun/TypeScript scripts. All of that needs the full plugin, so a repo-level copy
  would fail. `how` and `why` mention it only in two places. The first is a set of
  links to tool mappings for Codex, Copilot, and Muse, which Claude Code does not
  need. The second is a pointer to its section on choosing a reasoning level for
  subagents. When that pointer can't be followed, the subagent runs at the
  session's reasoning level.
- **`arena`** (`blast-radius` step 6) and **`show-me-your-work`**
  (`principle-prove-it-works`) are only needed for large changes and are not
  included. If you need them, install the full plugin.
- **`pstack-models.md` / `/setup-pstack`** are not included. `how` and `why` use
  the default models listed in each skill's Models section when they can't find
  this file.

To get the full set, install the plugin
(`/plugin marketplace add michael-denyer/pstack-claude`, then
`/plugin install pstack@pstack-claude`).
To update these copies, copy the directories again from a newer upstream commit,
then change the commit hash above.
