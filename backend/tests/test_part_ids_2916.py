"""part id 的常駐 gate

## 為什麼需要這道 gate

「一份學習單包多篇文章」的課，每一篇會有自己的 QR code 印在紙本上。
QR 指向 `/learn/{id}/{step}?p=<part id>`，**紙一旦印出去就改不了**。

所以 part id 是一個**對外承諾**：它一旦出現在資料裡，就不能消失、不能改指到別篇、
也不能被重用給新的文章 —— 否則教室裡那張紙會播出不相干的內容，而且沒有任何人會發現。

## 為什麼 id 不是 p1 / p2 / p3

owner 2026-08-24 一句話戳破：**模組換順序時 `p2` 就指到另一篇**。
只要字串看起來像順序，遲早有人重新編號。所以：

    順序 → 住在 lesson.yml 清單的排列
    身分 → 住在不透明 id
    可讀性 → 住在 label（隨便改）

三者分開，改任何一個都不會弄壞另外兩個。
"""

import pathlib
import re

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
LESSONS = ROOT / "backend" / "data" / "lessons"
REGISTRY = ROOT / "backend" / "data" / "part_ids_registry.yml"

# 產生器用的字元集：去掉 0 O · 1 l I · 2 Z z · 5 S s · 8 B b · g q
ALPHABET = set("34679acdefhjkmnpqrtuvwxy")
ID_RE = re.compile(r"^[34679acdefhjkmnpqrtuvwxy]{5}$")


def _lessons_with_parts() -> dict[str, list[dict]]:
    out = {}
    for f in sorted(LESSONS.glob("L*/v3/lesson.yml")):
        d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        body = d.get("lesson", d)
        parts = body.get("parts")
        if parts:
            out[f.parent.parent.name] = parts
    return out


def _registry() -> dict:
    if not REGISTRY.is_file():
        return {}
    return yaml.safe_load(REGISTRY.read_text(encoding="utf-8")) or {}


def test_every_part_id_is_in_the_registry():
    """登記簿是 id 的唯一真相。

    **沒有這條會怎樣**：有人手動在 lesson.yml 加一篇、給了一個沒登記的 id，
    下一次自動產生就可能發出同一個號 → 兩篇共用一個 QR。
    """
    reg = _registry()
    missing = [(uid, p["id"]) for uid, parts in _lessons_with_parts().items()
               for p in parts if p.get("id") not in reg]
    assert missing == [], f"這些 part id 不在登記簿裡：{missing}"


def test_part_ids_are_globally_unique():
    """一個 id 只能屬於一篇。

    **沒有這條會怎樣**：兩篇共用一個 id，掃 QR 進來的學生會被導到其中之一，
    而且是不確定的那一個。
    """
    seen: dict[str, str] = {}
    dupes = []
    for uid, parts in _lessons_with_parts().items():
        for p in parts:
            pid = p.get("id")
            if pid in seen:
                dupes.append(f"{pid}: {seen[pid]} 與 {uid}")
            seen[pid] = uid
    assert dupes == [], f"重複的 part id：{dupes}"


def test_part_ids_look_nothing_like_an_order():
    """id 不可以帶順序語意。

    **沒有這條會怎樣**：有人用 `p1 p2 p3`，然後某天調動篇的順序時把號碼一起改了，
    印在紙上的 QR 就指到別篇 —— 而且完全沒有錯誤訊息。
    """
    bad = [(uid, p.get("id")) for uid, parts in _lessons_with_parts().items()
           for p in parts if not ID_RE.match(str(p.get("id") or ""))]
    assert bad == [], (
        f"這些 id 不符合「5 碼不透明短碼」的形狀：{bad}\n"
        "→ 順序放在清單排列，身分放在 id，可讀性放在 label"
    )


def test_ids_avoid_characters_that_get_misread_on_paper():
    """字元集不可以含易混淆字元。

    **為什麼**：這串印在紙本上，掃不到時老師要手打。`0`／`O` 分不出來的話那個 QR 半殘。
    """
    offenders = [(uid, p["id"], sorted(set(p["id"]) - ALPHABET))
                 for uid, parts in _lessons_with_parts().items()
                 for p in parts if set(str(p.get("id") or "")) - ALPHABET]
    assert offenders == [], f"id 含易混淆字元：{offenders}"


def test_retired_ids_are_never_reused():
    """退役的 id 永久保留。

    **沒有這條會怎樣**：某篇撤下後號碼被回收給新文章，
    教室裡舊講義上的 QR 就會播出一篇不相干的東西。
    """
    reg = _registry()
    retired = {k for k, v in reg.items() if (v or {}).get("status") == "retired"}
    in_use = {p["id"] for parts in _lessons_with_parts().values() for p in parts}
    reused = sorted(retired & in_use)
    assert reused == [], f"退役的 id 又被拿來用：{reused}"


def test_every_multi_text_lesson_has_parts():
    """被判定為 multi_text 的課都要有 parts。

    **沒有這條會怎樣**：分類說它是一份多篇，但沒有 parts 清單，
    後面的渲染與 QR 就會靜默退回「一課一篇」，第 2、3 篇再次消失。
    """
    with_parts = set(_lessons_with_parts())
    flagged = set()
    for f in sorted(LESSONS.glob("L*/v3/metadata.yml")):
        d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        if (d.get("source_profile") or {}).get("class") == "multi_text":
            flagged.add(f.parent.parent.name)
    missing = sorted(flagged - with_parts)
    assert missing == [], (
        f"這些課被判為 multi_text 但沒有 parts：{missing}\n"
        "→ python3 scripts/build_lesson_parts.py --apply"
    )
