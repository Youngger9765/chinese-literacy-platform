# E2E Test Status — 2026-03-09

## Summary: 87/87 PASS

| Suite | Pass | Total | Notes |
|-------|------|-------|-------|
| setup | 3 | 3 | Teacher + Admin + Student auth |
| auth-flow | 7 | 7 | Login, register, logout, duplicate |
| teacher-flow | 21 | 21 | Dashboard, classrooms, tabs, forms |
| admin-flow | 42 | 42 | Org/school/classroom/user/role management |
| student-flow | 14 | 14 | Nav buttons, join classroom page |

## Root Causes Fixed

### 1. CSP `connect-src` blocking API calls
- **Files**: `frontend/index.html`, `backend/app/main.py`
- **Fix**: Added `https://*.run.app` to CSP connect-src

### 2. Missing `classroom_teachers` DB table
- **Fix**: Created table + seeded primary teacher records in staging DB
- **TODO**: Need Alembic migration

### 3. Missing `expires_at`/`deleted_at` columns in `classroom_texts`
- **Fix**: ALTER TABLE ADD COLUMN in staging DB
- **TODO**: Need Alembic migration

### 4. Terms/Onboarding modals blocking tests
- Added `dismissAllModals()` helper with 3s/2s timeouts
- Used `waitForLoadState('networkidle')` for flaky pages

### 5. Rate limiting (5 reg/min, 10 login/min)
- **Fix**: `auth.setup.ts` saves storageState per role
- Teacher/admin/student tests reuse saved auth (1 login total)

### 6. User pagination in admin panel
- Users sorted by newest first; seed users on last page
- **Fix**: Search for specific user before testing

## Architecture

```
auth.setup.ts  →  saves teacher.json, admin.json, student.json
     ↓
playwright.config.ts  →  projects with storageState dependencies
     ↓
teacher-flow.spec.ts  →  uses teacher.json (no login needed)
admin-flow.spec.ts    →  uses admin.json (no login needed)
student-flow.spec.ts  →  uses student.json (no login needed)
auth-flow.spec.ts     →  no storageState (tests login itself)
```
