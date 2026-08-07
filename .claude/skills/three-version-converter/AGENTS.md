# Converter Universal

## Step 0 — Provision the environment (ANY OS: Windows / macOS / Linux)

Before the first run, make sure these are available: **LibreOffice, ImageMagick, poppler (pdfinfo + pdftoppm), python-docx, lxml, and the bundled fonts**.

You (the agent) must **detect the operating system yourself and use the matching package manager** — do not assume the machine is one OS:
- **Windows** → run `setup.ps1` in PowerShell (uses `winget`, falls back to `choco`). Installs fonts to the user font folder.
- **macOS** → run `bash setup.sh` (uses Homebrew).
- **Linux (Debian/Ubuntu)** → run `bash setup.sh` (uses `apt-get`).

If a helper script is missing a package on this machine, install that single tool directly with whatever package manager the OS has (winget/choco/brew/apt), then continue. The scripts are idempotent — safe to re-run. Verify with `soffice --version`, `pdfinfo -v`, `magick -version` (or `compare -version`), and `python3 -c "import docx, lxml"` before running a lesson.

**If any install step fails — this is expected sometimes, ESPECIALLY on Windows (winget/choco package IDs for LibreOffice / ImageMagick / and especially poppler drift or move) — do NOT stop or report "setup failed". Debug it live and fix it yourself:**
- Read the actual error message
- Try the other package manager (winget ↔ choco), e.g. `winget search libreoffice` / `choco search poppler` to find the current correct ID
- If neither has it (poppler on Windows is the usual culprit), download the tool's official Windows build directly and put it on PATH
- Re-verify that tool's `--version` works, then continue
- Only after all 4 tools (soffice, pdfinfo, magick/compare, python-docx+lxml) report a version do you run a lesson

Treat environment setup as a problem to solve, not a script to blindly run — the setup scripts are a best-effort starting point, not the last word. You are a capable agent; the user (a non-technical teacher) is watching, so narrate what you're doing in plain language and keep their actions to a minimum (approve installs, paste nothing technical).

## Run One Lesson

Use a Python environment with `python-docx` and `lxml` installed, then run one teacher-edition DOCX at a time:

```bash
python3 scripts/pipeline.py "<teacher-edition.docx>" <output-dir> <lesson-tag>
python3 scripts/audit.py "<teacher-edition.docx>" "<output-dir>/<lesson-tag>學生版.docx"
python3 scripts/make_ans.py "<lesson-name>" "<output-dir>/<lesson-tag>answers.tsv" "<output-dir>/<lesson-tag>簡答.docx"
```

Expected files:

- `<lesson-tag>學生版.docx`
- `<lesson-tag>answers.tsv`
- `<lesson-tag>qc.txt`
- `<lesson-tag>簡答.docx`

## Hard Rules

- Do not modify answer-marking rules unless the QA report proves a rule bug
- Read `docs/轉換規則與教訓紀錄.md` before changing `scripts/convert.py`
- The student edition keeps answer text as white glyphs; distribute it on paper only
- Do one lesson at a time
- On `FAIL`, read `<lesson-tag>qc.txt`, fix the rule in `scripts/convert.py`, then re-run every previously-passed lesson as a regression check

## Setup scripts

- `setup.sh` — macOS (Homebrew) and Debian/Ubuntu (apt-get)
- `setup.ps1` — Windows (winget, choco fallback)

Both install LibreOffice, poppler, ImageMagick, the Python deps, and the bundled fonts. See **Step 0** — pick the one matching the detected OS; the agent auto-detects.
