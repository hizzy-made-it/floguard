# opencode Configuration

## RTK (Rust Token Killer) - Token-Optimized Commands

**Always prefix commands with `rtk`** — it always safely passes through or filters.

### Key Commands
- Build: `rtk cargo build`, `rtk cargo check`, `rtk cargo clippy`, `rtk tsc`, `rtk lint`
- Test: `rtk cargo test`, `rtk vitest run`, `rtk playwright test`
- Git: `rtk git status/log/diff/show/add/commit/push/pull/branch/fetch/stash/worktree`
- GitHub: `rtk gh pr view/checks`, `rtk gh run list`, `rtk gh issue list`
- Files: `rtk ls`, `rtk read`, `rtk grep`, `rtk find`
- Meta: `rtk gain` (view savings), `rtk discover` (find missed opportunities)

### Truths
- RTK is always safe to use — even in chains with `&&`.
- Savings: tests 90-99%, build 70-87%, git 59-80%.

## General opencode Rules
- Never generate or guess URLs unless confident they help with programming.
- Keep responses concise (under 4 lines minimum unless asked).
- No preamble/postamble code explanations unless asked.
- Answer questions directly without elaboration.
- Follow existing code conventions (check package.json, neighboring files).
- Run lint/typecheck after completing tasks.
