# Modular Spec Battle — Rounds 3, 4, 5 (Addendum)

> Continuation of [Rounds 1-2 deliverable](./spec-modularization-battle-2026-06-01.md). Per Young direction: codex 跟 claude 真 battle，不只 single-round。

---

## Round 3 — Codex Rebuttal

Codex attacks Claude's MCP + Spec-as-Tests with 3 vectors + 1 concession.

### Attack 1: Pytest is a terrible spec storage layer for human product truth

**Vulnerability**: Claude collapses「specification」into「executable assertion」. Sounds clean, but destroys distinction between product intent, pedagogical rationale, and code-verifiable invariants.

**Failure scenario**: OMO grader letter mapping is not just「A maps to 90-100」. Encodes age-band expectations, Traditional Chinese literacy pedagogy, teacher-facing explanation wording, Taiwan/US classroom grading expectations, how parents interpret「needs support」. A pytest BDD file can assert the mapping table, but will not carry reasoning cleanly enough for a future AI agent to decide whether changing「B」feedback copy is a grading change, UX change, or pedagogical change.

**Why Spec Capsule is better**: `SPEC.md` keeps human-readable contract first: context, ownership, rationale, allowed changes, forbidden changes, examples, open questions. `assertions.yaml` extracts machine-checkable invariants without pretending whole product truth fits inside pytest. Test layer verifies drift; does not become source of truth itself.

### Attack 2: "Drift = pytest fail" is too narrow for AI product systems

**Vulnerability**: Claude's model only catches drift representable as deterministic tests. Lingoleap has AI behavior, content quality, rubric interpretation, vocabulary alignment, learner safety boundaries — fail semantically before they fail mechanically.

**Failure scenario**: Grader still returns valid JSON, tests pass, letter mapping unchanged. But Gemini starts generating feedback like「你很差」for struggling elementary students, or uses Simplified Chinese in a Traditional Chinese classroom, or recommends vocabulary outside the lesson's target bank. No pytest mapping test fails. Product is still broken for K-12 learners.

**Why Spec Capsule is better**: Probes are a separate layer because not all drift is unit-test drift. Need deterministic assertions for contracts, plus scenario probes for AI output quality: Traditional Chinese enforcement, age-appropriate tone, rubric consistency, vocabulary-bank adherence, hallucination checks, teacher-facing explanation quality. Claude's「one-shot」integration is just under-instrumentation wearing a clean architecture costume.

### Attack 3: MCP Resource Server adds operational surface before spec model is proven

**Vulnerability**: Claude front-loads infrastructure: MCP server, resource indexing, `resources/list`, `resources/read`, `tools/run_spec`, pytest collection metadata, cross-IDE plumbing. A lot of machinery before proving the team can write durable specs.

**Failure scenario**: Teacher-reporting bug lands Friday night: assessment feedback mismatches lesson vocabulary for Grade 3 readers. Agent now has to trust MCP metadata, pytest collection naming, docstring frontmatter parsing, generated registry. If any stale or broken, discovery fails. Worse, actual spec lives inside backend pytest files, so frontend agents working on parent dashboards or teacher UI may not even look there naturally.

**Why Spec Capsule is better**: `specs/modules/X/SPEC.md` is obvious, grep-able, reviewable, IDE-neutral without requiring MCP runtime. `assertions.yaml` structured enough for tooling. Folder layout maps to product modules instead of backend test implementation. Capsule works with plain files first, can expose MCP later. Claude's design confuses distribution protocol with source-of-truth design.

### Codex concession

Claude is right about the registry. Manual `registry.yaml` can become a stale bottleneck.

Would update Spec Capsule to auto-generate registry from capsule metadata: scan `specs/modules/*/SPEC.md` frontmatter and `assertions.yaml`, emit generated registry, expose through MCP resources. Keep capsule as authoring SOT; borrow Claude's auto-discovery and live `run_spec` as access layer, not core model.

---

## Round 4 — Claude Response

### To Attack 1 (Pytest can't store product truth) — Accept 80%

Codex 對。Underweight 在自承弱點 #2。Lingoleap 真實案例：教授 6/1 review 後 #2027 OMO scanner「為什麼結果頁需要 warm 鼓勵語」這種 pedagogy 直覺，pytest 寫不出。

**But**: codex 的 INTENT.md prose 也有 SOT 衝突 — 如果 SPEC.md prose + SPEC.py test 兩份，AI 改 grader 看哪份？Codex 沒答「人類 prose 跟機器 assertion 怎麼避免 drift」這個它自己的弱點。

**修正**: 採 codex 結構 `specs/modules/{x}/INTENT.md` 為 human SOT，但 INTENT.md 內部用 `<!-- @assertion: SPEC-001 -->` HTML comment 標 anchor，連結 pytest assertion id。CI 跑：(a) pytest 過 (b) INTENT.md 每個 SPEC-* anchor 都有對應 pytest function 存在。沒對應 = drift 警告。

### To Attack 2 (Drift too narrow) — Accept fully

擊中要害。Lingoleap risk：grader 對 G6 學生說「你很差」/ 回 Simplified Chinese / 推 lesson 外 vocab — pytest 全 pass，學生先壞掉。

**修正**: 加 codex `probes/` 第二層，但用 **LLM-as-judge in pytest**（pytest-llm pattern）：
- `assert llm_judge("Is this feedback Simplified Chinese?", output) == False`
- `assert llm_judge("Is tone age-appropriate for grade 6?", output) == True`
- 走 Gemini 2.5-flash-lite（per CLAUDE.md task config）low-cost 跑 probe
- 跟既有 OMO grader 用同一 ai_service，infra 共用
- 跟 #2028 corpus testing framework 接 ground truth

Drift = pytest fail + LLM judge fail，不只 deterministic。

### To Attack 3 (MCP too early) — Partial accept

Codex 對 — MCP runtime day-1 投資 risk 高。But codex 假設 plain files + grep 就夠 — 對 lingoleap stack 不成立：
- CLAUDE.md 已 ~5k token always-loaded
- ~/.claude/skills/ 50+ ref-skills 撐爆 description budget（"N descriptions dropped" warning 週週見）
- grep 撈 spec → AI 不知道哪份 canonical（就是 problem 1）

**修正**: Phase 化 rollout：
- **Phase A (Week 1-2 pilot)**：純 file convention `specs/modules/{x}/INTENT.md + spec.py + probes/`，0 MCP，AI 走 grep + CLAUDE.md routing rule
- **Phase B (達 4/5 eval metric 後)**：加 MCP server thin wrapper

Phase A 跟 codex Spec Capsule 幾乎一樣。Phase B 才差異化。

### Claude concession

Codex 對的地方 underweight：
1. Capsule prose-first 對 onboarding / 跨 audience（方大哥/教授/實習生）絕對贏
2. probes/ 獨立目錄分 deterministic vs semantic drift 結構上比 single pytest harness 清楚
3. 2 週可 ship — Claude MCP infra 真的太重 Phase A 不該排

### Round 4 合成方案（取代原 deliverable §5.4）

```
specs/modules/{feature}/
  INTENT.md            # human SOT prose (codex 設計)
  spec.py              # pytest deterministic assertions (Claude 設計)
  probes/              # LLM-as-judge semantic drift (codex probes + Claude pytest-llm)
  fixtures/            # ground-truth corpus，連結 #2028
  issue-snapshots/     # codex 設計

specs/registry.yaml    # auto-generated from INTENT.md + spec.py docstring (concession)
```

Phase A 不裝 MCP；Phase B eval 達 4/5 metric 才加。

---

## Round 5 — Neutral Critic Verdict (spawned `critic-agent`)

### Round scores

- **R1 Codex**: Point Codex. Capsule structure + `specctl` + `issue-snapshots/` 顯示 system-level thinking. `assertions.yaml` 跟 prose 分開是正確 instinct。
- **R2 Claude**: Point Codex (retroactively). "Drift = test fail" premise stated 沒 defend, MCP-on-day-one 是 gold-plating before problem proven. Claude lost before R3 landed.
- **R3 Codex**: Decisive. 3 attack 全 land. Attack 1 (pytest is wrong SOT for pedagogy) factually correct，verify against this repo — `test_characterization_omo_1949.py` pins HTTP contract，not 「feedback 是 B 還是 乙」. Attack 2 (AI behavior drift invisible to deterministic tests) 是整 battle 最 sharp argument.
- **R4 Claude**: Draw. HTML-comment anchor idea novel + 真解 codex 沒答的 SOT-conflict. probes/ accept 跟 defer MCP 是 correct concessions. **But LLM-as-judge-in-pytest proposal underspecified** — 誰寫 rubric、誰 review CI judge failure、per-run latency cost 多少？

### 最弱接受論點 — implementation 會默默放掉的

**R4 Claude 的 HTML-comment anchor**（`<!-- @assertion: SPEC-001 -->` linking INTENT.md → spec.py assertion ID）。

Team 會寫 INTENT.md、寫 spec.py，**永遠不連結**。Anchor scheme 需要第 3 個 CI check：parse INTENT.md 撈 `@assertion:` comment、validate 對應 pytest function name 存在。這個 check 是第 3 個 artifact **沒人 assign 去 build**。沒它 anchor day-1 rot — prose 說 SPEC-001，pytest function 在 refactor 被 rename，CI silent。**這就是兩邊試圖解的 stale-SOT 問題，在更小尺度重現一次**。

### Architecture verdict — 兩邊都漏的結構性缺陷

R4 合成 directionally sound 但**解錯問題**。

Real constraint visible in this repo：**方大哥跟教授才是 product authority，不是工程師**。CLAUDE.md 說「spec 散在 7 處」但 production 真實 failure 是 **pedagogical decisions 在 meetings 講了從來沒寫到任何地方**（`docs/meetings/` 140 files，`docs/specs/` 9 files）。被設計的 system 假設 spec drift 是 code-spec sync 問題。它 actually 是 **meeting-to-spec capture problem**。兩邊都沒提誰寫 INTENT.md after 5/1 expert review session，或什麼 enforce 它。

Capsule with no author + no update trigger = orphaned markdown.

### 最高 ROI 1-週捷徑

寫 **一個** `probes/` LLM-as-judge test for OMO grading + wire CI + ship。具體：
- 拿 5 張真實學生 answer images from `private/omo-real-samples/`
- Call grader
- Via Gemini 2.5-flash-lite assert output 含 0 Simplified Chinese / 0 negative tone (`你很差`) / grade 在 expected range
- 這正是 Attack 2 描述的 drift
- Map 到既有 `run_grader_ab.py` infrastructure
- Green/red signal 無新 file format / CLI 維護

INTENT.md + spec.py 等 week 2 — 等你有證據 probe layer work 再做。

### 6 個月內會咬人的 risk — 兩邊都沒提

**Probe latency 會在 3 個月內殺掉 CI adoption**。

每個 LLM-as-judge probe call 打 Gemini (即使 flash-lite) with real image. 既有 A/B test scripts show 2-5s/call. 5 images × 3 assertions × N features → probe suite 加 60-120 秒 LLM wall time 到 CI. Team CI 既有每 PR deploy Cloud Run. 工程師（特別高中實習生）會開始 skip probe failures 或 probes 被丟到 nightly job 沒人看。

兩邊都沒指定 probe 是否每 PR 跑 / on a schedule、timeout、failure triage vs deterministic test failure 怎麼分. **這要在第 1 個 probe 寫之前決定**，不是 suite 長到 40 個 probe + CI 8 分鐘才決定。

---

## 合成結論（5 rounds 跑完後）

**最終推薦** — 取代 deliverable §5.4 + §7：

### Architecture
```
specs/modules/{feature}/
  INTENT.md            # human SOT, prose, 方大哥/教授/實習生 都讀得懂
  spec.py              # pytest deterministic assertions
  probes/              # LLM-as-judge semantic drift（先寫 1 個 OMO probe）
  fixtures/            # 連 #2028 ground-truth corpus
  issue-snapshots/     # PR 起 branch 時自動 snapshot

specs/registry.yaml    # auto-generated
```

### 1-Week Pilot（critic 推薦的 shortcut）
- Day 1-2: build 1 probe — OMO grading LLM-as-judge against `private/omo-real-samples/` 5 images
- Day 3: Wire CI（決定 timeout + 跑 per-PR or nightly 排程）
- Day 4-5: Seed 5 drift cases verify probe 抓到
- Day 6-7: INTENT.md + spec.py 結構，但不強迫 anchor linking（critic 警告會 rot）

### 不做（pilot 暫緩）
- MCP server（Phase B 之後再加）
- HTML-comment anchor scheme（critic 標 stale-SOT 問題會 reproduce）
- 全 stack 推 — 等 OMO pilot eval metric 4/5 達標再說

### 真正要先解的問題
**Meeting-to-spec capture**。誰看完 5/1 expert review meeting 後寫 INTENT.md？哪個 trigger 強制 capsule update？

提案：
- 議程 template 加 section「本次會議產生 / 修改了哪些 spec module？」
- Friday meeting prep skill 加 step「scan 上週 meeting 記錄 → INTENT.md update PR」
- 沒這層 capture，spec system 是空盒

### Probe latency policy（critic 強要 upfront）
- Per-PR probes: max 30s total LLM wall time
- 超過 30s 的 probes → nightly schedule
- Probe failure triage：critic-agent review + assign owner within 24h
- Probe budget: $0.50/PR max（用 cost-tracking middleware 量）

---

## Battle scorecard 總結

| Round | Winner | Why |
|-------|--------|-----|
| R1-R2 (initial propose) | Codex | Capsule 更 system-level，drift one-shot 沒 defend |
| R3 (codex attacks) | Codex decisive | 3 attack 全 land |
| R4 (claude response) | Draw | HTML anchor novel 但 underspecified |
| R5 (neutral critic) | Both lose | 都漏 meeting-to-spec capture |
| **Final synthesis** | Hybrid + critic shortcut | 1 probe → CI → ship，prove value 再加 layers |

Sources:
- All Round 1-2 sources (see [main deliverable](./spec-modularization-battle-2026-06-01.md))
- Round 5 critic verdict by `critic-agent` (Anthropic Claude Code subagent), 2026-06-01
