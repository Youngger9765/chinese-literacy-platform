# Spec CI — Activation Guide

> Issue #2029 gap 1: CI auto-run for the modular spec system.

## Status

The workflow template lives at `specs/ci/spec-check.yml`.

**It is NOT yet active in `.github/workflows/`.**

Both active PATs (`Youngger9765` / `young9765`) have `repo` scope only.
GitHub blocks writing `.github/workflows/` files without `workflow` scope.

## One-step activation (manual, needs `workflow` scope)

```bash
cp specs/ci/spec-check.yml .github/workflows/spec-check.yml
git add .github/workflows/spec-check.yml
git commit -m "ci: activate spec-check workflow (Related to #2029)"
git push
```

Or via GitHub web UI:

1. Open https://github.com/Youngger9765/chinese-literacy-platform/new/staging
2. Set file path to `.github/workflows/spec-check.yml`
3. Paste the contents of `specs/ci/spec-check.yml`
4. Commit directly to staging

## What the workflow does

Triggers on PRs that touch `specs/**`, `backend/specs/**`, or the code/data
files owned by the current spec modules.

Two gates:

| Gate | Command | Fail condition |
|------|---------|----------------|
| Registry freshness | `python specs/build_registry.py --check` | `INTENT.md` changed without rebuilding `registry.yaml` |
| Spec contracts | `cd backend && python -m pytest specs/ -v` | Code/data drifted from documented intent |

**Baseline (2026-06-01)**: 34 passed, 31 xfailed (xfails = known drift documented in #2015).

## When `workflow` scope is available

Add it to the PAT at https://github.com/settings/tokens, then run the
`cp` + `git commit` + `git push` command above.
