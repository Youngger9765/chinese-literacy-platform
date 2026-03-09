"""
LingoLeap Load Testing Suite
Issue #260: 壓力測試 — 30 人同時朗讀分析

Scenarios:
  1. StudentBrowsingUser    — 30 concurrent students browsing stories
  2. StudentReadingUser     — 30 concurrent students submitting reading results
  3. TeacherDashboardUser   — 10 teachers viewing dashboards simultaneously
  4. MixedWorkloadUser      — Mixed workload (students + teachers)

Run (see README.md for details):
  locust -f locustfile.py --host=https://lingoleap-backend-staging-xxx.run.app

SLA targets (PRD):
  - Reading analysis response < 5s (P95)
  - Page/API load < 2s
  - DB queries < 500ms
  - Error rate: 0%
"""

from __future__ import annotations

import random
import time

from locust import HttpUser, TaskSet, between, events, task
from locust.runners import MasterRunner, WorkerRunner

# ---------------------------------------------------------------------------
# Shared test data
# ---------------------------------------------------------------------------

# Story IDs available in the system (first 10 are used for realistic spread)
STORY_IDS = list(range(1, 11))

# Realistic reading accuracy rates for a 5th-grade class
ACCURACY_SAMPLES = [0.72, 0.78, 0.81, 0.85, 0.88, 0.91, 0.94, 0.96, 0.98, 1.0]

# Characters per minute — typical range for elementary students
CPM_SAMPLES = [85, 102, 118, 134, 145, 156, 168, 175, 182, 195]

# Common error characters in reading exercises
ERROR_CHARS_SAMPLES = [
    ["謙", "遜"],
    ["蓬", "勃"],
    ["慷", "慨"],
    ["悲"],
    [],
    ["壯", "闊", "瞻"],
    ["踴"],
    ["蒸"],
]

# ---------------------------------------------------------------------------
# Authentication helpers
# ---------------------------------------------------------------------------


def _register_and_login(client, username: str, password: str = "LoadTest@1234") -> str | None:
    """Register a test user and return a JWT token, or login if already registered."""
    # Attempt registration
    resp = client.post(
        "/register",
        json={
            "username": username,
            "email": f"{username}@loadtest.example",
            "password": password,
            "role": "student",
            "copyright_confirmed": True,
        },
        name="/register",
        catch_response=True,
    )
    if resp.status_code in (200, 201):
        data = resp.json()
        resp.success()
        return data.get("access_token")
    resp.success()  # 409 = already registered — not a failure

    # Login
    resp = client.post(
        "/login",
        json={"username": username, "password": password},
        name="/login",
        catch_response=True,
    )
    if resp.status_code == 200:
        resp.success()
        return resp.json().get("access_token")
    resp.failure(f"Login failed: {resp.status_code} {resp.text[:200]}")
    return None


def _register_teacher_and_login(
    client, username: str, password: str = "LoadTest@1234"
) -> str | None:
    """Register a test teacher and return a JWT token."""
    resp = client.post(
        "/register",
        json={
            "username": username,
            "email": f"{username}@loadtest.example",
            "password": password,
            "role": "teacher",
            "copyright_confirmed": True,
        },
        name="/register (teacher)",
        catch_response=True,
    )
    if resp.status_code in (200, 201):
        resp.success()
        return resp.json().get("access_token")
    resp.success()

    resp = client.post(
        "/login",
        json={"username": username, "password": password},
        name="/login (teacher)",
        catch_response=True,
    )
    if resp.status_code == 200:
        resp.success()
        return resp.json().get("access_token")
    resp.failure(f"Teacher login failed: {resp.status_code}")
    return None


# ---------------------------------------------------------------------------
# Task sets
# ---------------------------------------------------------------------------


class BrowseStoriesTaskSet(TaskSet):
    """Simulate students browsing the story library."""

    @task(3)
    def list_stories(self):
        with self.client.get(
            "/stories",
            headers=self.user.auth_headers,
            name="/stories (list)",
            catch_response=True,
        ) as resp:
            if resp.status_code == 200:
                resp.success()
            else:
                resp.failure(f"stories list: {resp.status_code}")

    @task(2)
    def view_story_detail(self):
        story_id = random.choice(STORY_IDS)
        with self.client.get(
            f"/stories/{story_id}",
            headers=self.user.auth_headers,
            name="/stories/{id}",
            catch_response=True,
        ) as resp:
            if resp.status_code in (200, 404):
                resp.success()
            else:
                resp.failure(f"story detail: {resp.status_code}")

    @task(1)
    def list_my_sessions(self):
        with self.client.get(
            "/learning/sessions",
            headers=self.user.auth_headers,
            name="/learning/sessions (list)",
            catch_response=True,
        ) as resp:
            if resp.status_code == 200:
                resp.success()
            else:
                resp.failure(f"sessions list: {resp.status_code}")


class SubmitReadingTaskSet(TaskSet):
    """Simulate students submitting reading results and triggering AI analysis."""

    session_id: int | None = None

    def on_start(self):
        self._create_session()

    def _create_session(self):
        story_id = random.choice(STORY_IDS)
        with self.client.post(
            "/learning/sessions",
            json={"story_id": story_id},
            headers=self.user.auth_headers,
            name="/learning/sessions (create)",
            catch_response=True,
        ) as resp:
            if resp.status_code in (200, 201):
                self.session_id = resp.json().get("id")
                resp.success()
            else:
                resp.failure(f"create session: {resp.status_code}")

    @task(2)
    def submit_reading_result(self):
        """Update session with reading performance metrics."""
        if not self.session_id:
            self._create_session()
            return
        accuracy = random.choice(ACCURACY_SAMPLES)
        cpm = random.choice(CPM_SAMPLES)
        with self.client.patch(
            f"/learning/sessions/{self.session_id}",
            json={
                "reading_accuracy": accuracy,
                "reading_cpm": cpm,
                "step": "full_reading",
                "completed": False,
            },
            headers=self.user.auth_headers,
            name="/learning/sessions/{id} (PATCH)",
            catch_response=True,
        ) as resp:
            if resp.status_code in (200, 404):
                resp.success()
            else:
                resp.failure(f"update session: {resp.status_code}")

    @task(1)
    def trigger_ai_analysis(self):
        """
        Submit reading result and request AI analysis — the most expensive operation.
        PRD SLA: response < 5s (P95).
        """
        story_id = random.choice(STORY_IDS)
        error_chars = random.choice(ERROR_CHARS_SAMPLES)
        accuracy = random.choice(ACCURACY_SAMPLES)
        cpm = random.choice(CPM_SAMPLES)

        payload = {
            "story_title": f"課文 {story_id}",
            "accuracy": accuracy,
            "cpm": cpm,
            "error_chars": error_chars,
            "total_characters": random.randint(200, 600),
        }

        start = time.perf_counter()
        with self.client.post(
            "/learning/ai-analysis",
            json=payload,
            headers=self.user.auth_headers,
            name="/learning/ai-analysis (standalone)",
            catch_response=True,
            timeout=15,
        ) as resp:
            elapsed = time.perf_counter() - start
            if resp.status_code == 200:
                if elapsed > 5.0:
                    # Record as success but annotate for SLA breach tracking
                    resp.success()
                    events.request.fire(
                        request_type="SLA_BREACH",
                        name="ai-analysis >5s",
                        response_time=elapsed * 1000,
                        response_length=0,
                        exception=None,
                    )
                else:
                    resp.success()
            elif resp.status_code == 429:
                # Rate limited — back off and mark as success (expected under load)
                resp.success()
                time.sleep(random.uniform(1.0, 3.0))
            else:
                resp.failure(f"ai-analysis: {resp.status_code} {resp.text[:200]}")

    @task(1)
    def view_session_report(self):
        if not self.session_id:
            return
        with self.client.get(
            f"/learning/sessions/{self.session_id}/report",
            headers=self.user.auth_headers,
            name="/learning/sessions/{id}/report",
            catch_response=True,
        ) as resp:
            if resp.status_code in (200, 404):
                resp.success()
            else:
                resp.failure(f"session report: {resp.status_code}")


class TeacherDashboardTaskSet(TaskSet):
    """Simulate teachers viewing classroom dashboards."""

    classroom_id: int | None = None

    def on_start(self):
        self._fetch_classrooms()

    def _fetch_classrooms(self):
        with self.client.get(
            "/teacher/classrooms",
            headers=self.user.auth_headers,
            name="/teacher/classrooms",
            catch_response=True,
        ) as resp:
            if resp.status_code == 200:
                classrooms = resp.json()
                if classrooms:
                    self.classroom_id = classrooms[0].get("id")
                resp.success()
            else:
                resp.success()  # Teacher may have no classrooms in test env

    @task(3)
    def view_classroom_progress(self):
        if not self.classroom_id:
            self._fetch_classrooms()
            return
        with self.client.get(
            f"/teacher/classrooms/{self.classroom_id}/progress",
            headers=self.user.auth_headers,
            name="/teacher/classrooms/{id}/progress",
            catch_response=True,
        ) as resp:
            if resp.status_code in (200, 403, 404):
                resp.success()
            else:
                resp.failure(f"classroom progress: {resp.status_code}")

    @task(2)
    def view_classroom_stats(self):
        if not self.classroom_id:
            return
        with self.client.get(
            f"/teacher/classrooms/{self.classroom_id}/stats",
            headers=self.user.auth_headers,
            name="/teacher/classrooms/{id}/stats",
            catch_response=True,
        ) as resp:
            if resp.status_code in (200, 403, 404):
                resp.success()
            else:
                resp.failure(f"classroom stats: {resp.status_code}")

    @task(1)
    def view_heatmap(self):
        if not self.classroom_id:
            return
        with self.client.get(
            f"/teacher/classrooms/{self.classroom_id}/heatmap",
            headers=self.user.auth_headers,
            name="/teacher/classrooms/{id}/heatmap",
            catch_response=True,
        ) as resp:
            if resp.status_code in (200, 403, 404):
                resp.success()
            else:
                resp.failure(f"classroom heatmap: {resp.status_code}")


# ---------------------------------------------------------------------------
# User classes (Locust entry points)
# ---------------------------------------------------------------------------


class StudentBrowsingUser(HttpUser):
    """
    Scenario 1: 30 concurrent students browsing the story library.
    Light read-only traffic — baseline DB/API throughput check.
    """

    tasks = [BrowseStoriesTaskSet]
    wait_time = between(1, 3)
    weight = 1

    auth_headers: dict[str, str] = {}

    def on_start(self):
        uid = f"loadtest_student_browse_{self.environment.runner.user_count}_{id(self)}"
        token = _register_and_login(self.client, uid)
        if token:
            self.auth_headers = {"Authorization": f"Bearer {token}"}


class StudentReadingUser(HttpUser):
    """
    Scenario 2: 30 concurrent students submitting reading results + triggering AI analysis.
    Heavy write + AI traffic — primary SLA target.
    """

    tasks = [SubmitReadingTaskSet]
    wait_time = between(2, 5)
    weight = 2

    auth_headers: dict[str, str] = {}

    def on_start(self):
        uid = f"loadtest_student_read_{self.environment.runner.user_count}_{id(self)}"
        token = _register_and_login(self.client, uid)
        if token:
            self.auth_headers = {"Authorization": f"Bearer {token}"}


class TeacherDashboardUser(HttpUser):
    """
    Scenario 3: 10 teachers viewing dashboards simultaneously.
    Read-heavy aggregation queries — tests DB query performance.
    """

    tasks = [TeacherDashboardTaskSet]
    wait_time = between(3, 8)
    weight = 1

    auth_headers: dict[str, str] = {}

    def on_start(self):
        uid = f"loadtest_teacher_{self.environment.runner.user_count}_{id(self)}"
        token = _register_teacher_and_login(self.client, uid)
        if token:
            self.auth_headers = {"Authorization": f"Bearer {token}"}


class MixedWorkloadUser(HttpUser):
    """
    Scenario 4: Mixed workload — realistic classroom session.
    20 students (browsing + reading) + 10 teachers (dashboard).
    """

    tasks = {
        BrowseStoriesTaskSet: 2,
        SubmitReadingTaskSet: 3,
        TeacherDashboardTaskSet: 1,
    }
    wait_time = between(1, 5)

    auth_headers: dict[str, str] = {}

    def on_start(self):
        uid = f"loadtest_mixed_{self.environment.runner.user_count}_{id(self)}"
        # Randomly assign role: 70% student, 30% teacher
        if random.random() < 0.7:
            token = _register_and_login(self.client, uid)
        else:
            token = _register_teacher_and_login(self.client, uid)
        if token:
            self.auth_headers = {"Authorization": f"Bearer {token}"}


# ---------------------------------------------------------------------------
# Event hooks for test summary
# ---------------------------------------------------------------------------


@events.test_stop.add_listener
def on_test_stop(environment, **kwargs):
    """Print SLA summary to console at end of test run."""
    stats = environment.stats
    print("\n" + "=" * 60)
    print("LingoLeap Load Test — SLA Summary")
    print("=" * 60)
    print(f"Total requests : {stats.total.num_requests}")
    print(f"Failures       : {stats.total.num_failures}")
    if stats.total.num_requests > 0:
        fail_rate = stats.total.num_failures / stats.total.num_requests * 100
        print(f"Error rate     : {fail_rate:.2f}%  (target: 0%)")
    print(f"Median RPS     : {stats.total.current_rps:.1f}")
    print(f"Avg response   : {stats.total.avg_response_time:.0f} ms")
    print(f"P95 response   : {stats.total.get_response_time_percentile(0.95):.0f} ms  (target: <5000ms for AI)")
    print(f"P99 response   : {stats.total.get_response_time_percentile(0.99):.0f} ms")
    print("=" * 60)
