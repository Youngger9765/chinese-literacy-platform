# Session State 2026-05-23 (pre-compact checkpoint)

## Active background agents (DO NOT lose context)

| Agent ID | Task | Status |
|---|---|---|
| `ad7b500ac9b27db93` | #1910 backend assignment start 403 + CORS | running |
| `adc1528a695107255` | #1911 backend teacher report completion criteria | running |
| `acbe240e43b183ef5` | #1912 + #1913 frontend P0 (vocab silent accept + Intro CTA label) | running |

When notifications arrive: report PR# + status to Young, dispatch next priority if applicable.

## Today's session summary (34 refactor PRs merged)

**Round 1** (18 PRs): #1830 #1832 #1833 #1834 #1835 #1836 #1837 #1839 #1841 #1860-#1877 + others — codex consult auth/teacher-tabs/tts/httpClient/socratic/LearningLayout-step-1/LiveTutor/assignments/Phase2-auth/TDD-gate/8-Wave3 batch

**Round 2** (14 PRs): #1892 #1893 #1894 #1895 #1896 #1897 #1898 #1899 #1900 (#1891 untracked) #1903 #1902 #1904 #1905 — codex round-2 consult covered 14 P0+P1 files

**Round 3** (2 PRs): #1907 LearningLayout deep refactor 1209→349L + #1909 ExitTicket 520→308L

## Codex usage
**Weekly limit hit 2026-05-23**, reset **2026-05-27 07:17**. All current/future agents use Claude Opus direct.

## PM Dogfood Report
`docs/pm-dogfood-2026-05-23.md` + 51 screenshots `/tmp/pm-dogfood/`

**6 P0 / 11 P1 / 7 P2 findings**:
- P0 #1 ✅ in flight (#1910): assignment start 403 + CORS
- P0 #2 ✅ in flight (#1911): teacher report 永遠 尚未完成
- P0 #3 ✅ in flight (#1912): VocabDefinition silent accept wrong
- P0 #4 PENDING: 閱讀聚光燈 empty on 贏得喝采的輸家 (content + copy fix)
- P0 #5 ✅ in flight (#1913): Intro CTA label `開始逐段朗讀` 實際導去 step 2 做記號
- P0 #6 PENDING: code-splitting chunks 404 (deploy cache invalidation)

## Pending decisions after agents finish

1. P0 #4: populate 閱讀聚光燈 YAML for top 6 lessons OR improve empty-state copy
2. P0 #6: investigate chunk 404 deploy cache issue (may auto-resolve next deploy)
3. 11 P1 findings — Young hasn't decided priority
4. 7 P2 product opportunities — backlog

## Critical project facts to preserve

- LingoLeap staging URL: `https://lingoleap-frontend-staging-958347263320.asia-east1.run.app/`
- Backend staging: `https://lingoleap-backend-staging-958347263320.asia-east1.run.app/api/health`
- Demo accounts: 管理員 王管理員 / 教師 李老師 / 學生 小明 (one-click login on /login)
- gcloud config: `lingoleap` (youngtsai@junyiacademy.org / lingoleap-dev / asia-east1)
- Latest staging revision (post-#1909): lingoleap-frontend-staging-00893-l66
- Today's release to prod: #1821 sha=3f22b02e (this morning)

## Pattern for agent dispatch this session

- Use `git-issue-pr-flow` agent type with `mode: bypassPermissions` + `run_in_background: true`
- Prompt MUST include: TDD-FIRST mandatory / codex unavailable note / branch+worktree paths / Risk+Effort / **EXIT after merge — NO Monitor on staging**
- ~~Hybrid rule (codex exec)~~ DISABLED until 5/27 reset — agents use Claude Opus direct
- Auto-merge if Low/Med risk + CI green; High risk STOP for Young approval

## Loop pattern
- 5-min wakeup cadence per Young's preference
- Stop loop when all dispatched agents done + Young not asking for more
