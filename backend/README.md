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

## Build dependencies and sdist-only packages (#3852)

`--require-hashes` verifies every downloaded distribution, but **not** the
packages pip installs into the isolated build env it creates when it has to
build an sdist. `jieba==0.42.1` ships only an sdist, so without extra flags pip
fetches a floating, unverified `setuptools` from PyPI to build it.

So every install of `requirements.lock` (Dockerfile + CI) is two steps:

```bash
pip install --require-hashes --only-binary=:all: -r requirements-build.lock
pip install --require-hashes --only-binary=:all: --no-binary=jieba \
  --no-build-isolation -r requirements.lock
```

- `requirements-build.in` → `requirements-build.lock`: the hash-pinned build
  backend (setuptools, matching the version the pinned base image ships).
  Regenerate with
  `uv pip compile requirements-build.in --generate-hashes --python-version 3.11 --python-platform x86_64-manylinux_2_28 -o requirements-build.lock`.
- `--only-binary=:all:` makes any *new* sdist-only dependency fail the build
  instead of being silently compiled. If that happens, either pick a version
  with a wheel, or add it to `--no-binary=` everywhere **and** to
  `SDIST_ALLOWLIST` in `tests/test_jieba_build_isolation_3852.py` (a reviewed
  decision), making sure it builds with only `requirements-build.lock`.

`tests/test_jieba_build_isolation_3852.py` fails CI if any install site drops
one of these flags or the build-lock step.
