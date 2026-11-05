# L1 Security Checklist — deferred / high-level items

This file tracks security items that are bigger than a same-day patch:
architectural decisions, redesigns, or anything that needs a deliberate
design call rather than a tool/config tweak. Day-to-day findings get fixed
and closed via normal issues/PRs; this file is only for the ones that
can't be.

## OPEN

### Claude Code agent workflows need a sandboxed redesign before re-enabling

- **Status**: both `claude-issue-agent.yml` and `claude-pr-review.yml` are
  `disabled_manually` (verify with `gh workflow list --repo
  Youngger9765/chinese-literacy-platform --all`). They stay disabled.
- **Why a patch can't close this** (coordinator review, 2026-11-06): these
  jobs give the agent `Write` (needed for its actual job — editing code)
  plus `git` subcommands (needed to commit/push). That combination alone
  is enough for a successful prompt injection to achieve code execution
  **without needing any of the Bash commands on the allow-list to be
  dangerous by themselves**:
  - `Write` has no path restriction, so attacker-controlled text can be
    written directly to `.git/hooks/pre-commit` (or any other git hook) —
    then ANY later `git commit`/`git checkout`/etc. in the allow-list
    triggers it.
  - Same for `.git/config` — `core.fsmonitor` or `core.sshCommand` can be
    set to an arbitrary command via a direct file write (bypassing the
    need for the `git config` subcommand, which is already excluded from
    the allow-list — the exclusion doesn't help if the file can be
    written directly).
  - Narrowing the Bash allow-list (already done across #3893/#3894:
    removed `python`/`npm`/`npx`/`pip`/`gh api`/`cat`/`pytest`/
    `run-ci.sh`) closes the "obviously dangerous command" class, but
    **cannot** close this class, because the exploit never needs a
    dangerous Bash command in the first place — only `Write` + any `git`
    invocation, both of which the job's actual task requires.
- **What a real fix needs** (not done, scope for a future redesign):
  1. Run the agent itself in a sandboxed environment with **no secrets
     reachable from the process the untrusted content is fed to** — e.g.
     the agent proposes a diff in an unprivileged container/step with
     zero `secrets.*` in its environment, and a **separate**, later step
     (which never reads untrusted content) takes that diff and does the
     actual `git commit`/`git push`/`gh pr create` with the real
     credentials.
  2. That separation is the load-bearing part — allow-listing tools
     within a single privileged step, no matter how narrow, cannot
     substitute for it.
- **What WAS done as cheap, bounded hygiene** (2026-11-06, #3893/#3894):
  not a fix for the above, but legitimate reductions in blast radius
  while both workflows remain off:
  - `id-token: write` dropped entirely from both jobs (closes the
    WIF/prod-GCP-escalation path specifically — this one IS structurally
    closed: without that permission, GitHub Actions cannot mint an OIDC
    token for the job at all, independent of the Write+git issue above).
  - `persist-credentials: false` on both checkouts.
  - Bash allow-list narrowed (see above).
  - A pre-step filters the issue thread to OWNER/MEMBER/COLLABORATOR
    authors only (title included) before the agent ever sees it, so a
    public commenter's text is no longer part of its working context —
    this doesn't close the Write+git issue either, but it does shrink how
    much attacker-authored text the agent is exposed to in the first
    place.
- **Re-enabling either workflow is a separate, later decision** and must
  not happen as a side effect of any future "hardening" PR touching these
  files — it requires the redesign above (or an equivalent), signed off
  explicitly.

## Format for new entries

```
### <short title>
- **Status**: <where it stands>
- **Why a patch can't close this**: <the architectural reason>
- **What a real fix needs**: <the redesign, not implemented>
- **What WAS done as cheap, bounded hygiene**: <if anything>
```
