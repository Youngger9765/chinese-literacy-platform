# Copilot Instructions - LingoLeap

## Project Overview

LingoLeap is a Chinese literacy learning platform for elementary/middle school students and teachers.
- **Frontend**: React 19 + Vite + TypeScript + Tailwind CSS
- **Backend**: FastAPI + SQLAlchemy + PostgreSQL
- **AI**: Vertex AI Gemini (`gemini-2.5-flash`, location: `us-central1`)
- **Deployment**: GCP Cloud Run (asia-east1)
- **Language**: UI in Traditional Chinese, code/comments in English

## Coding Conventions

### General
- Use TypeScript (strict mode) for all frontend code
- Use Python type hints for all backend code
- Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`
- Commit messages in English
- Never hardcode secrets, API keys, or tokens - use environment variables

### Frontend (React)
- Functional components only (no class components)
- Use React hooks (`useState`, `useEffect`, `useCallback`, etc.)
- Tailwind CSS for styling (no CSS modules, no styled-components)
- API calls go through `frontend/src/services/api.ts`
- Components in `frontend/src/components/`
- Zhuyin rendering uses BpmfIansui font (not HTML ruby tags)

### Backend (FastAPI)
- Async endpoints preferred
- SQLAlchemy ORM for database access
- Pydantic V2 for request/response models
- AI calls go through `backend/app/services/ai_service.py`
- Routes in `backend/app/routes/`
- Models in `backend/app/models/`

## Git Branch Strategy (CRITICAL)

```
feature/*  --PR-->  staging  --PR-->  main
```

### Branch Naming
- Bug fix: `fix/issue-{N}-{description}`
- New feature: `feat/issue-{N}-{description}`
- Branch MUST start with `fix/issue-` or `feat/issue-` (CI only triggers on these patterns)
- NEVER use `fix/{description}-{N}` or `fix/{description}` (won't trigger preview deploy)

### Workflow (PDCA)

Every Issue follows a 4-phase Plan-Do-Check-Act cycle:

#### Phase 1: PLAN
1. Read the Issue: `gh issue view {N}`
2. Reproduce the problem with evidence (screenshots/logs)
3. Root cause analysis
4. Design test plan (TDD)
5. Post plan as Issue comment
6. Wait for approval before coding

#### Phase 2: DO
1. Create feature branch FROM `staging`:
   ```bash
   git checkout staging
   git checkout -b fix/issue-{N}-{description}
   ```
2. Write failing test first (Red)
3. Implement fix (Green)
4. Verify tests pass
5. Commit: `git commit -m "fix: {description} (Related to #{N})"`
   - Use "Related to #N" in commits
   - Save "Fixes #N" for PR title/body only
6. Push: `git push -u origin fix/issue-{N}-{description}`

#### Phase 3: CHECK
1. Create PR to `staging`:
   ```bash
   gh pr create --base staging --title "fix: {description} (Fixes #{N})"
   ```
2. Wait for PR Preview deployment (auto by CI/CD)
3. Verify Preview URL returns HTTP 200
4. Post test instructions as Issue comment (NOT PR comment)
5. Wait for both:
   - CI/CD passes (system approval)
   - Case owner says "OK" (business approval)

#### Phase 4: ACT
1. Merge PR: `gh pr merge {PR} --squash`
2. Issue auto-closes via "Fixes #N" in PR
3. Clean up branch

### Rules
- NEVER commit directly to `main` or `staging`
- NEVER skip PR creation (PR = Code Review + CI/CD Gate)
- NEVER merge without CI passing AND case owner approval
- NEVER close an Issue without user confirmation ("OK")
- One Issue = One PR (never combine multiple issues)
- Always write tests first (TDD: Red -> Green -> Refactor)

## Security Rules

### Never post in Issues/PRs
- Production/Staging URLs (use PR Preview URLs only)
- API Keys, tokens, passwords
- Full stack traces (leak system paths)
- Real user PII (names, phones, emails)
- Internal IPs or ports
- curl commands with auth headers

### Allowed in Issues/PRs
- PR Preview URLs (temporary, auto-deleted)
- PR numbers, branch names
- Test result summaries (no sensitive data)
- Error messages (without file paths)

## Key Files

| File | Purpose |
|------|---------|
| `frontend/src/App.tsx` | Main router + step navigation |
| `frontend/src/components/reading-steps/` | 6 learning step components |
| `frontend/src/services/api.ts` | API layer (with SessionExpiredError auto-rebuild) |
| `backend/app/main.py` | FastAPI entry point |
| `backend/app/services/ai_service.py` | Vertex AI Gemini calls |
| `backend/app/services/socratic_agent.py` | Socratic dialogue agent |
| `backend/app/models/` | DB Schema (School, Student, Text, LearningSession) |
| `backend/app/routes/` | API routes (stories, learning, users) |
| `backend/data/stories/` | 57 lesson YAML source files |

## Learning Flow (6 Steps)

1. **Intro** - Lesson background
2. **LiveTutor** - AI-guided paragraph reading
3. **VocabPractice** - Stroke order + Zhuyin practice
4. **ComprehensionChat** - Socratic AI dialogue (5 questions, 3 phases)
5. **FullReading** - Complete reading assessment
6. **AssessmentReport** - 6-section diagnostic report

## Testing

- Frontend: `cd frontend && npm test` (Vitest)
- Backend: `cd backend && pytest`
- E2E: Playwright (`frontend/e2e/`)
- Always run tests before pushing
- TDD is mandatory: write failing test first, then implement

## AI Service Notes

- Model: `gemini-2.5-flash` (NOT `gemini-2.0-flash`)
- Location: `us-central1` (asia-east1 does NOT have Gemini models)
- max_output_tokens: 1024 (256 causes JSON truncation)
- Error fallback: `understood=False` (NEVER `True` on errors)
- Circuit breaker: 3 consecutive AI errors -> raise RuntimeError -> HTTP 503

## Local Development

```bash
# Frontend
cd frontend && npm install && npm run dev    # localhost:3000

# Backend
cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload  # localhost:8000
```
