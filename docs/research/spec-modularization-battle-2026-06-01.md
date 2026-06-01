# Modular Spec System — Research + Claude vs Codex Battle

> Goal-loop deliverable for issue #2029. 5 steps: problem → research → claude proposal → codex proposal → battle → eval/QA design.

---

## 1. 問題定義

**核心**：AI 寫 lingoleap feature 時，「相關 spec / context」散落多處且互相覆蓋，無法在不爆 context window 的前提下精準載入「當下 feature scope 需要的 spec 段」。

**5 個 verified friction**（每項都有 grep / curl 證據）：

| # | Friction | Evidence |
|---|---------|----------|
| 1 | **SOT 衝突** | OMO grader 用 `vocabulary` list 算 A-G letter mapping，worksheet PDF 印 `vocab_bank` 字典 — 兩套不一致。`grep "vocab_bank" backend/app/services/omo_question_schema*.py = 0` |
| 2 | **Spec 散落 7 處** | `CLAUDE.md` + `~/.claude/rules/*.md` + `~/.claude/skills/*` + `~/.claude/agents/*.md` + `docs/PRD.md` + `docs/meetings/*.md` + GitHub issue body |
| 3 | **Context window 經濟** | 進 OMO scope 不該載入整份 PRD + 全 meeting + 全 rules。目前是 grep 撈 → miss / 過撈 |
| 4 | **Stale drift 沒偵測** | 5/22 meeting 記載 G6-L25 OK；5/27 audit 發現 8/8 fb_answer 錯。spec ↔ code/data 無 CI sync |
| 5 | **Issue body 是 spec 但在 codebase 外** | AI 寫 code 要 `gh fetch`，可能拿到舊版本 |

---

## 2. 業界做法 Research

5 個獨立 WebSearch + product-manager agent 5 個 source = 10+ references。Key findings：

### 2.1 Anthropic Skills（progressive disclosure）
- 3-level：metadata（always loaded）→ SKILL.md（matched）→ supplementary files（on-demand）
- 我們 stack 已用此 pattern 在 `~/.claude/skills/*`
- 限制：只給 workflow 用，不適合「product spec / domain canonical contract」
- Source: [Anthropic Engineering — Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)

### 2.2 GitHub Spec Kit（spec-first，4-file convention）
- `.specify/{constitution,spec,plan,tasks}.md` 標準四件套
- Spec-driven dev 跨 Microsoft + Anthropic + Google converged standard
- 適合 new feature 規格化，但**不解 SOT 衝突 / drift 偵測**
- Source: [GitHub Spec Kit](https://github.com/github/spec-kit)

### 2.3 ADR-First Development
- YAML frontmatter 建 graph edges（`depends_on` / `related_to`）+ code-side `@adr` tag + auto-built registry
- 解 spec ↔ code 對應問題
- 限制：ADR 是「決策記錄」，不是 living spec — 加新 ADR 不刪舊的 → 累積膨脹
- Source: [ADR-First Development (JohnClick.ai)](https://johnclick.ai/blog/adr-first-development-architecture-decision-records/)

### 2.4 Cursor `.cursorrules` + `.cursor/*.mdc`
- 大專案拆 `.cursor/*.mdc` per-feature rules
- Token usage 是 first-class concern
- 限制：portable 差（Cursor only），不 work in Claude Code / Codex CLI
- Source: [Best practices for coding with agents — Cursor](https://cursor.com/blog/agent-best-practices)

### 2.5 Aider Repo-Map + CONVENTIONS.md
- PageRank-based 自動挑「最相關 source files」進 context（default 1k token budget）
- `.aiderignore` 排除 noise files
- **靈感**：retrieval-based context selection 用在 spec 上
- Source: [Aider Repo-Map](https://aider.chat/docs/repomap.html)

### 2.6 MCP Resources（2026 spec, July 28 RC）
- `resources/*` primitive：spec docs 可當 resource 透過 MCP server 暴露
- 新增 `ttlMs` + `cacheScope` cache control header → AI 知道何時 refresh
- Streamable HTTP transport + OAuth alignment
- **靈感**：spec 不必 colocate in codebase，可走 MCP resource server，跨 project / 跨 agent 共享
- Source: [2026 MCP Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)

### 2.7 RAG Evaluation Framework（2026）
- RAGAS + DeepEval + TruLens + LangSmith — 4 大 framework
- 關鍵 metrics：context precision / context recall / faithfulness / answer relevancy
- 業界 baseline：narrow-domain Precision@5 ≥ 0.7、broad Recall@20 ≥ 0.8
- DeepEval 2.3（2026）有 15+ metric 含 Contextual Precision/Recall
- **直接套用**：spec retrieval = mini RAG 問題，metrics 可直接用
- Source: [RAG Evaluation 2026 — Methods, Metrics, Frameworks](https://datavlab.ai/post/rag-evaluation-methods-metrics-2026-guide)

### 2.8 Spec Drift Detection（living-spec vs static-spec）
- Living-spec：OpenAPI generator 跟 service code 比對，diverged 即 CI fail
- Static-spec：人工 reconcile（不可持續）
- 業界共識：preventing drift > periodically reconciling
- Source: [Specification-Driven Enforcement 2026 (Sesame Disk)](https://sesamedisk.com/specsmaxxing-ai-safety-structured-specifications/)

### 2.9 Vercel Agent Readability Spec
- `.md` mirror of HTML docs + `/llms.txt` global index
- `canonical_url` + `last_updated` frontmatter 給 AI staleness signal
- 適合 public docs；private spec 可參考此 metadata 設計
- Source: [Vercel Agent Readability](https://vercel.com/kb/guide/make-your-documentation-readable-by-ai-agents)

### 2.10 Aurimas State of Context Engineering 2026
- 5 patterns identified（progressive disclosure / RAG / agent memory / tool routing / hierarchical context）
- **Failure mode**：lost-in-middle 效應、100+ skill descriptions 會 degrade accuracy
- 我們 stack 50+ ref skills 已踩這條
- Source: [State of Context Engineering 2026](https://www.newsletter.swirlai.com/p/state-of-context-engineering-in-2026)

---

## 3. Codex 提案

**一句話 architecture**：In-repo **Spec Capsule System** — 每個 feature 擁有 1 個 canonical `SPEC.md` module + executable drift assertions，indexed by 輕量 registry，AI / Skills / Sub-agents / CI / GitHub issues 都從這裡 resolve。

### 3.1 File convention
```
specs/
  registry.yaml
  modules/
    omo-assessment/
      SPEC.md
      assertions.yaml
      fixtures/g6_l25_sample.json
      probes/check_vocab_contract.py
      issue-snapshots/issue-2027.md
```

### 3.2 Frontmatter schema（YAML）
```yaml
id: omo-assessment
canonical_for: [omo.grader.vocab_mapping, omo.worksheet.vocab_bank]
owns:
  code: [backend/app/services/omo_grader.py]
  data: [curriculum/omo/**/*.json]
github_issues: [2027, 2028]
drift_checks: [assertions.yaml#OMO-VOCAB-001]
last_reviewed: 2026-06-01
```

### 3.3 AI discovery flow
1. AI 進 feature scope 先讀 `specs/registry.yaml`
2. By changed files / issue / branch / keyword 找對應 module
3. 只 load matching `SPEC.md`（不撈整 PRD）
4. 觸碰特定 contract → load fixtures / probes
5. 沒 match → must create `specs/modules/<feature>/SPEC.md` before coding（Spec Kit pattern）
6. CLAUDE.md 簡化成 1 條 hard rule：「resolve spec through `specs/registry.yaml`」

### 3.4 CI drift detection
- `specctl` 小 repo script：`validate / match / drift`
- `assertions.yaml` 含 `probe: probes/xxx.py` + `blocks_pr: true`
- CI trigger：files in `owns.code` 變 / fixtures 變 / SPEC.md 變 / PR refs `github_issues`
- Issue body snapshot 進 `issue-snapshots/issue-2027.md`，CI 強制 PR 引用 snapshot — 避免 live fetch ambiguity

### 3.5 Eval metrics
- Spec precision ≥ 0.75
- Spec recall ≥ 0.90
- Drift detection rate ≥ 0.85
- Missed drift count = 0（pilot module）
- AI correction rate ≥ 80%

### 3.6 Pilot
OMO assessment grader + worksheet PDF。Week 1 build infra，Week 2 seed 3 drift cases verify CI 抓到。

### 3.7 自承弱點
1. Spec module 仍會 rot（沒人 update SPEC.md 也沒 enforcement）
2. Executable assertion 只 cover 可 probe 的，UX/pedagogy/product judgment 不行
3. Registry 變新 chokepoint（成長失控）

---

## 4. Claude 提案（distinct 架構）

**一句話 architecture**：**MCP Resource Server + Spec-as-Tests** — spec 是可執行的 BDD test，不寫 prose doc；AI 透過 MCP `resources/*` 查詢介面拿 spec metadata + tokens-aware loading，CI 跑 pytest = drift detection 一體成型。

### 4.1 設計核心思想

> "Spec 跟 code drift 的 root cause 是 spec 是 dead text、code 是 alive."
> 解：**讓 spec 也 alive — spec 是 pytest 跑得起來的 BDD 檔。**

不存 prose `SPEC.md` 給 AI 讀。而是：
- Spec = `specs/omo_assessment.spec.py`（pytest + Hypothesis BDD style）
- Spec 的「contract」用 pytest assertions 寫死
- AI 不用「讀 spec」，AI 用 MCP tool `query_spec(feature, keyword)` 拿到 **spec 跑的結果** + 相關 code path

### 4.2 File convention
```
backend/specs/
  __init__.py
  conftest.py
  omo_assessment_spec.py        # BDD: Given/When/Then in pytest
  omo_grader_letter_mapping_spec.py
  intern_progress_spec.py
  ...
specs/_index.yaml               # auto-generated metadata index from pytest collect
```

**Example — `backend/specs/omo_grader_letter_mapping_spec.py`**:
```python
"""
@spec_id: omo.grader.letter_mapping
@canonical_source: vocab_bank
@owns_code: backend/app/services/omo_question_schema.py
@owns_data: backend/data/lessons/_parsed_2026-05-01/**/*.yml
@related_issues: [2015, 2027]
@last_reviewed: 2026-06-01
"""

import pytest
from pathlib import Path
import yaml
from backend.app.services.omo_question_schema import _build_question_schema

# === Canonical contract assertions ===

def test_vocab_bank_is_letter_mapping_sot():
    """SPEC: When lesson has vocab_bank, it IS the worksheet-canonical letter→word mapping."""
    lesson = yaml.safe_load(Path("backend/data/lessons/_parsed_2026-05-01/G6-L25.yml").read_text())
    assert "vocab_bank" in lesson, "G6-L25 must declare vocab_bank as letter SOT"
    assert lesson["vocab_bank"]["A"] == "揚帆啟航", "Letter A maps to vocab_bank[A]"

def test_grader_resolves_letter_via_vocab_bank_not_vocabulary_index():
    """SPEC: Grader letter→word resolution must use vocab_bank when present, never vocabulary list order."""
    lesson = yaml.safe_load(Path("backend/data/lessons/_parsed_2026-05-01/G6-L25.yml").read_text())
    questions = _build_question_schema(lesson)
    fb_1 = next(q for q in questions if q["id"] == "fb_1")
    # G6-L25 fb_1 answer='E', vocab_bank[E]='集資'
    assert fb_1["correct_word"] == lesson["vocab_bank"]["E"], (
        "Grader must look up via vocab_bank, not vocabulary[index]"
    )

@pytest.mark.parametrize("lesson_file", list(Path("backend/data/lessons/_parsed_2026-05-01/").glob("G[67]-L*.yml")))
def test_no_fb_answer_drift_against_vocab_bank(lesson_file):
    """SPEC: Across all lessons, fb.answer letter must dereference (via vocab_bank) to a real vocab word."""
    lesson = yaml.safe_load(lesson_file.read_text())
    vocab_bank = lesson.get("vocab_bank") or {}
    if not vocab_bank:
        pytest.skip(f"{lesson_file.name} has no vocab_bank — schema variant")
    for fb in lesson.get("fill_in_blank", []):
        letter = fb.get("answer")
        if not letter: continue
        assert letter in vocab_bank, (
            f"{lesson_file.name}: fb answer letter '{letter}' not in vocab_bank "
            f"(letters={list(vocab_bank.keys())})"
        )
```

### 4.3 AI discovery flow（MCP-mediated）

**新 MCP server**：`lingoleap-spec-mcp`（local，Python，serves resources）。

Endpoints（per MCP 2026 spec）：
- `resources/list?keyword=omo` → 回相關 spec 的 metadata（spec_id / owns_code / last_reviewed / ttl_ms）
- `resources/read?id=omo.grader.letter_mapping` → 回 spec body + 該 spec 上次 pytest run 的 PASS/FAIL state
- `tools/run_spec?id=...` → 跑 single spec live，回結果（給 AI 驗證 hypothesis）

AI workflow:
```
[User asks Claude to modify OMO grader]
   ↓
Claude calls mcp.resources/list(keyword="omo grader")
   ↓ (returns metadata only, ~200 tokens)
"omo.grader.letter_mapping" — last_reviewed 2026-06-01, PASS, owns omo_question_schema.py
   ↓
Claude calls mcp.resources/read(id="omo.grader.letter_mapping")
   ↓ (returns the spec file content)
Claude sees Given/When/Then expectations
   ↓
Claude writes code change
   ↓
Claude calls mcp.tools/run_spec(id="omo.grader.letter_mapping")
   ↓
PASS = no drift; FAIL = either code broken or spec needs update (forces decision)
```

### 4.4 CI drift detection

**Drift IS test failure**. 不需要額外的 `specctl` — 直接 `pytest backend/specs/` 跑全部。

GitHub Actions:
```yaml
on:
  pull_request:
    paths:
      - 'backend/app/services/omo_*'
      - 'backend/data/lessons/**'
      - 'backend/specs/*'
jobs:
  spec-check:
    steps:
      - pytest backend/specs/ -v --tb=short
      - if fail: post comment with which spec broke + diff against last green
```

Drift 三層自動偵測：
1. **Code change → spec test fail**：grader 改了 logic 但沒 update spec → CI red
2. **Data change → spec test fail**：YAML 改了答案 vs spec 期望 → CI red
3. **Spec change without code/data change**：spec 更新代表 contract 改了，AI 應自動 propagate

### 4.5 Frontmatter schema（in pytest docstring）
```yaml
@spec_id: string                  # globally unique, dotted-path
@canonical_source: string         # which field/file IS SOT
@owns_code: [paths]
@owns_data: [paths]
@related_issues: [int]
@depends_on: [spec_id]            # graph edges
@last_reviewed: date
@stability: experimental | active | frozen
```

由 `_index.yaml` build script 自動 extract from pytest docstrings — 0 manual sync。

### 4.6 整合既有 stack
- `CLAUDE.md`：1 行 — 「進 backend feature → MCP `lingoleap-spec` 查 spec」
- `~/.claude/skills/spec-driven-development`：keep（workflow skill）
- `~/.claude/agents/git-issue-pr-flow`：加 step — 進入 feature branch 自動 `mcp.resources/list` 用 issue title 當 keyword
- Issue body 不再是 spec source — issue 變成「expected outcome」，引用 `@spec_id` 連結

### 4.7 Pilot rollout
**Week 1**:
- 建 3 個 spec：`omo_grader_letter_mapping_spec.py` / `omo_phase2_learning_session_spec.py` / `intern_skill_tree_spec.py`
- 寫 MCP server stub（FastAPI + MCP SDK，local stdio transport）
- Wire pytest CI

**Week 2**:
- 跑 5 個既有 OMO PR 倒帶 — 用 spec retrieval 看 AI 是否能精準載入 < 1k token 的相關 spec
- Seed 5 drift cases（改 grader 不改 spec / 改 data 不改 spec / 改 spec 不改 code）→ verify CI block

### 4.8 自承弱點
1. **MCP server 是另一個維護負擔** — local stdio 還好，跨 dev machine 就麻煩
2. **Pytest BDD 對非工程師（方大哥 / 教授）不友善** — prose 文件還是有它的角色，這個 design 沒給他們
3. **Spec test 寫好寫壞差異大** — 寫成 brittle assertion = 反 #2028 corpus testing 哲學；需要 corpus 數據驅動的 spec 才真有效

---

## 5. Claude vs Codex Battle

### 5.1 Head-to-head per dimension

| 維度 | Codex (Spec Capsule) | Claude (MCP + Spec-as-Tests) |
|------|---------------------|------------------------------|
| **SOT location** | `specs/modules/{x}/SPEC.md` prose + assertions.yaml | `backend/specs/{x}_spec.py` 直接是 pytest |
| **Drift detection** | `specctl` script + probes/*.py（自訂 layer）| `pytest backend/specs/` 直接跑（既有 infra） |
| **AI 載入方式** | Read `registry.yaml` → match → read SPEC.md | MCP `resources/list` → read spec → run live |
| **新增 surface** | 1 個 `specs/` 目錄 + `specctl` CLI | 1 個 MCP server + `backend/specs/` |
| **既有 infra 重用** | 中（自寫 specctl + probes）| 高（純 pytest + MCP 2026 RC）|
| **跨 IDE / agent** | Repo-local files（Claude Code / Cursor / Codex 都能讀）| MCP standard — Anthropic / OpenAI / Vercel 都支援 |
| **非工程師可讀性** | 高（prose markdown）| 低（pytest BDD code）— 弱點 |
| **drift = test fail 一體化** | 否（spec 跟 probe 分開）| 是（spec = test = ground truth）|
| **Issue body 處理** | snapshot 進 `issue-snapshots/` | 不存，issue 引用 `@spec_id` |
| **Eval metric 框架** | 自訂 5 metric | 同 5 metric + 直接套 RAGAS / DeepEval contextual precision/recall |
| **新 feature workflow** | Spec Kit 風格：sketch SPEC.md → 開做 | TDD-style：寫 spec test → 跑（FAIL） → 寫 code → 跑（PASS）|
| **學習曲線** | 低（看得懂 markdown 都會）| 中（要懂 pytest + MCP client）|
| **2 週 pilot 可行性** | 高 | 中（MCP server 自寫要時間）|

### 5.2 哪些 Codex 贏

1. **Onboarding 友善**：實習生 / 方大哥 / 教授 看 markdown SPEC.md 就懂。Claude 提案要學 pytest BDD 才能讀。
2. **Issue body snapshot 機制**：解決 issue body in-codebase 問題乾淨。Claude 用 `@spec_id` 連結比較 indirect。
3. **2 週可 ship**：Codex MVP 5 個檔案就能跑。Claude MCP server + pytest infra 工程量比較大。
4. **Pedagogy / UX 不可 probe 的 spec**：Codex 用 prose 可承載，Claude 全 pytest 沒法寫「教學引導要 warm」這種 spec。

### 5.3 哪些 Claude 贏

1. **Drift 一體化**：Claude 設計裡 spec failure = test failure，**0 額外 enforcement layer**。Codex 要 `specctl` 跟 probe.py 分開，多一層 drift（probe 跟 spec 自己會 desync）。
2. **MCP 標準化**：跨 Claude Code / Cursor / Codex CLI / Anthropic 自己的 agents 都能用同一 spec server。Codex 的 `specs/` 是 repo-local convention，跨 project 共享要 copy-paste。
3. **AI workflow 自動化程度**：Claude 設計裡 AI 可以 `tools/run_spec` live 驗證 hypothesis，TDD-style 工作流；Codex 要 AI 自己 read prose 再 reason，retrieval 比較被動。
4. **Eval 直接 reuse 業界 framework**：Claude 的「spec retrieval = mini RAG」可直接套 RAGAS contextual precision @ 0.7、DeepEval Contextual Recall。Codex 5 metric 要自寫測試 harness。
5. **少 1 個 chokepoint**：Codex 的 `registry.yaml` 是 single point of failure（自承弱點 #3）。Claude 用 pytest collection auto-generate `_index.yaml`，registry 0 manual maintenance。

### 5.4 推薦合成（不選邊，混 best parts）

**Architecture**：採 **Claude 的 MCP + Spec-as-Tests** 為核心 SOT，但**保留 Codex 的 prose `INTENT.md`** 給非工程師讀。

```
backend/specs/
  omo_grader_letter_mapping_spec.py    # Spec-as-tests (Claude 設計，SOT)
  ...
docs/specs/
  omo-assessment/
    INTENT.md                           # Prose for 方大哥 / 教授 / 實習生 (Codex 設計)
    # INTENT.md 引用 @spec_id，被 CI 檢查 stale
```

CI rule：
- `*_spec.py` 任一變動 → 強制 review `INTENT.md` last_reviewed 是否 ≤ 30 天
- `INTENT.md` 變動 → 強制 link 對應 spec test 是否 also updated

這樣：
- AI 走 MCP → spec test（高頻、機器可驗）
- 人類走 `docs/specs/{x}/INTENT.md`（低頻、給 pedagogy/UX 用）
- Issue body：引用 `@spec_id` + auto-link `INTENT.md`
- Pilot 仍 OMO assessment

---

## 6. Eval / QA 設計（5 步驟最後 1 步）

### 6.1 怎麼驗證做法正確

**Goal-verifiable metrics**（自動跑，每週 cron）：

| Metric | Target | 怎麼算 |
|--------|--------|-------|
| **Spec retrieval precision @5** | ≥ 0.75 | 給 AI 10 個 lingoleap 真實 feature task，看 AI load 的 5 個 spec 裡幾個是 ground-truth relevant |
| **Spec retrieval recall @20** | ≥ 0.90 | 同上 10 個 task，AI 載入 20 個 spec 是否 cover 所有 ground-truth |
| **Drift detection rate** | ≥ 0.85 | Seed 20 個 known drift（改 code 不改 spec / 改 data 不改 spec / vice versa）→ CI 抓幾個 |
| **AI context window 用量** | < 30k token / feature task | 對比 baseline（grep 撈整份 PRD + meetings）通常 50-80k |
| **Time-to-first-correct-edit** | < 5 min | AI 進 feature scope → 第 1 個 code edit 是 spec-aligned 的時間 |
| **Stale doc 比例** | < 10% | `last_reviewed > 30 days` 的 spec / 全 spec count |
| **False positive drift alerts** | < 5% / week | CI block 但實際 spec 沒 break 的次數 |

### 6.2 QA 流程

**Phase A — Eval set 建立**（2 天）：
1. 從 git log 撈過去 30 天 10 個有 spec impact 的 PR（OMO / intern progress / lesson YAML / grader 等）
2. 人工 annotate「該 PR 需要 load 哪些 spec」（ground truth）
3. 寫 `tests/eval_spec_retrieval.py` — 跑 AI agent 對每個 PR scope，log loaded specs，比對 ground truth

**Phase B — Baseline measurement**（1 天）：
1. 不裝 spec system，跑 AI 對 10 個 task，measure context tokens / time / correct edits
2. 這是 baseline

**Phase C — Spec system pilot**（2 週）：
1. Wire MCP server + 3 個 spec test for OMO
2. AI 跑同 10 個 task，re-measure
3. 對比 baseline，verify metric improvement

**Phase D — Adversarial test**（3 天）：
1. Seed 20 個 drift case（人工破壞 code/data/spec 一致性）
2. CI 跑 → 量 detection rate
3. 跑 RAGAS evaluation framework against spec retrieval（[直接套用](https://github.com/explodinggradients/ragas)）

**Phase E — Continuous QA**（ongoing）：
1. 每週跑 retrieval eval 對最新 5 個 PR
2. 看 metric trend
3. Stale doc > 10% → 自動發 reminder issue

### 6.3 GO / NO-GO criteria for 全 stack rollout

Pilot 2 週後達標即推進：
- Precision @5 ≥ 0.75 ✅
- Recall @20 ≥ 0.90 ✅
- Drift detection ≥ 0.85 ✅
- Context token 砍掉 > 40% vs baseline ✅
- Intern 看 spec 第一週能 onboard 寫 1 個 PR ✅（非 metric，質性 signal）

達 4/5 → 推到 intern progress / classroom assignment / vocab pipeline 三個 next feature。
達 ≤ 2 → 重 design。

---

## 7. 結論 + 推薦下一步

**推薦**：採 §5.4 合成方案（MCP + Spec-as-Tests 為 SOT，prose INTENT.md 給 human）。

**第一步**（issue #2029 可拆給實習生）：
1. Build minimal MCP server stub（local stdio，1 endpoint `resources/list`）— 1 day
2. 寫 3 個 spec test（OMO grader vocab_bank / Phase 2 LearningSession / intern progress JSON schema）— 2 days
3. CI wire pytest auto-run on spec/code change — 1 day
4. Baseline eval against 10 historic PR — 2 days
5. 評估指標達標即推進

**長期**：把 spec system 變成 lingoleap 內部 dev infra，後續所有 feature 都從 spec 起手（spec-first，類似 GitHub Spec Kit），AI 寫 code 必須 spec test pass。

---

## Sources

- [Anthropic Engineering — Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- [GitHub Spec Kit](https://github.com/github/spec-kit)
- [Spec Kit documentation](https://github.github.com/spec-kit/)
- [ADR-First Development (JohnClick.ai)](https://johnclick.ai/blog/adr-first-development-architecture-decision-records/)
- [Vercel Agent Readable Docs](https://vercel.com/kb/guide/make-your-documentation-readable-by-ai-agents)
- [State of Context Engineering 2026 (Swirlai)](https://www.newsletter.swirlai.com/p/state-of-context-engineering-in-2026)
- [Best practices for coding with agents — Cursor](https://cursor.com/blog/agent-best-practices)
- [Best Cursor Rules 2026 (Agensi)](https://www.agensi.io/learn/best-cursor-rules-2026)
- [Aider Repo-Map](https://aider.chat/docs/repomap.html)
- [2026 MCP Roadmap](https://blog.modelcontextprotocol.io/posts/2026-mcp-roadmap/)
- [MCP 2026-07-28 Release Candidate](https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/)
- [RAG Evaluation 2026 (Datavlab)](https://datavlab.ai/post/rag-evaluation-methods-metrics-2026-guide)
- [RAG Evaluation Tools (Braintrust)](https://www.braintrust.dev/articles/best-rag-evaluation-tools)
- [Specification-Driven Enforcement 2026 (Sesame Disk)](https://sesamedisk.com/specsmaxxing-ai-safety-structured-specifications/)
- [Best Spec-Driven Development Tools 2026 (Augment Code)](https://www.augmentcode.com/tools/best-spec-driven-development-tools)
