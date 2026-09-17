# Guarded delivery

This is the only delivery path for code changes in StreamService. A merge to
`main` is a production deploy. The agent prepares a reviewed PR; GitHub waits
for approval from a privileged colleague before auto-merging it.

## Delivery

1. Work on a feature branch or isolated worktree. Never push directly to
   `main` and do not run Docker Compose lifecycle commands from this checkout.
2. Implement the requested change and run the relevant CI-equivalent checks.
3. Run `task-completion-validator` and `project-compliance`; additionally run
   `qa-browser-tester` for web changes, `code-quality-pragmatist` for
   non-trivial changes, and `live-safety-auditor` for every change.
4. Resolve every `FAIL`. A `live-safety-auditor` `FAIL`, red or unknown CI,
   unresolved review finding, or another deploy in progress stops the flow.
5. Commit without agent attribution, push the feature branch, and create a
   squash PR. Its body contains the review packet: requested outcome, changed
   files, checks run and results, reviewer verdicts, and viewer/deploy impact.
6. Enable GitHub auto-merge and stop. Do not approve the PR yourself, bypass
   branch protection, or merge directly.

If a check fails, a reviewer requests changes, a merge conflict appears, or
auto-merge cannot be enabled, report the reason and leave the PR open.

## Repository prerequisites

The repository administrator enables GitHub auto-merge and protects `main`
with the CI checks from `.github/workflows/ci.yml` as required checks. Require
at least one pull-request approval and require review from Code Owners. Map the
privileged reviewers or team in `.github/CODEOWNERS`; do not add placeholders
or invent GitHub usernames. The authoring account needs permission to create
pull requests and enable auto-merge, but must not be able to bypass these
requirements.
