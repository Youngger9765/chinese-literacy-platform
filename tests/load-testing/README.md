# LingoLeap Load Testing

Issue #260: 壓力測試 — 30 人同時朗讀分析

## Overview

Load tests use [Locust](https://locust.io/) to simulate concurrent users against the LingoLeap backend API.

### SLA Targets (from PRD)

| Metric | Target |
|--------|--------|
| Reading AI analysis (P95) | < 5 seconds |
| General API responses | < 2 seconds |
| Error rate | 0% |

---

## Scenarios

| Class | Description | Default users |
|-------|-------------|---------------|
| `StudentBrowsingUser` | 30 students browsing story library | 30 |
| `StudentReadingUser` | 30 students submitting reading results + AI analysis | 30 |
| `TeacherDashboardUser` | 10 teachers viewing classroom dashboards | 10 |
| `MixedWorkloadUser` | Mixed realistic classroom session | 30 |

---

## Local Setup

```bash
cd tests/load-testing
python -m venv .venv
source .venv/bin/activate       # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

---

## Running Locally

### Quick start (using the shell script)

```bash
# From repo root — defaults: 30 users, 5/s spawn, 2 min, Scenario 2
./scripts/run-load-test.sh

# Against a specific host
LOAD_TEST_HOST=https://lingoleap-backend-staging-xxx.run.app ./scripts/run-load-test.sh
```

### Scenario 1: Students Browsing (30 concurrent)

```bash
locust -f tests/load-testing/locustfile.py \
  --host=https://lingoleap-backend-staging-xxx.run.app \
  --users=30 --spawn-rate=5 --run-time=2m \
  --headless \
  --only-summary \
  --html=tests/load-testing/reports/scenario1-browse.html \
  StudentBrowsingUser
```

### Scenario 2: Students Submitting Reading Results (30 concurrent)

```bash
locust -f tests/load-testing/locustfile.py \
  --host=https://lingoleap-backend-staging-xxx.run.app \
  --users=30 --spawn-rate=5 --run-time=2m \
  --headless \
  --only-summary \
  --html=tests/load-testing/reports/scenario2-reading.html \
  StudentReadingUser
```

### Scenario 3: Teachers Viewing Dashboards (10 concurrent)

```bash
locust -f tests/load-testing/locustfile.py \
  --host=https://lingoleap-backend-staging-xxx.run.app \
  --users=10 --spawn-rate=2 --run-time=2m \
  --headless \
  --only-summary \
  --html=tests/load-testing/reports/scenario3-teacher.html \
  TeacherDashboardUser
```

### Scenario 4: Mixed Workload (30 users — students + teachers)

```bash
locust -f tests/load-testing/locustfile.py \
  --host=https://lingoleap-backend-staging-xxx.run.app \
  --users=30 --spawn-rate=5 --run-time=5m \
  --headless \
  --only-summary \
  --html=tests/load-testing/reports/scenario4-mixed.html \
  MixedWorkloadUser
```

### Interactive Web UI

```bash
locust -f tests/load-testing/locustfile.py \
  --host=https://lingoleap-backend-staging-xxx.run.app
# Open http://localhost:8089
```

---

## Running Against Staging via GitHub Actions

1. Go to **Actions** tab in GitHub.
2. Select **Load Test (Manual)** workflow.
3. Click **Run workflow**.
4. Fill in:
   - `users` — number of concurrent users (default: 30)
   - `spawn_rate` — users spawned per second (default: 5)
   - `run_time` — test duration (default: `2m`)
   - `scenario` — user class to run (default: `StudentReadingUser`)
5. Download the HTML report from **Artifacts** when the run completes.

---

## Interpreting Results

After each run, Locust outputs a summary like:

```
LingoLeap Load Test — SLA Summary
====================================================
Total requests : 1842
Failures       : 0
Error rate     : 0.00%  (target: 0%)
Median RPS     : 15.4
Avg response   : 312 ms
P95 response   : 4210 ms  (target: <5000ms for AI)
P99 response   : 4980 ms
====================================================
```

Key columns in the HTML report:

| Column | Meaning |
|--------|---------|
| `# Requests` | Total calls made |
| `# Fails` | HTTP errors (non-2xx / non-expected-4xx) |
| `Median (ms)` | 50th percentile response time |
| `95%ile (ms)` | **Primary SLA metric for AI endpoints** |
| `Failures/s` | Should be 0 under normal load |

### SLA Pass / Fail Criteria

- `/learning/ai-analysis`: P95 < 5000 ms — **primary target**
- `/stories`, `/learning/sessions`: P95 < 2000 ms
- Error rate across all endpoints: 0%
- HTTP 429 (rate-limited) responses are treated as success (expected under burst)

---

## Notes

- **Test accounts** are auto-registered with username `loadtest_*` and password `LoadTest@1234`.
  Clean up test accounts from the DB after major runs if needed.
- **Rate limiting**: The `/learning/ai-analysis` endpoint is rate-limited to 5 req/min per user.
  Locust users back off on 429 responses automatically.
- **Reports directory**: HTML reports are gitignored. Check `tests/load-testing/reports/`.
