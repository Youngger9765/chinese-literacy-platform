"""重點表形狀門的「整張表會是空的」這句話，要真的等於「整張表會是空的」。

為什麼需要這一支
----------------
`scripts/keypoints_shape_gate.py` 對 L0002 / L0004 印的是最重的那句話 ——
「🔴 row 的 key 對不上 columns —— **整張表會是空的**」。

但這兩課實際餵進 `keypoints_to_structure_table`（就是 runtime 真的走的那條橋）
都畫得出內容。門描述的是同一個 commit（32fce2b4）**已經修掉**的舊症狀：
那個 commit 一邊在橋裡加了「欄名對不上就改用 row 自己的 key」的退路，
一邊把退路存在之前的症狀寫進門的判準裡。

判準錯的門比沒有門更糟：它會把好課判死，然後有人真的去改資料。

所以這裡鎖三件事：
  1. 兩種「對不上」但橋接得回來的形狀，門不可以說它是空表格
  2. 真的接不回來的形狀，門還是要抓到（負向對照 —— 防止「把檢查刪掉讓門變綠」）
  3. 橋本身確實畫得出內容（行為錨點，門的判準最終要對到這件事）
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import yaml
from _module_files import module_file, module_files

ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

from keypoints_shape_gate import LEGACY, check  # noqa: E402

from app.services.keypoints_to_structure import keypoints_to_structure_table  # noqa: E402

EMPTY_CLAIM = "整張表會是空的"


def _content_rows(table):
    """真的畫得出東西的列（單元素的那列是標題，不算內容）。"""
    return [r for r in (table or []) if len(r) > 1 and any(str(c).strip() for c in r)]


def _bridge(uid: str):
    src = module_file(ROOT / "backend/data/lessons" / uid / "v3", "keypoints")
    return keypoints_to_structure_table(yaml.safe_load(src.read_text(encoding="utf-8")))


def _findings(uid: str, root: Path | None = None) -> list[str]:
    return [f.text for f in (check(uid, root) if root else check(uid))]


def _empty_claims(uid: str, root: Path | None = None) -> list[str]:
    return [t for t in _findings(uid, root) if EMPTY_CLAIM in t]


# ── 1. 門不可以把接得回來的形狀說成空表格 ────────────────────────────────────

def test_label_shape_with_display_columns_is_not_an_empty_table():
    """L0002：row 用 label/value（第一版形狀），`columns` 只是印在表頭的欄名。

    橋是照「有沒有 label」分流的，不是照 columns —— 有 label 就走 label 那條，
    columns 從頭到尾不參與取值。拿 columns 去比對 row 的 key 是問錯問題。
    """
    assert _content_rows(_bridge("L0002")), "前提不成立：L0002 本來就畫不出東西"
    assert _empty_claims("L0002") == [], (
        "L0002 畫得出三列內容，門卻說它是空表格 —— 判準錯了，不是資料錯了"
    )


def test_mismatched_keys_that_the_bridge_recovers_is_not_an_empty_table():
    """L0004：columns 是中文、row 的 key 是英文，確實對不上。

    但橋在 `_columns_to_structure_table` 裡就有這條退路（註解直接點名 L0004）：
    對不上就改用 row 自己的 key 照原序取值，欄名仍用 columns 顯示。
    """
    assert _content_rows(_bridge("L0004")), "前提不成立：L0004 本來就畫不出東西"
    assert _empty_claims("L0004") == [], (
        "L0004 的欄名對不上，但橋有退路且畫得出六列 —— 門描述的是已經修掉的舊症狀"
    )


# ── 2. 負向對照：真的空的還是要抓到 ──────────────────────────────────────────

def _write(root: Path, uid: str, keypoints: dict) -> None:
    d = root / uid / "v3"
    d.mkdir(parents=True)
    (d / "keypoints.yml").write_text(
        yaml.safe_dump({"keypoints": keypoints}, allow_unicode=True), encoding="utf-8")


def test_a_table_that_really_renders_empty_is_still_flagged(tmp_path):
    """欄名對不上、而且 row 只有一個可用的 key —— 退路要求至少兩個，接不回來。

    這一筆是負向對照：如果哪天有人為了讓門變綠把整條檢查刪掉，這條會紅。
    """
    kp = {"title": "T", "columns": ["段落", "事件", "感受"],
          "rows": [{"paragraph": "二"}, {"paragraph": "三"}]}
    _write(tmp_path, "L9001", kp)

    # 先確認它真的畫不出東西，再要求門抓到 —— 順序不能反過來
    assert _content_rows(keypoints_to_structure_table({"keypoints": kp})) == [], \
        "負向對照本身失效：這筆其實畫得出東西"
    assert _empty_claims("L9001", tmp_path), "真的會空掉的表，門必須抓到"


def test_matrix_layout_with_mismatched_keys_has_no_blank_rows(tmp_path):
    """逐列檢查也不可以拿欄名去查值。

    L0004 現在沒有 `layout`，所以逐列檢查走的是「看 row 自己的 key」那條，僥倖沒踩到。
    一旦有人照第 1 項的建議把 `layout: matrix` 補上去，欄名查值就會全部落空 ——
    每一列都被印成「畫不出任何內容」，而那張表其實好好的。
    """
    kp = {"layout": "matrix", "columns": ["段落", "事件", "感受"],
          "rows": [{"paragraph": "二", "event": "E1", "feeling": "F1"},
                   {"paragraph": "三", "event": "E2", "feeling": "F2"}]}
    _write(tmp_path, "L9003", kp)

    assert _content_rows(keypoints_to_structure_table({"keypoints": kp})), \
        "前提不成立：這筆本來就畫不出東西"
    blanks = [t for t in _findings("L9003", tmp_path) if "畫不出任何內容" in t]
    assert blanks == [], f"欄名對不上就改看 row 自己的 key，這幾列不是空的：{blanks}"


def test_matching_keys_are_never_flagged(tmp_path):
    """正向對照：欄名對得上的一般情況，門不吭聲（確認檢查不是恆真）。"""
    kp = {"columns": ["段落", "事件"], "rows": [{"段落": "二", "事件": "E"}]}
    _write(tmp_path, "L9002", kp)
    assert _empty_claims("L9002", tmp_path) == []


# ── 3. 行為錨點 + 正向對照 ───────────────────────────────────────────────────

def test_L0017_is_the_positive_control_for_L0004():
    """L0017 跟 L0004 的 `columns` 一字不差（段落／事件／感受），差別只在
    row 的 key 是中文（對得上）還是英文（對不上）—— 剛好是門用來判死的那個維度。

    兩課都畫得出內容 ⇒ 那個維度不能預測「表會不會空」。
    """
    # ⚠️ #2916 之後檔名是 `keypoints.{slug}.yml`（一課多篇會有好幾份）。
    #    寫死 `keypoints.yml` 直接 FileNotFoundError。
    def _kp(uid: str) -> dict:
        d = ROOT / "backend/data/lessons" / uid / "v3"
        f = next((c for c in [d / "keypoints.yml", *sorted(d.glob("keypoints.*.yml"))]
                  if c.is_file()), None)
        assert f is not None, f"{uid} 沒有任何 keypoints yml —— 對照組前提變了"
        return yaml.safe_load(f.read_text(encoding="utf-8"))["keypoints"]

    a = _kp("L0017")
    b = _kp("L0004")
    assert a["columns"] == b["columns"] == ["段落", "事件", "感受"], "對照組前提變了"

    assert _empty_claims("L0017") == [], "正向對照本身就被門判死，對照不成立"
    assert len(_content_rows(_bridge("L0017"))) >= 4
    assert len(_content_rows(_bridge("L0004"))) >= 4, (
        "同樣的欄名，key 對不上的那一課一樣畫得出內容"
    )


# ── 4. 預設模式：不可以恆紅，也不可以恆綠 ────────────────────────────────────
#
# 一道預設恆紅的門會被訓練成無視 —— 這批 19 條就是這樣被當成待解問題掛了一整天，
# 真正的原因只是叫的時候漏了 `--legacy-ok`。但把預設放寬成「LEGACY 什麼都不算數」
# 又會走到另一個極端：舊課哪天真的變成空表格也沒人知道。
#
# 所以預設放行的只有**訂規格之前的寫法問題**（缺 layout 這種慣例），
# 行為問題（表真的畫不出東西）**任何課都擋**。

GATE = ROOT / "scripts/keypoints_shape_gate.py"


def _cli(*args: str) -> subprocess.CompletedProcess:
    """跑真的 CLI 拿真的 exit code。

    ⚠️ 不可以用 `... | tail` 取輸出再判斷成敗 —— 管線回的是**最後一段**的 exit code，
    `tail` 永遠 exit 0，真正的 1 會被吃掉，於是靜默放行。
    """
    return subprocess.run([sys.executable, str(GATE), *args],
                          capture_output=True, text=True)


def test_default_mode_is_green_on_the_real_corpus():
    r = _cli("--all")
    assert r.returncode == 0, f"預設模式恆紅 = 會被訓練成無視\n{r.stdout}{r.stderr}"
    assert "KEYPOINTS_SHAPE_GATE=PASS" in r.stdout


def test_strict_mode_still_shows_the_legacy_backlog():
    """特赦不是遺忘：`--strict` 要看得到還欠 layout 的課。

    ⚠️ 2026-08-28（#2964）改寫。原本斷言 `returncode == 1`（strict 必須紅）——
    那是把「欠款還在」寫死成通過條件。**欠款還完之後這條反而變紅**，
    而它的紅讀起來像「機制壞了」，實際上是好消息。

    棘輪只能往一個方向收：欠款可以清零，但不准長回來。
      · strict 綠 → 欠款清完了（現在就是這樣）
      · strict 紅 → 還有欠，那就必須把它列出來（不可以紅得不說原因）
    """
    r = _cli("--all", "--strict")
    if r.returncode == 0:
        assert "KEYPOINTS_SHAPE_GATE=PASS" in r.stdout, (
            f"strict 回 0 卻沒有印 PASS —— 是不是根本沒跑\n{r.stdout}{r.stderr}")
        return
    assert "缺 layout" in r.stdout, (
        "strict 紅了卻沒有說哪一課缺 layout —— "
        f"紅得不說原因的門會被關掉\n{r.stdout}{r.stderr}")


def test_strict_mode_is_actually_stricter():
    """正向對照：`--strict` 不可以只是 `--all` 的別名。

    少了這條，把 strict 改成什麼都不檢查也會讓上面那條綠。
    """
    import inspect
    src = GATE.read_text(encoding="utf-8")
    assert "--strict" in src, "gate 根本沒有 --strict 這個旗標"
    assert "缺 layout" in src, "gate 裡找不到 strict 要報的那個訊息"


def test_legacy_ok_stays_accepted():
    """HANDOFF.md 記的正規叫法帶著 `--legacy-ok`。預設變寬之後它成為 no-op，
    但**必須繼續收**，否則既有文件與 SOP 一叫就 argparse error。"""
    r = _cli("--all", "--legacy-ok")
    assert r.returncode == 0, f"既有叫法壞掉了：\n{r.stdout}{r.stderr}"


def test_default_mode_still_fails_a_non_legacy_defect(tmp_path):
    """負向對照：放寬預設不可以把門變成擺設。"""
    _write(tmp_path, "L9004", {"layout": "matrix", "columns": ["段落", "事件"],
                               "rows": [{"paragraph": "二"}]})
    r = _cli("--all", "--lessons-root", str(tmp_path))
    assert r.returncode == 1, f"新課真的畫不出表，預設模式卻放行：\n{r.stdout}"
    assert EMPTY_CLAIM in r.stdout


def test_legacy_does_not_excuse_a_table_that_renders_nothing(tmp_path):
    """特赦只赦免「訂規格之前的寫法」，不赦免「表是空的」。

    L0002 在 LEGACY 名單上。就算是它，真的變成空表格也要擋 ——
    不然這份名單會變成 19 課的永久免死金牌。
    """
    _write(tmp_path, "L0002", {"layout": "matrix", "columns": ["段落", "事件"],
                               "rows": [{"paragraph": "二"}]})
    r = _cli("--all", "--lessons-root", str(tmp_path))
    assert r.returncode == 1, f"LEGACY 課的空表格被特赦掉了：\n{r.stdout}"


def test_a_new_lesson_missing_layout_is_still_blocked(tmp_path):
    """LEGACY 是一份封閉名單（只會變短不會變長）。

    名單外的新課少了 `layout` 一樣要擋 —— 不然特赦就從「那 19 課」擴散成
    「所有課的 layout 都可有可無」，規格等於沒訂。
    """
    _write(tmp_path, "L9005", {"columns": ["段落", "事件"],
                               "rows": [{"段落": "二", "事件": "E"}]})
    assert "L9005" not in LEGACY, "對照前提變了：這個 uid 不該在特赦名單上"
    r = _cli("--all", "--lessons-root", str(tmp_path))
    assert r.returncode == 1, f"新課缺 layout 被當成舊課特赦了：\n{r.stdout}"


def test_legacy_shape_findings_are_only_warnings_by_default(tmp_path):
    """正向對照：LEGACY 課只缺 layout（表畫得出來）→ 預設只警告不擋。"""
    _write(tmp_path, "L0002", {"columns": ["段落", "事件"],
                               "rows": [{"段落": "二", "事件": "E"}]})
    r = _cli("--all", "--lessons-root", str(tmp_path))
    assert r.returncode == 0, f"這才是該被特赦的那種：\n{r.stdout}"
    assert "缺 layout" in r.stdout and "⚠️" in r.stdout
