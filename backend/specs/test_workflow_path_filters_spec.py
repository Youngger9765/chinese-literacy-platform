"""路徑過濾不可以再用 `on.*.paths`（#2916 收尾）。

GitHub 的 `paths:` 只看**前 300 個變更檔**。一個批次改名的 PR（#2920 改了
3691 個檔，前 300 個全是 `backend/data/lessons/**`）會讓所有 paths 指向
`frontend/**` 的 workflow 判定「沒有相關變更」而跳過 ——
**而且檢查清單上不會出現那一列**，看起來就是全綠。紅燈還會被看到，
不出現的那一列不會。

改用 `dorny/paths-filter`（repo 既有做法，算完整 diff）。這條盯著不要改回去。
"""
from __future__ import annotations

import pathlib

import pytest
import yaml

WF = pathlib.Path(__file__).resolve().parents[2] / ".github" / "workflows"

#: 這幾支的觸發條件曾經因為 300 上限而失效，改用 paths-filter 之後不可以退回去。
#: ⛔ 這份清單**不是手維護的**（見下方 GUARDED）——手維護的清單只會保護到
#: 「上次出事的那幾支」。2026-08-28 就是這樣：三支修好了，而 pytest / spec-check /
#: keypoints-manifest-gate 三道真正的門還留著同一個洞，清單裡沒有它們所以沒人發現。
_FIXED_BY_2916 = ["frontend-checks.yml", "e2e-tests.yml", "schema-check.yml"]

#: 允許保留頂層 paths 的例外，每一支都要寫明為什麼跳過它是安全的。
#: 新增例外＝在說「這支門被靜靜跳過我可以接受」，要有理由。
PATHS_ALLOWED = {
    # 只是把 docs/index.html 同步成 gh-pages 上的 Brand Book。
    # 被跳過的後果是「線上的 Brand Book 沒更新」，不是「門沒把關」，
    # 而且 CLAUDE.md 本來就寫著它要手動同步 + 手動觸發 build。
    "sync-brand-book.yml": "發佈用，不是把關用；漏跑只會讓線上版落後",
}


def _gate_workflows():
    """所有由 push / pull_request 觸發的 workflow —— 全庫掃，不是手打清單。"""
    out = []
    for f in sorted(WF.glob("*.yml")):
        if f.name in PATHS_ALLOWED:
            continue
        try:
            d = yaml.safe_load(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        on = d.get("on") or d.get(True) or {}
        if isinstance(on, dict) and any(k in on for k in ("pull_request", "push")):
            out.append(f.name)
    return out


GUARDED = _gate_workflows()


def _load(name):
    d = yaml.safe_load((WF / name).read_text(encoding="utf-8"))
    # PyYAML 把裸 `on:` 讀成布林 True
    return d, (d.get("on") or d.get(True) or {})


def test_the_workflow_dir_is_there():
    """正向對照 —— 少了它，下面每一條都可能在對空集合斷言。"""
    n = len(list(WF.glob("*.yml")))
    assert n > 10, f"只找到 {n} 個 workflow —— 路徑錯了"


@pytest.mark.parametrize("name", GUARDED)
def test_no_paths_filter_on_the_trigger(name):
    on = _load(name)[1]
    offenders = []
    for event in ("pull_request", "push"):
        cfg = on.get(event)
        if isinstance(cfg, dict) and ("paths" in cfg or "paths-ignore" in cfg):
            offenders.append(event)
    assert not offenders, (
        f"{name} 的 {offenders} 又用了 `paths:` —— 超過 300 檔的 PR 會靜靜跳過整支。\n"
        f"改用 `dorny/paths-filter` 判斷（見 staging-deploy.yml）。")


def _has_detect_changes(name):
    return "detect-changes" in ((_load(name)[0].get("jobs") or {}))


#: 有些 workflow **本來就該每個 PR 都跑**（安全掃描、secret 掃描）——
#: 對它們要求 detect-changes 是錯的判準。所以這條只驗「有裝的要接對」，
#: 不驗「每一支都要裝」。
@pytest.mark.parametrize("name", [n for n in GUARDED if _has_detect_changes(n)])
def test_the_detect_changes_job_is_actually_wired(name):
    """有 detect-changes 就要真的接上，否則它只是個裝飾的 job。

    拿掉 `paths:` 之後如果沒有東西擋，修法就變成「為了保險每次都跑」，
    那是另一種浪費；而裝了卻沒有人 needs 它，等於兩邊都沒有。
    """
    jobs = _load(name)[0].get("jobs") or {}
    uses = yaml.dump(jobs["detect-changes"])
    assert "dorny/paths-filter" in uses, f"{name} 的 detect-changes 沒用 paths-filter"
    gated = [j for j, cfg in jobs.items()
             if j != "detect-changes" and "detect-changes" in str(cfg.get("needs", ""))]
    assert gated, f"{name} 有 detect-changes 但沒有任何 job 依賴它 —— 等於沒接上"


def test_the_scan_covers_the_real_gates():
    """正向對照 + 防萎縮 —— 全庫掃出來的清單必須包含那幾道真的門。

    沒有這條，把一支門丟進 PATHS_ALLOWED 就能讓它從此不被檢查，
    而測試照樣全綠 —— 那正是這支 spec 要防的病本身。
    """
    assert len(GUARDED) >= 8, f"只掃到 {len(GUARDED)} 支，掃描壞了"
    must = {"pytest.yml", "spec-check.yml", "keypoints-manifest-gate.yml",
            *_FIXED_BY_2916}
    missing = must - set(GUARDED)
    assert not missing, (
        f"{sorted(missing)} 不在被守的清單裡。\n"
        f"它們是真的門，不可以放進 PATHS_ALLOWED —— 被 300 上限靜靜跳過時，"
        f"檢查清單上不會出現那一列，看起來就是全綠。")


def test_the_workflow_that_runs_me_watches_the_files_i_guard():
    """守 workflow 的鎖，必須在「改 workflow 的 PR」上被觸發。

    否則有人把 `paths:` 改回頂層時，這支 spec 根本不會跑 ——
    鎖還在、卻永遠不會紅。那正是這支 spec 要防的病，只是換一層。
    """
    d = _load("spec-check.yml")[0]
    steps = d["jobs"]["detect-changes"]["steps"]
    flt = next(s for s in steps if "paths-filter" in str(s.get("uses", "")))["with"]["filters"]
    watched = [l.strip()[2:].strip("'\"") for l in flt.split("\n") if l.strip().startswith("- ")]
    assert any(".github/workflows" in w for w in watched), (
        "spec-check.yml 沒有盯 .github/workflows/** —— "
        "改 workflow 的 PR 不會跑到這支 spec，這裡的每一條鎖都是擺設。\n"
        f"目前盯的: {watched}")
    # 正向對照：確認真的解析到東西，不是空清單讓上面空過
    assert len(watched) >= 5, f"只解析到 {len(watched)} 條路徑，解析壞了"



def test_frontend_test_dir_is_in_the_frontend_checks_filter():
    """`frontend/tests/**` 必須在 `frontend-checks.yml` 的 paths-filter 裡。

    這是 `test_cross_language_paths_are_in_the_ci_filter`（後端測試讀前端檔）的
    對稱情形。同一個病在這個 repo 犯過四次，前三次的補救都寫在
    `frontend-checks.yml` 的 filter 註解裡（`public/data`、`public/qa-shared`、
    `scripts/`），每次都是「補上出事的那一格」。

    🔴 第四次（#3242）：`e2eBackendEnv3242.test.ts` 讀 `tests/e2e/**` 的每一支
    spec 與 helper，用來鎖「環境網址一定要有 env 出口」。`frontend/tests/`
    原本完全不在 filter 裡 → 下一個**只改 spec**、把 `E2E_BACKEND_URL` 拔掉的 PR，
    `frontend-checks.yml` 整支不會被觸發，而**檢查清單上不會出現那一列**，
    看起來就是全綠。紅燈會被看到，不出現的那一列不會。

    ⚠️ 原本想寫成通用版（掃所有 vitest 鎖引用到的路徑，逐一比對 filter），
    寫出來之後它吐的是 `frontend/..`、`frontend/../../../backend/data/lessons`
    這種垃圾路徑 —— 相對路徑要正確解析才有意義，而解析錯的門會亂叫、
    然後被下一個人關掉。所以退回這個**窄而正確**的版本：
    只釘住已經付過代價的那一格。要做通用版的話，先把路徑解析寫對再說。
    """
    doc = yaml.safe_load((WF / "frontend-checks.yml").read_text(encoding="utf-8"))
    globs = doc["jobs"]["detect-changes"]["steps"][1]["with"]["filters"]

    # ⛔ 正向對照：解析拿不到東西的話，下面的 in 比對永遠是假的通過
    assert "frontend/src/**" in globs, "filter 解析壞了 —— 連 frontend/src/** 都找不到"

    assert "frontend/tests/**" in globs, (
        "frontend-checks.yml 的 paths-filter 少了 `frontend/tests/**` —— "
        "e2eBackendEnv3242.test.ts 讀那個目錄，只改 spec 的 PR 不會跑這道門（#3242）")


#: 注音漂移門（run-ci.sh 的 Gate 11/12）的輸入必須在 spec-check 的 filter 上（#3253）。
#:
#: ⚠️ 票原本寫「`generate_lesson_zhuyin --check` 不在任何 workflow 裡」——
#: 那句話字面上對（workflow 裡沒有它的檔名），但**效果上錯**：`spec-check.yml`
#: 跑的是 `bash specs/run-ci.sh`，而那支裡面就是 Gate 11/12。
#:
#: 真正的洞是這門的**輸入**有四類不在 filter 上：`poyin_db.json`、出貨的
#: processor、`backend/data/zhuyin/**`、產生器本身。改那幾樣的 PR 不會觸發
#: spec-check，所以門在、那條路沒插電。這是這個 repo 同一個病的第五次。
_ZHUYIN_GATE_INPUTS = (
    "backend/data/zhuyin/**",
    "backend/scripts/generate_lesson_zhuyin.py",
    "backend/scripts/generate_char_difficulty.py",
    "frontend/public/data/poyin_db.json",
    "frontend/src/components/zhuyin/**",
    "backend/data/lessons/**",
)


@pytest.mark.parametrize("path", _ZHUYIN_GATE_INPUTS)
def test_zhuyin_drift_gate_inputs_are_in_the_spec_check_filter(path: str):
    raw = (WF / "spec-check.yml").read_text(encoding="utf-8")
    assert f"'{path}'" in raw, (
        f"spec-check.yml 的 filter 沒有盯 {path} —— 改它的 PR 不會觸發 spec-check，\n"
        f"而注音漂移門（run-ci.sh 的 Gate 11/12）就住在那支裡面。門會在，但那條路沒插電。"
    )


def test_the_drift_gate_really_runs_in_that_workflow():
    """正向對照：上面那組在對一個**真的會跑那道門**的 workflow 斷言。

    少了這條，有人把 `bash specs/run-ci.sh` 從 spec-check.yml 拿掉，上面六條照樣綠。
    """
    raw = (WF / "spec-check.yml").read_text(encoding="utf-8")
    assert "specs/run-ci.sh" in raw, "spec-check.yml 不再跑 run-ci.sh —— 上面那組在守一個空的門"
    runci = (WF.parents[1] / "specs" / "run-ci.sh").read_text(encoding="utf-8")
    for script in ("generate_lesson_zhuyin.py --check", "generate_char_difficulty.py --check"):
        assert script in runci, f"run-ci.sh 裡沒有 {script} —— 漂移門不在了"


#: 後端的記憶體上限不可以掉回 512Mi（2026-09-18 PM 掃描）。
#:
#: 在 512Mi 下**近 30 天 OOM 三次**（08-29 / 09-02 / 09-16，三個不同 revision），
#: 每次都伴隨 `The request was aborted because there was no available instance`
#: —— 使用者真的看到失敗：
#:
#:     2026-09-16T12:18  Memory limit of 512 MiB exceeded with 514 MiB used
#:     2026-09-16T12:19  9× no available instance
#:
#: 514/512 = 餘裕本來就是負的。這個後端要放注音表（8.3 MB）＋ jieba 字典＋
#: 字型讀音表＋課文 YAML 的 lru_cache。
#:
#: ⚠️ 為什麼要一條測試而不只是註解：這是 workflow 裡的一個數字，
#: 「為了省錢調回去」是很自然的一個編輯，而它的後果（OOM → 拒絕服務）
#: 要等到下一次尖峰才會出現，而且 log 裡長得像基礎設施問題不像我們改壞的。
_BACKEND_MEMORY_WORKFLOWS = ("deploy.yml", "staging-deploy.yml")


@pytest.mark.parametrize("name", _BACKEND_MEMORY_WORKFLOWS)
def test_backend_memory_is_at_least_1gi(name: str):
    raw = (WF / name).read_text(encoding="utf-8")
    # backend 的 deploy 區塊是第一個 `gcloud run deploy`
    blocks = raw.split("gcloud run deploy")
    assert len(blocks) >= 3, f"{name} 找不到兩個 deploy 區塊 —— 這條在對空集合斷言"
    backend_block = blocks[1]
    assert "BACKEND_SERVICE" in backend_block, f"{name} 的第一個 deploy 不是 backend，這條的假設壞了"
    import re as _re
    m = _re.search(r"--memory=(\d+)(Mi|Gi)", backend_block)
    assert m, f"{name} 的 backend deploy 沒有 --memory"
    val, unit = int(m.group(1)), m.group(2)
    mib = val * (1024 if unit == "Gi" else 1)
    assert mib >= 1024, (
        f"{name} 的 backend 記憶體是 {val}{unit} —— 512Mi 下近 30 天 OOM 三次，"
        "每次都拒絕過使用者的請求。⛔ 不要為了省錢調回去（差額每月量級是美分）"
    )


# ─────────────────────────────────────────────────────────────────────────────
# 「門的輸入必須在它自己的 filter 上」—— 通用版（2026-09-18 系統性掃描）
#
# 上面每一組鎖都是「補上次出事的那一格」：#2925 補三支、#3242 補
# `frontend/tests/**`、#3251/#3253 補注音門的四個輸入。補了五輪，而 2026-09-18
# 用全庫掃描一次找出 **46 個**同型的洞 —— 包括
#
#   · `scripts/**`  25 支根目錄腳本被後端測試 `spec_from_file_location` 載進來
#                   直接跑（`build_lesson_schema.py` 就是抽取器本體）
#   · `qa/**`       棘輪基準檔。把基準調鬆是最省力的作弊法，而它不觸發任何門
#   · `.github/workflows/**`  🔴 改 pytest.yml 的 filter **不會跑守著它的那條鎖**
#   · `frontend/index.html`   拔掉 CSP meta tag 不會跑 `csp-meta-tag.test.ts`
#
# 所以這一輪不再補格子，改成讓「漏一格」這件事本身會紅。
#
# ⚠️ 上一次嘗試寫通用版失敗過（見 `test_frontend_test_dir_is_in_the_filter`
# 的註解）：它吐 `frontend/..`、`frontend/../../../backend/data/lessons` 這種
# 垃圾路徑，因為相對路徑沒解析對，而會亂叫的門會被下一個人關掉。
# 這一版的兩個差別：
#   ① 用 **AST** 取字串常數，並排除 docstring —— 註解與說明裡提到的路徑不算依賴
#   ② 只留 **真的存在於 repo** 的路徑，且一律正規化成 repo 相對路徑
# ─────────────────────────────────────────────────────────────────────────────

import ast
import fnmatch
import re

REPO = WF.parents[1]

#: {workflow: 它實際跑的測試目錄} —— 只列「跑整個目錄」的門。
#: pytest.yml 跑 `pytest tests`、spec-check.yml 跑 `pytest specs/`（在 backend 裡）。
#: ⚠️ spec-check 盯 `specs/**` 不代表它跑 `backend/tests` —— 盯得到 ≠ 跑得到，
#: 那正是這 46 個洞裡最多的一類。
_GATE_TEST_DIRS = {
    "pytest.yml": "backend/tests",
    "spec-check.yml": "backend/specs",
}


def _filter_globs(workflow: str) -> list[str]:
    doc = yaml.safe_load((WF / workflow).read_text(encoding="utf-8"))
    dc = (doc.get("jobs") or {})["detect-changes"]
    step = next(s for s in dc["steps"] if "paths-filter" in str(s.get("uses", "")))
    return [l.strip()[2:].strip().strip("'\"")
            for l in step["with"]["filters"].split("\n")
            if l.strip().startswith("- ")]


def _covered(path: str, globs: list[str]) -> bool:
    """dorny/paths-filter 的比對語意（picomatch）。

    被比的是**變更檔**的路徑，所以 `a/**` 命中 `a` 底下任意深度的檔案。
    測試引用的若是一個**目錄**（例如走訪整個 `frontend/src`），那麼只要有
    `frontend/src/**` 這種 glob 就算覆蓋 —— 目錄裡任何檔案變更都會觸發。
    """
    for g in globs:
        if g == path:
            return True
        if g.endswith("/**"):
            base = g[:-3]
            if path == base or path.startswith(base + "/"):
                return True
        if fnmatch.fnmatch(path, g):
            return True
    return False


_PATH_SHAPE = re.compile(r"^(?:[A-Za-z0-9_.\-]+/)+[A-Za-z0-9_.\-]+$")
_PATH_CHAIN = re.compile(r'"([A-Za-z0-9_.\-]+)"((?:\s*/\s*"[A-Za-z0-9_.\-]+")+)')


def _code_strings(path):
    """非 docstring 的字串常數。註解天生不在 AST 裡，所以一起被排掉。"""
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
    except SyntaxError:
        return []
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", None)
            if (body and isinstance(body[0], ast.Expr)
                    and isinstance(body[0].value, ast.Constant)
                    and isinstance(body[0].value.value, str)):
                docstrings.add(id(body[0].value))
    return [n.value for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str)
            and id(n) not in docstrings]


def _referenced_repo_paths(path):
    """這個檔案在**程式碼裡**用到、且真的存在於 repo 的路徑。"""
    found = set()
    for s in _code_strings(path):
        s = s.strip()
        if _PATH_SHAPE.match(s) and (REPO / s).exists():
            found.add(s)
    # `REPO / "backend" / "data" / "x.yml"` 這種 Path 串接（註解行先剔掉）
    src = "\n".join(l for l in path.read_text(encoding="utf-8", errors="ignore").split("\n")
                    if not l.strip().startswith("#"))
    for m in _PATH_CHAIN.finditer(src):
        joined = "/".join([m.group(1)] + re.findall(r'"([^"]+)"', m.group(2)))
        if (REPO / joined).exists():
            found.add(joined)
    return found


def _inputs_of(workflow: str) -> dict[str, set[str]]:
    """{被引用的路徑: {引用它的測試檔}}"""
    out: dict[str, set[str]] = {}
    for f in sorted((REPO / _GATE_TEST_DIRS[workflow]).rglob("*.py")):
        rel = str(f.relative_to(REPO))
        for p in _referenced_repo_paths(f):
            out.setdefault(p, set()).add(rel)
    return out


@pytest.mark.parametrize("workflow", sorted(_GATE_TEST_DIRS))
def test_every_gate_input_is_in_its_filter(workflow: str):
    """這道門跑的測試讀到的每個 repo 路徑，都必須在它自己的 paths-filter 上。

    不在＝改那個檔的 PR 不會觸發這道門，而**檢查清單上不會出現那一列**，
    看起來就是全綠。紅燈會被看到，不出現的那一列不會。
    """
    globs = _filter_globs(workflow)
    inputs = _inputs_of(workflow)

    # 正向對照 ①：掃不到東西＝掃法壞了，不是「沒有依賴」
    assert len(inputs) >= 20, f"{workflow} 只掃到 {len(inputs)} 個路徑 —— 掃法壞了"
    # 正向對照 ②：自己的測試目錄一定要在 filter 上，否則整支掃描在對空集合斷言
    assert _covered(_GATE_TEST_DIRS[workflow] + "/x.py", globs), \
        f"{workflow} 連自己跑的測試目錄都沒盯 —— 這條在對空集合斷言"

    missing = {p: sorted(t)[:3] for p, t in sorted(inputs.items()) if not _covered(p, globs)}
    assert not missing, (
        f"{workflow} 跑的測試讀這些檔，但它的 paths-filter 沒盯：\n"
        + "\n".join(f"  {p}   ← {t}" for p, t in missing.items())
        + "\n\n改它們的 PR 不會觸發這道門 ⇒ 門在，那條路沒插電。"
          "\n補進 filter（同類的整個目錄就用 glob，不要只補出事的那一格）。"
    )


def test_the_matcher_can_actually_say_no():
    """負向對照：比對器要分得開「有盯」跟「沒盯」。

    ⛔ 少了這條，把 `_covered` 寫成 `return True` 上面兩條都會綠 ——
    而那正是「測試存在但什麼都沒測」的樣子。
    """
    globs = _filter_globs("pytest.yml")
    # 這兩個真的在 filter 上
    assert _covered("backend/app/main.py", globs)
    assert _covered("scripts/build_lesson_schema.py", globs)
    # 這兩個刻意不在（會議記錄與根目錄說明檔，不是任何後端測試的輸入）
    assert not _covered("docs/meetings/2026-09-11-agenda.md", globs)
    assert not _covered("README.md", globs)


def test_the_workflow_that_runs_this_lock_watches_the_tests_it_reads():
    """這條鎖住在 backend/specs，由 spec-check 跑。

    它掃的是 `backend/tests` 與 `backend/specs` —— 所以 spec-check 必須盯
    `backend/tests/**`，否則「新增一支讀新檔的後端測試」不會觸發這道門，
    這條鎖就只在別的原因下偶然跑到。同 `test_the_workflow_that_runs_me_...`，
    只是這次守的是**掃描的輸入**而不是被守的對象。
    """
    globs = _filter_globs("spec-check.yml")
    for d in ("backend/tests/x.py", "backend/specs/x.py", ".github/workflows/pytest.yml"):
        assert _covered(d, globs), f"spec-check.yml 沒盯 {d} —— 這條鎖會睡著"
