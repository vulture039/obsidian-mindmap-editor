---
name: review
description: Review this repository's changes when asked for a review or a complete implementation check.
---

# Review

Review the requested scope; otherwise compare the current branch with its merge base,
including uncommitted and untracked changes. State any uncertainty about the base.
Read the request, linked issue, applicable repository instructions, `AGENTS.md`, and
`docs/DEVELOPMENT.md`. Inspect affected callers and lifecycle behavior beyond the diff.

Check all nine points:

- Does the implementation satisfy the request?
- Has behavior been verified, beyond a successful build?
- Are existing behaviors preserved except for intended changes?
- Is the code readable?
- Are responsibilities clear and consistent with the repository architecture?
- Is any code or commentary unnecessary?
- Is any code or commentary redundant?
- Do documentation and comments match the implementation?
- Are commit boundaries appropriate: does each commit form a coherent, reviewable
  change, without mixing unrelated work or splitting changes that belong together?

Inspect individual commits as well as the combined diff for the commit-boundary
check. For uncommitted changes, assess how they should be grouped into commits.

Run relevant checks; reuse verified results for unchanged code. Use `npm run check`
for implementation changes and relevant Obsidian E2E/manual checks for app behavior.
Distinguish passed checks from untested behavior; avoid preference-only findings.

Report in Japanese: findings by severity with file/line, trigger, impact, and suggested
fix; then a brief conclusion for each point and verification gaps. If no issues are
found, say so without claiming untested behavior is safe. Apply fixes and recheck when
requested; otherwise report the review.
