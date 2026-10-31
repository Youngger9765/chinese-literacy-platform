"""閱讀寶貝 —— 能力家族改用陳淑麗教授課程地圖家族（#3780 第三階段）。

第二階段實測抓到：寶貝卡寫「主要能力：寫作鑑賞力」（AI 分的舊 11 家族 A-K），
圖鑑卻已經用教授的家族分組（F01-F14），兩邊對不上。這裡鎖住：

1. 後端 `lesson_indicators.json` 每一課的 `ability_family` 都是教授家族代碼
   （F01-F14），沒有教授節點的課落入 AI00 兜底桶——不再出現 A-K
2. 後端與前端 `readingBabyProfessorFamilies.json` 179 課逐課一致（同一份來源）
3. 產生器 `build()` 從設計文件重跑也得到同樣結果（不是手改 JSON）
4. 寶貝卡 API 回的 `ability_family_name` 是教授家族名
"""
from __future__ import annotations

import json
import re
from pathlib import Path

from app.services import reading_baby_config

_REPO_ROOT = Path(__file__).resolve().parents[2]
_FRONTEND_FAMILIES = _REPO_ROOT / "frontend" / "src" / "data" / "readingBabyProfessorFamilies.json"

_PROFESSOR_CODE = re.compile(r"^(F\d{2}|AI00)$")


def _frontend_family_map() -> dict[str, dict]:
    return json.loads(_FRONTEND_FAMILIES.read_text(encoding="utf-8"))["lessons"]


def test_every_lesson_uses_a_professor_family_code_not_the_old_ai_families():
    lessons = reading_baby_config.lessons_by_uid()
    assert len(lessons) == 179
    bad = {uid: m["ability_family"] for uid, m in lessons.items() if not _PROFESSOR_CODE.match(m["ability_family"] or "")}
    assert bad == {}, f"還有課用舊的 AI 家族代碼：{list(bad.items())[:5]}"


def test_backend_and_frontend_agree_on_every_lesson_family():
    backend = reading_baby_config.lessons_by_uid()
    frontend = _frontend_family_map()
    assert set(backend) == set(frontend)
    mismatched = [
        (uid, backend[uid]["ability_family"], frontend[uid]["family"])
        for uid in sorted(backend)
        if backend[uid]["ability_family"] != frontend[uid]["family"]
        or backend[uid]["ability_family_name"] != frontend[uid]["family_name"]
    ]
    assert mismatched == [], f"前後端家族不一致（前 5 筆）：{mismatched[:5]}"


def test_known_lessons_land_in_the_expected_professor_family():
    # L0001〈十秒的背後〉教授節點 N40，家族 F08 寫作手法
    l0001 = reading_baby_config.get_lesson_indicator("L0001")
    assert (l0001["ability_family"], l0001["ability_family_name"]) == ("F08", "寫作手法")
    # L0095 沒有教授節點 → AI00 兜底桶，名稱要明說還沒審核
    l0095 = reading_baby_config.get_lesson_indicator("L0095")
    assert l0095["ability_family"] == "AI00"
    assert "待審核" in l0095["ability_family_name"]


def test_generator_reproduces_the_committed_families():
    from scripts.build_reading_baby_lesson_indicators import build

    rebuilt = build()["lessons"]
    committed = reading_baby_config.lessons_by_uid()
    diffs = [
        uid for uid in committed
        if (rebuilt[uid]["ability_family"], rebuilt[uid]["ability_family_name"])
        != (committed[uid]["ability_family"], committed[uid]["ability_family_name"])
    ]
    assert diffs == [], f"committed JSON 跟產生器結果不同，請重跑產生器：{diffs[:5]}"


def test_indicator_texts_cover_every_code_any_station_measures():
    texts = reading_baby_config.load_lesson_indicators()["indicator_texts"]
    used = {
        st["indicator_code"]
        for meta in reading_baby_config.lessons_by_uid().values()
        for st in meta["stations"].values()
    }
    missing = sorted(code for code in used if not texts.get(code))
    assert missing == [], f"這些指標代碼沒有課綱原文：{missing}"
    assert reading_baby_config.get_indicator_text("5-Ⅱ-5") == "認識記敘、抒情、說明及應用文本的特徵。"
    assert reading_baby_config.get_indicator_text("NOPE") is None


def test_avatar_inputs_use_the_same_family_as_the_backend():
    """寶貝造型的招牌小物依家族挑；它的輸入檔由另一支產生器寫，這裡鎖住兩邊一致
    （只重跑其中一支時會在這裡變紅，而不是寶貝小物跟分組靜默對不上）。"""
    avatar_inputs = json.loads(
        (_REPO_ROOT / "frontend" / "src" / "data" / "readingBabyAppearanceInputs.json").read_text(encoding="utf-8")
    )["lessons"]
    backend = reading_baby_config.lessons_by_uid()
    assert set(avatar_inputs) == set(backend)
    mismatched = [uid for uid in backend if avatar_inputs[uid]["family"] != backend[uid]["ability_family"]]
    assert mismatched == []
