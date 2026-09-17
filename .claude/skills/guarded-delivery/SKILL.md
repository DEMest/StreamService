---
name: guarded-delivery
description: Run a StreamService code change to a reviewed PR, then wait for privileged GitHub approval and protected auto-merge.
user-invocable: true
disable-model-invocation: true
---

# Guarded delivery

Read `docs/agents/guarded-delivery.md` and follow it exactly. This is the
explicit entry point for controlled delivery; `CLAUDE.md` makes the same gate
mandatory for every implementation in this repository.
