# Backend dependencies

Two files, two jobs (#3849):

- **`requirements.txt`** — human-edited source of truth. Open version ranges
  (`fastapi>=0.115,!=0.136.3`). This is where you add/remove/re-range a package.
- **`requirements.lock`** — machine-generated, hash-pinned build artifact.
  This is what `backend/Dockerfile` and every CI workflow actually install
  (`pip install --require-hashes -r requirements.lock`). Never hand-edit it.

Pinning to exact versions + sha256 hashes closes the gap where any `docker build`
could silently pull whatever is newest on PyPI that day, including a same-day
compromised/typosquat release — see the `fastapi` comment in `requirements.txt`
(`MAL-2026-4750`, #2002).

## Regenerating the lock

Whenever you edit `requirements.txt` (bump a floor, add a package, loosen/tighten
a range), regenerate the lock in the same PR:

```bash
cd backend
# find the exact Python patch the Dockerfile's base image currently ships —
# matters for conditional deps whose marker depends on the patch version
# (e.g. redis's async-timeout backport only applies below 3.11.3)
docker run --rm python:3.11-slim python3 --version

uv pip compile requirements.txt \
  --generate-hashes \
  --python-version 3.11.X \
  --python-platform x86_64-manylinux_2_28 \
  --constraints requirements.lock \
  -o requirements.lock
```

`--constraints requirements.lock` pins every package that's already locked to its
current version, so a routine edit (e.g. adding one new package) doesn't silently
upgrade everything else. To intentionally upgrade, drop `--constraints` or
constrain to specific packages via `--upgrade-package <name>` instead.

Then review the diff — only the packages you meant to touch should move — and
commit both files together.

## CI guard

`tests/test_requirements_lock_pinned_3849.py` fails CI (offline, no re-resolve)
if:
- a package in `requirements.txt` is missing from `requirements.lock`,
- the version `requirements.lock` pins no longer satisfies the specifier in
  `requirements.txt` (i.e. you edited the range but forgot to regenerate),
- any lock entry is missing a sha256 hash, or
- the lock contains a loose range instead of an exact `==` pin.

If this test fails, you forgot to regenerate the lock — run the command above.
