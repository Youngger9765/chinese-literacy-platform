# 閱讀聚光燈重構 — EDD Foundation 交接文件

> 分支:`feature/spotlight-edd-foundation`(從 `origin/staging` 開)
> 狀態(2026-07-05 更新):**flag `LESSON_RENDERER_V1` 預設 ON(go-live,壞則 fail-closed 退回 legacy);已 push、已與 staging 對齊(conflict 已解);EDD 護欄全綠(backend 183 / frontend 102 tests)。** 要強制走舊版:`VITE_LESSON_RENDERER_V1=false` 或 localStorage `flag_LESSON_RENDERER_V1=false`
> 目的:把「一般/圖文兩套 layout + 逐課手工客製」收斂成「一份 typed 契約 + 一個通用渲染器 + EDD 護欄」,並把團隊 #2205 的確定性擷取產物橋接進來。

---

## 1. 已完成(可驗證)

| Phase | 交付 | 驗證 |
|---|---|---|
| 1 契約 | `backend/app/schemas/lesson_content.py`(pydantic)+ `frontend/src/schema/lessonContent.ts`(zod),8 題型,**答案可驗證性不變量**(每 exercise 強制 `answer_space+answer+grader`),錨點模型 | 63 → 後續累積 pytest / 38 vitest 綠 |
| 2 / 2b 渲染器 | `frontend/src/components/lesson-content/`(`LessonRenderer` + 唯一判分權威 `lessonGrading.ts` + `storyToLesson` adapter);一般/圖文收斂成 block 排列 + layout hint;flag `LESSON_RENDERER_V1`(預設 **OFF**) | render-contract + 段-圖對照測試綠,0 刪除舊碼 |
| 3 橋接 | `scripts/spotlight_to_lesson_content.py`:把 #2205 的 `.spotlight.yml` + `_parsed` 的 `story_structure_table` 翻成 typed `Lesson` | DEV7 七課 round-trip PASS |
| 4a 全 corpus dry-run | `scripts/batch_corpus_dryrun.py` + 覆蓋率總表 | 134 課 0 crash / 0 schema-fail / 0 round-trip-fail;**未 overfit**(gap=−0.21) |
| 4b 保真修正 | range/suffix keypoints 救回、keypoints_table 錨點語意、丟題稽核 | **0 靜默丟題**(獨立 audit:925 steps、905 blanks 全 1:1);hand fixtures + DEV7 golden PASS |

**關鍵設計決策**:紙本→schema 用團隊 #2205 的**確定性 regex 抽取器**(已過 no-overfit eval),**不用 AI 讀 PDF**(會 overfit,Young 反對)。AI 僅留作日後補「確定性抽取器真的抓不到」的缺口,且一樣過 eval。新契約是 #2205 扁平 schema 的 **typed superset**(`KeypointsTable` 即照 parser `extract_keypoints()` 1:1 設計)。

---

## 2. 全 corpus 覆蓋率(134 課,dry-run,`--with-keypoints`)

| 狀態 | 4a | 4b | 說明 |
|---|---|---|---|
| 🟢 GREEN | 40 | **65** | schema ok + 答案可驗證 + 有錨點 + 0 needs_review |
| 🟡 NEEDS_REVIEW | 10 | **67** | 誠實標記(見下),**非假綠** |
| 🟠 UNANCHORED | 81 | **0** | 已消化 |
| ⚪ NO_EXERCISE | 3 | 2 | |
| 🔴 crash/schema-fail/RT-fail | 0 | **0** | 橋接穩定 |

**67 筆 NEEDS_REVIEW 的組成(誠實缺口,非 bug)**,詳見 `backend/data/curriculum_qa/content_known_gaps.adapter.dryrun.yaml`:
- `no_anchorable_passage_in_source`(106):聚光燈來源根本沒有段落/圖(課文正文在主 lesson YAML,未複製進聚光燈)→ 天生無 span 可錨,如實標 needs_review。
- `keypoints_source_is_merged_range`(4)+ `suffix_resolved`(1):keypoints 從合併 range 檔救回,對單課只是近似。
- `multi_choice_incomplete_answer`(16):複選題來源只存 1 個正解。
- `matching_type_unsupported`(1,G5-L8):match 題轉成 `custom` 保留答案,契約未擴充。
- `strategy_type_unmapped`(~105,cosmetic):16 種 strategy 落 `guided_steps` catch-all,不擋綠。
- `fill_table_stub`(17):來源 fill_table 全是空殼 `{type}`,內容在 story_structure_table(已由 keypoints 承接),非丟題。

---

## 3. 過程中的重要發現(給 Young / #2205 owner)

**A. 差點製造「內容放錯課」(張冠李戴)——已避開。** 4b 設計階段一度建議把 `_parsed` 查找全改走 `catalog_to_parsed_code` 權威(含 override map)。實作時**逐課比對內容**發現:G8 那批聚光燈的實際故事對應的是 **bare 檔**,override map 反而會綁到鄰課(如 G8-L9a 聚光燈講珍古德→應對 base `G8-L9`,override 卻指向 `G8-L11` 虎襲)。最終採 **bare-first、只在缺檔時 fallback**,並內容驗證。這正是 `content-mapping-integrity` 鐵律的應用,也提醒:**schema-valid ≠ 內容對**,eval 需納入 story identity 檢查。

**B. adapter 未 overfit。** held-out TEST 全綠率(0.50)高於 DEV(0.29),`generalization_gap=−0.21`;驗證員用 mutation test 證明 0 個 fake pass。Young 對「AI 招數只中一小部分」的顧慮,在此以「確定性抽取 + 全 corpus eval」正面回應。

---

## 4. 需要你們拍板才能繼續(我停在這,未自主跨過)

依 hub 規則(影響線上/架構分歧需先問),以下**未做**:

1. **on-disk 位置**:dry-run 的 `*.lesson.yml` 現在寫在 gitignore 的 `backend/data/lessons/_lesson_content_dryrun/`。正式要放哪?獨立目錄 / 取代或並存於現有 catalog?(牽動 loader/manifest/L2 fingerprint)
2. **backend 供給 + 前端接真實 lesson_content**(dark 接線):做了才能真的在 flag ON 下看到新渲染器吃真實課文。此步依賴 #1 的位置決策。
3. **strategy_name/type 是否進契約**(會動 pydantic+zod 雙契約 drift test)。
4. **兩套 eval 門檻調和**:舊 `answer_recall==1.0` vs 新 `round_trip`,升級後同課受兩把尺,以誰為準?
5. **複選/合併 range 的內容缺口**是否要回頭補(可能需動抽取器,違反「不改抽取器」原則)還是接受 needs_review。
6. **前端 `storyToLesson` stopgap 退役時機**(backend 供給上線後)。
7. **上線範圍與節奏**:DEV7→TEST15→113 課 catalog 批次升級、以及**何時把 `LESSON_RENDERER_V1` 打開到 staging**(不可逆、影響學生端)。
8. **要不要開 GitHub issue 追蹤 / assign 給誰。**

---

## 5. 怎麼跑

```bash
cd backend
# 契約 + 手寫 fixture 護欄
.venv/bin/python -m pytest tests/test_lesson_content_schema.py tests/test_spotlight_to_lesson_content.py tests/test_spotlight_adapter_fidelity.py
# 手寫 fixture 覆蓋率
.venv/bin/python ../scripts/eval_lesson_content.py --fixtures --check-golden
# 全 corpus dry-run(產覆蓋率總表 + 缺口台帳)
.venv/bin/python ../scripts/batch_corpus_dryrun.py --with-keypoints
# 前端契約 parity + 渲染器契約
cd ../frontend && npx vitest run src/schema src/components/lesson-content
```

產出:`docs/spotlight-edd-dryrun-corpus-coverage.md`(每課紅綠燈)、`backend/data/curriculum_qa/content_known_gaps.adapter*.yaml`(缺口台帳)。

規劃書(hub 端):`SPOTLIGHT_REFACTOR_PLAN.md`。
