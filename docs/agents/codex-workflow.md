# Codex team workflow

This repository ships controlled delivery for Codex and Claude Code:

- `.agents/skills/` contains StreamService-specific checks and the
  `$guarded-delivery` review gate. Codex discovers these while working in this
  repository.
- `plugins/streamservice-workflow/` packages the current Matt Pocock
  engineering workflow and a narrow GitHub MCP connection for the team.

## Install the team plugin

From the repository root, each developer runs:

```sh
codex plugin marketplace add .
codex plugin add streamservice-workflow@streamservice
```

Restart Codex if the new skills are not visible. The plugin includes 18 Matt
Pocock engineering skills. Start with `$ask-matt` to choose a workflow, then
run `$setup-matt-pocock-skills` once for this repository before using
`$triage`, `$to-spec`, `$to-tickets`, or `$wayfinder`.

For code changes, use `$guarded-delivery` or describe the task directly. The
agent reviews and creates the PR autonomously, enables protected GitHub
auto-merge, and then waits for privileged reviewer approval.

## GitHub access

The plugin declares `github-streamservice`, the official GitHub MCP endpoint.
It exposes only repository, issue, and pull-request toolsets. Each developer
authorizes their own GitHub account through OAuth; no personal access token or
credential belongs in this repository.

After installing the plugin, authenticate with:

```sh
codex mcp login github-streamservice
```

GitHub writes, including creating or editing issues and pull requests, may
also require a desktop permission prompt. Repository permissions are those of
the developer's own GitHub account.
