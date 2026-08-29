"""原稿分類（source_profile）的常駐 gate

## 為什麼需要這道 gate —— 普查做一次是不夠的

2026-08-24 抽念順順，五個特例是一課一課撞出來的，花掉一整天。事後補跑普查，
十分鐘全部現形。所以加了「抽取前先普查」這一步。

**但「做過一次普查」會過期**，而且過期是**靜默**的：

- 原稿換版（教材方重發 DOCX）→ 段落切分變了，`renumbered` 可能變 `standard`，反之亦然
- 課文重抽（上游 pipeline 改了切段規則）→ `anchor_hits` 從 1 變 0
- 新課加進來 → 根本沒有 `source_profile`，抽取器照 `standard` 走，撞到沒處理過的特例

這三種都不會有任何錯誤訊息 —— 抽取器只會**默默用過期的分類走錯路徑**，
然後又變成「一課一課撞出來」。那正是這道 gate 要防的。

## 兩層

- **這支（CI，快）**：每課都要有 `source_profile`、class 必須是已知的、
  分布不能無聲改變。只讀 metadata，不需要原稿。
- **`scripts/corpus_profile.py --check`（本機，慢）**：重新量原稿再跟記錄比對，
  抓「原稿換過但沒重跑普查」。原稿在 gitignored 的 `private/`，CI 拿不到，
  所以那層只能在本機跑 —— **改抽取邏輯或收到新原稿時要手動跑**。
"""

import collections
import pathlib

import yaml

LESSONS = pathlib.Path(__file__).resolve().parents[1] / "data" / "lessons"

KNOWN_CLASSES = {
    "standard", "no_section", "multi_text", "no_body", "no_anchor",
    "multi_anchor", "renumbered",
    "no_counter",
}

# 2026-08-24 的分布。變動要**刻意**改這裡，順便回答「為什麼變了」。
BASELINE = {
    # 2026-08-24 調整：multi_text 的判斷提到 no_section **前面**。
    # L0111 L0137 L0144 是「一份多篇」但沒有念順順那一節，原本被 no_section 吃掉，
    # 導致建 parts 時漏了三課。「有沒有念順順」與「是不是一份多篇」是兩個獨立事實，
    # 不該互相遮蔽 —— 所以 no_section 19（原 22）、multi_text 7（原 4）。
    "standard": 128,
    "no_section": 19,
    "multi_anchor": 7,
    "no_anchor": 7,
    #
    # 2026-08-25（#2916）：multi_text 7 → 5、renumbered 1 → 3。
    # L0010 與 L0012 從 multi_text 移到 renumbered。
    #
    # ⚠️ 這**不是**分類器改了判準，是 owner 看過兩份原稿之後的認定：
    # 那兩課印的是一來一往的兩封信，「兩封信就是一篇課文」（2026-08-25 原話），
    # 所以它們不是一份學習單包多篇文章。書信體的段落 idx 會重編，
    # 那正是 renumbered 的定義 —— 分類跟著事實走，事實被人看過了。
    # 兩課的 multi_text 登記已從 metadata 清掉。
    #
    # ⛔ 下一個人看到這條紅不要直接改數字：先確認是**原稿事實變了**
    # （教材方重發、或有人重新認定）還是**分類器判錯了**。前者改基準，後者修分類器。
    "multi_text": 5,
    "no_body": 6,
    "renumbered": 3,
}


def _profiles() -> dict[str, dict]:
    out = {}
    for f in sorted(LESSONS.glob("L*/v3/metadata.yml")):
        d = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        out[f.parent.parent.name] = d.get("source_profile") or {}
    return out


def test_every_lesson_has_been_profiled():
    """每一課都要跑過普查。

    **沒有這條會怎樣**：抽取器讀不到 `source_profile` 時會照 `standard` 主路徑硬走。
    新加進來的課如果剛好是書信體（idx 重編）或沒有錨點，就會**默默取到錯的段落** ——
    沒有錯誤訊息，只有學生讀到不對的文字。2026-08-24 那五個特例就是這樣一課一課炸出來的。
    """
    missing = [uid for uid, p in _profiles().items() if not p]
    assert missing == [], (
        f"{len(missing)} 課沒跑過普查：{missing[:15]}\n"
        "→ python3 scripts/corpus_profile.py --write"
    )


def test_no_unknown_class():
    """只准出現已知的分類。

    **沒有這條會怎樣**：普查腳本將來加新類別（例如「課文分兩欄」）時，
    抽取器不認得它，會落到 else 分支 —— 而 else 分支通常就是 `standard`。
    新類別的意義是「這批課要特別處理」，落到主路徑等於白分類。
    加新類別的正確順序：**先在 skill 的處理表補一列，再加進 KNOWN_CLASSES**。
    """
    bad = {uid: p.get("class") for uid, p in _profiles().items()
           if p and p.get("class") not in KNOWN_CLASSES}
    assert bad == {}, (
        f"出現沒見過的分類：{bad}\n"
        "→ 先在 skill 的『分類 → 抽取時怎麼處理』表補一列，再加進 KNOWN_CLASSES"
    )


def test_the_class_distribution_does_not_drift_silently():
    """分布無聲變動 = 原稿或上游課文變過。

    ⛔ 這條紅了不要直接改 BASELINE 讓它綠 —— 先問「哪幾課變了、為什麼」。
       上游把課文切段規則改掉時，這裡是唯一會叫的地方。
    """
    now = collections.Counter(p.get("class") for p in _profiles().values() if p)
    diff = {c: (BASELINE.get(c, 0), now.get(c, 0))
            for c in set(BASELINE) | set(now) if BASELINE.get(c, 0) != now.get(c, 0)}
    assert diff == {}, (
        f"分類分布變了（class: 基準 → 現在）：{diff}\n"
        "→ 跑 `python3 scripts/corpus_profile.py` 看是哪幾課，確認原因後再更新 BASELINE"
    )
