#!/usr/bin/env python3
"""重點表 QA 看板的「看板課號 → lesson_uid」對照表產生器（#3192）。

為什麼需要這支
--------------
看板的資料檔 `frontend/public/keypoints-qa/lessons-data.js` 是 2026-05-01 的
凍結快照，它的 `lesson_code`（G4-L1…）與 `story_id`（1001…）用的是**當時的
課程編號**。二修重抽（#2683 / #2736）之後課程改成 `lesson_uid`（L0001…），
服務端 id 變成 `20000 + int(uid[1:])`（`lesson_indexes.py`），而且**課號整個
重排過** —— 看板的 G4-L2 是「十秒的背後」，現行目錄的 G4-L2 是「正太與小豬」。

⛔ 所以這兩條路不能當對照鍵（量法：152 列各自去對現行 179 課）：
  · `story_id`（1001…）  —— 現行 id 是 20001–20179，兩個區間完全不重疊 → 0 課
  · `catalog_slot`       —— 137 列對得到 slot，其中 122 列標題不符 → 它是另一套編號

**用標題**（量法：剝異體字選擇器＋NFKC＋去空白標點＋台↔臺）：137 課唯一命中，
3 課同名（同一篇出現在不同年級），12 課改名或下架 —— 這 15 課逐一列在 `OVERRIDES`。

⚠️ **原稿 docx 檔名是很強的第二訊號，但我一開始把它量錯了**：頭一版只剝課號前綴
就說「只對得上 50 課」，複審用同一條路再剝掉策略註記／`(課次待改)`／日期尾碼，
量到 **142/152 唯一命中，其中 141 與本表一致** —— 而唯一不一致的那一條正是我
`OVERRIDES` 裡唯一判錯的（G7-L31，見下）。所以它現在是 `check_source_file_guard()`
的依據，不是被否決的候選鍵。

⚠️ 這支不是把整份 lessons-data.js 重新產生（那支產生器不在 git 裡，見 #3192
留言）。它只產生 `lesson-uid-map.js` 這一張對照表，不動凍結快照本身。

課程再改一次名/編號時，`test_keypoints_qa_uid_map_3192.py` 會紅，提示重跑這支。
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
BOARD_DATA = REPO / "frontend" / "public" / "keypoints-qa" / "lessons-data.js"
LESSONS_DIR = REPO / "backend" / "data" / "lessons"
OUT = REPO / "frontend" / "public" / "keypoints-qa" / "lesson-uid-map.js"

# 服務端 id 的算法，抄自 backend/app/services/lesson_indexes.py:971
STORY_ID_BASE = 20000

# 標題對不上、或同名需要指定的 15 課。值為 None = 該課已不在現行目錄裡。
# 每一條都查過 `backend/data/lessons/*/v3/lesson.yml`，不是推測。
OVERRIDES: dict[str, tuple[str | None, str]] = {
    # 同名（同一篇課文出現在多個年級）→ 取看板那一課所屬年級的那一份
    "G4-L7": ("L0013", "正太與小豬在 6 個年級各有一份，看板這筆是四年級"),
    "G4-L9": ("L0003", "大自然的氣象小幫手 G4/G7 各一份，看板這筆是四年級"),
    "G6-L18": ("L0056", "把手上的餅吃香一點 G6/G7 各一份，看板這筆是六年級"),
    # 改過名（同一篇，標題被編輯過）
    "G5-L8": ("L0031", "奧運銀牌的自我鍛鍊 → 奧運銀牌背後的自我鍛鍊"),
    "G7-L8": ("L0095", "科學怪人 → 科學怪人（弗蘭肯斯坦：現代普羅米修斯）"),
    "G7-L23": ("L0111", "第一篇 雨林裡的奇蹟藥物 → 雨林裡的奇蹟藥物"),
    "G7-L29": ("L0134", "從四張圖，看地球暖化的現象 → 從四張圖看地球暖化"),
    "G9-L3": ("L0131", "國高中數學課當然可以使用計算機！ → 國高中數學當然可以使用計算機"),
    "G9-L11": ("L0139", "見前人所未見—達爾文與長喙天蛾的故事 → 長喙天蛾見前人所未見"),
    "G9-L15-16": ("L0137", "看板是多課合併，現行目錄只有「未解之謎──石頭的祕密」一課"),
    "G9-L17-19": ("L0144", "看板是多課合併，現行目錄只有「馬拉松王者──基普喬吉」一課"),
    # ⚠️ 我第一版把這課判成「查無此課」，錯的。它是 L0111 的**第二篇**：L0111 是一課
    #    兩篇（multi_text_parts.yml：第13課 雨林裡的奇蹟藥物 ／ 第14課 最後一隻旅人鴿），
    #    而看板的 G7-L23 與 G7-L31 共用同一份原稿 docx —— 全 152 列裡唯一的一組。
    #    判錯的代價是實的：L0111 的教師版學習單 `gcs_uploaded` 是 true，抓得到，
    #    我卻把那顆鈕關掉並告訴審查者「沒有原稿」。
    "G7-L31": ("L0111", "最後一隻旅人鴿＝L0111 第二篇，與 G7-L23 共用原稿（一課兩篇）"),
    # 已不在現行 179 課目錄裡 —— 看板要明說，不可以留一顆按下去 404 的鈕（#2845）
    "G6-L4": (None, "兩千五百歲的酷老師：現行目錄查無此課"),
    "G6-L5": (None, "卡通人氣王票選政見發表會：現行目錄查無此課"),
    "G9-L9": (None, "力與美表現的競技體操：現行目錄查無此課"),
}


def norm_title(t: str) -> str:
    """把兩份快照之間會漂的東西剝掉：異體字選擇器、全半形、空白、標點、台/臺。"""
    t = re.sub(r"[\U000E0100-\U000E01EF]", "", t or "")
    t = unicodedata.normalize("NFKC", t)
    t = t.replace("台", "臺")
    t = re.sub(r"[\s　]+", "", t)
    return re.sub(r"[（）()「」『』《》\[\]【】,，、。.:：;；!！?？~〜\-－—─–_#＃]+", "", t)


def read_board() -> list[tuple[str, str]]:
    src = BOARD_DATA.read_text(encoding="utf-8")
    pairs = re.findall(
        r'"lesson_code"\s*:\s*"([^"]+)"[\s\S]{0,700}?"title"\s*:\s*"([^"]*)"', src
    )
    if not pairs:
        sys.exit(f"讀不到看板課目：{BOARD_DATA}")
    return pairs


def read_board_sources() -> dict[str, str]:
    """看板課號 → 原稿 docx 檔名。`check_source_file_guard` 用它抓誤判的下架。"""
    src = BOARD_DATA.read_text(encoding="utf-8")
    return dict(
        re.findall(
            r'"lesson_code"\s*:\s*"([^"]+)"[\s\S]{0,900}?"source_file"\s*:\s*"([^"]*)"', src
        )
    )


def has_keypoints(uid: str) -> bool:
    """這一課現行有沒有「文章重點表」—— 看板審的就是它。

    ⚠️ 「課文在」跟「有重點表」是兩件事：148 課對得到 uid，其中 16 課現行沒有這一節。
    把這兩種混成一種，審查者會被送去一個結構上就沒有對照對象的頁面，
    然後對著空白的右欄找登入問題。
    """
    return bool(list((LESSONS_DIR / uid / "v3").glob("keypoints.*.yml")))


def check_source_file_guard(mapping: dict[str, str | None]) -> list[str]:
    """標成下架的列，不可以跟「已對到課」的列共用同一份原稿 docx。

    這條就是 G7-L31 那個錯的形狀：兩列指同一份 docx，我卻只給其中一列 uid。
    刻意用**純字串比對**，不做任何正規化 —— 沒有旋鈕就不會隨我調參數而漂掉。
    """
    sources = read_board_sources()
    by_src: dict[str, list[str]] = {}
    for code, src in sources.items():
        if src:
            by_src.setdefault(src, []).append(code)
    problems = []
    for code, uid in mapping.items():
        if uid is not None:
            continue
        siblings = [c for c in by_src.get(sources.get(code, ""), []) if c != code]
        mapped = {c: mapping.get(c) for c in siblings if mapping.get(c)}
        if mapped:
            problems.append(
                f"{code} 標成下架，但跟 {mapped} 共用同一份原稿 → 它多半是那一課的另一篇，不是下架"
            )
    return problems


def check_injectivity(mapping: dict[str, str | None]) -> list[str]:
    """兩個看板課號指到同一個 uid，只有「一課兩篇共用原稿」這一種情況說得通。"""
    sources = read_board_sources()
    seen: dict[str, list[str]] = {}
    for code, uid in mapping.items():
        if uid:
            seen.setdefault(uid, []).append(code)
    problems = []
    for uid, codes in seen.items():
        if len(codes) < 2:
            continue
        srcs = {sources.get(c) for c in codes}
        if len(srcs) != 1:
            problems.append(f"{codes} 都指到 {uid}，但原稿不同（{srcs}）→ 至少有一個是對錯的")
    return problems


def read_lessons() -> dict[str, str]:
    out: dict[str, str] = {}
    for p in sorted(LESSONS_DIR.glob("L*/v3/lesson.yml")):
        m = re.search(r"^title:\s*(.+)$", p.read_text(encoding="utf-8"), re.M)
        if m:
            out[p.parts[-3]] = m.group(1).strip()
    if not out:
        sys.exit(f"讀不到課文標題：{LESSONS_DIR}")
    return out


def build() -> tuple[dict[str, str | None], list[str]]:
    board = read_board()
    lessons = read_lessons()
    by_title: dict[str, list[str]] = {}
    for uid, title in lessons.items():
        by_title.setdefault(norm_title(title), []).append(uid)

    mapping: dict[str, str | None] = {}
    problems: list[str] = []
    used_overrides: set[str] = set()

    for code, title in board:
        if code in OVERRIDES:
            uid, _why = OVERRIDES[code]
            used_overrides.add(code)
            if uid is not None and uid not in lessons:
                problems.append(f"{code}: OVERRIDES 指向不存在的 {uid}")
            mapping[code] = uid
            continue
        cand = by_title.get(norm_title(title), [])
        if len(cand) == 1:
            mapping[code] = cand[0]
        else:
            # 自動對照失效 = 課程又動過。**不放行**，逼人回來看，而不是靜默漏掉。
            problems.append(
                f"{code}「{title}」自動對照到 {len(cand)} 課（{cand}）→ 請加進 OVERRIDES"
            )
            mapping[code] = None

    for code in OVERRIDES:
        if code not in used_overrides:
            problems.append(f"OVERRIDES 有 {code}，但看板資料裡沒有這一課（該刪了）")
    problems += check_source_file_guard(mapping)
    problems += check_injectivity(mapping)
    return mapping, problems


def render(mapping: dict[str, str | None]) -> str:
    table = {
        code: {"uid": uid, "keypoints": bool(uid) and has_keypoints(uid)}
        for code, uid in sorted(mapping.items())
    }
    live = [c for c, v in table.items() if v["uid"]]
    gone = sorted(c for c, v in table.items() if not v["uid"])
    nokp = sorted(c for c, v in table.items() if v["uid"] and not v["keypoints"])
    body = json.dumps(table, ensure_ascii=False, indent=2)
    return (
        "// 自動產生，請勿手改。重跑 `python3 scripts/build_keypoints_qa_uid_map.py` 更新。\n"
        "// 看板課號（2026-05-01 凍結快照的編號）→ 現行 lesson_uid ＋ 現行有沒有重點表。\n"
        f"// 對得上 {len(live)} 課，其中 {len(nokp)} 課現行沒有重點表：{', '.join(nokp) or '（無）'}\n"
        f"// 不在現行目錄的 {len(gone)} 課：{', '.join(gone) or '（無）'}\n"
        f"window.LESSON_CATALOG_BY_CODE = {body};\n"
        f"window.LESSON_STORY_ID_BASE = {STORY_ID_BASE};\n"
    )


def main() -> int:
    mapping, problems = build()
    if problems:
        print("⛔ 對照表建不起來：", file=sys.stderr)
        for p in problems:
            print("   -", p, file=sys.stderr)
        return 1
    text = render(mapping)
    if "--check" in sys.argv:
        cur = OUT.read_text(encoding="utf-8") if OUT.is_file() else ""
        if cur != text:
            print("⛔ lesson-uid-map.js 與現行課程對不上 → 重跑這支", file=sys.stderr)
            return 1
        print("✅ 對照表與現行課程一致")
        return 0
    OUT.write_text(text, encoding="utf-8")
    live = sum(1 for v in mapping.values() if v)
    nokp = sum(1 for v in mapping.values() if v and not has_keypoints(v))
    print(
        f"✅ 寫出 {OUT.relative_to(REPO)}：{live} 課對得上"
        f"（其中 {nokp} 課現行無重點表）/ {len(mapping) - live} 課已下架"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
