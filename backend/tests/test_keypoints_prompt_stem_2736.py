"""`prompt` 寫了題幹，橋接器不讀 → 學生看不到題目在問什麼（#2736）

為什麼需要這支
--------------
`keypoints_to_structure.py` 全檔 grep `prompt` 是 **0 命中**。可是抽取出來的
`keypoints.yml` 裡有 `prompt:`，而且它承載的是**題幹**：

    - label: 阿耀的問題
      prompt: 下列哪個是阿耀遇到的問題？(單選)     # ← 這句
      options: {1: …, 2: …}

橋不讀 → 那一格渲染成空字串。跟 `sub_label` 那個 bug 同一族：
**作者寫了、橋不讀、學生看不到，而且不報錯。**

`prompt` 出現在三個結構不同的位置，各走各的 code path，所以要分別接：

  ① 子項層（`sub_rows`/`items` 的元素）→ `_flatten_items`
  ② 列層（`rows` 的元素本身）          → `keypoints_to_structure_table` 的 rows 迴圈
  ③ 表末星號題（`tail_question`）      → 同函式尾段

⚠️ 已知未涵蓋：L0029 的 3 筆 `prompt` 在 `keypoints.part2_table` 底下，
而 `part2_table` **整個** top-level key 橋從來沒讀過（不只 prompt，是整張第二表）。
那是另一個層級的缺口，不在這支的守備範圍 —— 這支只保證「橋看得到的位置」不掉題幹。

這支怎麼擋
----------
跟 `test_keypoints_subitem_label_2736.py` 同樣紀律：從 YAML 自己數出「作者寫了幾句
題幹」，再數渲染後真的出現幾句，斷言**兩個數字相等**；另釘下限防止掃不到課的假綠。
"""
from __future__ import annotations

import pathlib

import yaml

from app.services.keypoints_to_structure import keypoints_to_structure_table

LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data/lessons"

# 2026-08-18 全庫實際值 5（L0011×3 子項、L0012×1 列層、L0164×1 表末）。
# 不含 L0029 的 3 筆 —— 見檔頭說明，那 3 筆在 `part2_table` 裡，橋看不到那個 key。
# 用下限不用等號：課只會變多。它唯一的工作是確認這支真的掃到東西了。
EXPECTED_FLOOR = 5


def _authored_prompts(kp: dict) -> list[str]:
    """作者寫在**橋看得到的位置**的題幹。不呼叫橋接器算期望值。"""
    found: list[str] = []

    def take(node) -> None:
        if isinstance(node, dict) and str(node.get("prompt") or "").strip():
            found.append(str(node["prompt"]).strip())

    for row in kp.get("rows") or []:
        if not isinstance(row, dict):
            continue
        take(row)
        # 橋是 `sub_rows or items` 先命中者勝，這裡照抄，否則會數到它看不見的東西
        for item in (row.get("sub_rows") or row.get("items") or []):
            take(item)
    take(kp.get("tail_question"))
    return found


def _all_cells(table: list[list]) -> list[str]:
    return [str(c) for cells in (table or []) for c in cells]


def test_every_authored_prompt_survives_the_bridge() -> None:
    total = 0
    missing: list[tuple[str, str]] = []

    for path in sorted(LESSONS.glob("*/v3/keypoints.yml")):
        uid = path.parts[-3]
        kp = (yaml.safe_load(path.read_text(encoding="utf-8")) or {}).get("keypoints") or {}
        authored = _authored_prompts(kp)
        if not authored:
            continue
        total += len(authored)
        cells = _all_cells(keypoints_to_structure_table(kp) or [])
        for stem in authored:
            # ⚠️ 這裡**不可以**用 `stem in cell`。L0011 的三句題幹裡，
            #    「(單選，請打勾)」是「在重要比賽，輸球的狀況下，仍然選擇：(單選，請打勾)」
            #    的子字串 —— 用包含的話，前者會被後者那一格冒充成「有畫出來」，
            #    於是拆掉 sub_items 那個接點測試仍然全綠（mutation 實測抓到的假綠）。
            #    題幹一律接在該格**開頭**，所以比開頭，不比包含。
            if not any(c == stem or c.startswith(f"{stem}\n") for c in cells):
                missing.append((uid, stem))

    assert total >= EXPECTED_FLOOR, (
        f"只數到 {total} 句題幹，少於下限 {EXPECTED_FLOOR} —— "
        "這代表這支測試沒掃到課，不是資料變乾淨了"
    )
    assert not missing, (
        f"{len(missing)}/{total} 句題幹渲染後不見了，"
        f"涉及 {len({u for u, _ in missing})} 課：{missing}"
    )


def test_prompt_does_not_displace_the_body_text() -> None:
    """正向對照：同時有 `prompt` 和 `value` 時，兩個都要在，題幹在前。

    只補 prompt 而把 value 蓋掉的話，上面那條照樣綠（題幹在），但內容反而變少了。
    """
    kp = {
        "rows": [{
            "label": "事例",
            "sub_rows": [{
                "label": "結果",
                "prompt": "(單選，請打勾)",
                "value": "結果，小戴（　）球賽。",
            }],
        }],
    }
    cell = keypoints_to_structure_table(kp)[0][2]
    assert "(單選，請打勾)" in cell
    assert "結果，小戴（　）球賽。" in cell
    assert cell.index("(單選，請打勾)") < cell.index("結果，小戴（　）球賽。")


def test_two_prompts_where_one_contains_the_other() -> None:
    """回歸鎖：短題幹是長題幹的子字串時，兩句都要各自有自己的格子。

    這是 mutation 實測抓到的假綠形狀 —— 短的那句被長的那格冒充，
    於是「母項題幹」那個接點被拆掉也沒有測試會紅。
    """
    kp = {
        "rows": [{
            "label": "事例",
            "sub_rows": [
                {"label": "經過", "prompt": "在重要比賽的狀況下：(單選，請打勾)",
                 "options": {1: "甲", 2: "乙"}, "answer": 1},
                {"label": "結果", "prompt": "(單選，請打勾)", "value": "結果，他（　）。",
                 "sub_items": [{"index": 1, "options": {1: "贏了", 2: "輸了"}, "answer": 2}]},
            ],
        }],
    }
    cells = [c for row in keypoints_to_structure_table(kp) for c in row]
    starts = lambda stem: any(c == stem or c.startswith(f"{stem}\n") for c in cells)
    assert starts("在重要比賽的狀況下：(單選，請打勾)")
    assert starts("(單選，請打勾)")


def test_rows_without_prompt_are_untouched() -> None:
    """負向對照：沒有 `prompt` 的列，輸出不可以因為這次改動多出任何東西。"""
    kp = {"rows": [{"label": "主角", "value": "【戴資穎】"}]}
    assert keypoints_to_structure_table(kp) == [["主角", "【戴資穎】"]]
