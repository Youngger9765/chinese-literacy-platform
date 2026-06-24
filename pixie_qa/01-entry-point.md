# 01 — Entry point & execution flow

## Entry point
`scripts/spotlight_vision_judge.py` → `render_and_judge(browse, story_id, step, shots_dir)`。
這是 judge 對單一 cell 的真實 pipeline,pixie Runnable 直接呼叫它(不重寫、不 mock)。

## Execution flow(real production path,nothing mocked)
1. `fetch_story(story_id)` → staging `/api/stories/{id}`(本課權威 title/paragraphs)
2. `l3_render_cell(browse, story, step, shots_dir)` → 重用 content_evidence_gate 的 Browse:
   - demo「學生小明」登入 staging /login(browse_login,在 Runnable.setup 做一次)
   - goto `/learn/{story_id}/{step}` → console 檢查 + 截圖(+ retry)
3. `capture_fullpage(browse, shot_path)` → 設高 viewport 重截整頁(below-fold 圖才入鏡)
4. `judge_screenshot(shot_path, story, step)` → **真 Gemini 2.5-flash vision call**(us-central1):
   截圖(多模態 Part.from_bytes)+ 本課 title/paragraphs → JSON {verdict, confidence, reasoning, ...}

**LLM = 真實 Gemini vision call,沒有 mock**(符合 skill「app 的 LLM 必須走真 LLM」鐵律)。

## User-facing interface
內部 QA CLI:`python scripts/spotlight_vision_judge.py --story-id N --step reading-strategy`
或 `--calibrate`(對 eval set 跑全部)。pixie 走 Runnable 包同一條路徑。

## Env requirements
- backend venv(google.genai)+ Vertex AI ADC(service account,**不要設 GOOGLE_APPLICATION_CREDENTIALS**,
  否則指到別 project 的 SA → 403;靠 ADC 走 lingoleap-dev)
- browse binary(gstack)+ staging 可連
- 約束:render 是真實 staging,judge 是真實 Gemini → 每 case ~10-20s,序列化(Semaphore 1,browser 單 session)
