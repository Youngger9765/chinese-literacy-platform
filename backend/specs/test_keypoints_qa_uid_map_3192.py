"""重點表 QA 看板的課號對照表要跟現行課程一致（#3192）。

為什麼
------
看板的 `lessons-data.js` 是 2026-05-01 的凍結快照，它的 `story_id`（1001…）與
`lesson_code`（G4-L1…）用的是**當時的課程編號**。二修重抽之後：

  · 服務端 id 變成 `20000 + int(uid[1:])`（20001–20179）
  · 課號整個重排 —— 看板的 G4-L2 是「十秒的背後」，現行的 G4-L2 是「正太與小豬」

⇒ 舊 id 讓看板**兩邊都死**：右欄 iframe 每一課 `fetchStory failed: 404`，
  左欄原稿連結每一課 404。修法是一張由標題產生、可稽核的對照表。

這條鎖守的是「對照表不會悄悄過期」—— 課程再改名一次，它就紅，
而不是等到有人打開看板才發現右欄又空了。
"""
from __future__ import annotations

import importlib.util
import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
GEN = REPO / "scripts" / "build_keypoints_qa_uid_map.py"
MAP_JS = REPO / "frontend" / "public" / "keypoints-qa" / "lesson-uid-map.js"
BOARD_JS = REPO / "frontend" / "public" / "keypoints-qa" / "app.js"
INDEX = REPO / "frontend" / "public" / "keypoints-qa" / "index.html"
LESSONS = REPO / "backend" / "data" / "lessons"


def _gen():
    spec = importlib.util.spec_from_file_location("kpqa_uidmap", GEN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def _table() -> dict[str, dict]:
    m = re.search(r"window\.LESSON_CATALOG_BY_CODE\s*=\s*(\{.*?\});", MAP_JS.read_text("utf-8"), re.S)
    assert m, "lesson-uid-map.js 讀不到 LESSON_CATALOG_BY_CODE"
    return json.loads(m.group(1))


def _committed() -> dict[str, str]:
    """只取有對到課的那些（課號 → uid）。"""
    return {c: e["uid"] for c, e in _table().items() if e.get("uid")}


def test_the_pieces_are_all_there() -> None:
    """對照組：任何一個檔被搬走，底下每一條都會變成空斷言。"""
    for p in (GEN, MAP_JS, BOARD_JS, INDEX):
        assert p.is_file(), f"少了 {p.relative_to(REPO)}"
    assert len(list(LESSONS.glob("L*/v3/lesson.yml"))) > 100, "課文目錄看起來不對"


def test_committed_map_matches_current_curriculum() -> None:
    """重跑產生器，結果必須跟進版的那份一字不差。"""
    mod = _gen()
    mapping, problems = mod.build()
    assert not problems, "對照表建不起來（課程動過？）：\n  " + "\n  ".join(problems)
    assert mod.render(mapping) == MAP_JS.read_text("utf-8"), (
        "lesson-uid-map.js 與現行課程對不上 —— 課程改名或改編號了。\n"
        "→ 重跑 `python3 scripts/build_keypoints_qa_uid_map.py`，"
        "自動對不上的課會被要求加進 OVERRIDES（附理由）。"
    )


def test_every_mapped_uid_is_a_real_lesson() -> None:
    """對照表不可以指向不存在的課 —— 那又會變成一顆按下去 404 的鈕（#2845）。"""
    on_disk = {p.parts[-3] for p in LESSONS.glob("L*/v3/lesson.yml")}
    bad = {c: u for c, u in _committed().items() if u not in on_disk}
    assert not bad, f"對照表指向不存在的課：{bad}"


def test_mapped_lesson_titles_actually_agree() -> None:
    """正向對照：對到的那一課，標題要真的是同一篇。

    少了這條，一張「每個 uid 都存在但全部指錯課」的表也會全綠。
    """
    mod = _gen()
    titles = mod.read_lessons()
    board = dict(mod.read_board())
    overridden = set(mod.OVERRIDES)
    checked = 0
    for code, uid in _committed().items():
        if code in overridden:
            continue  # 改過名的那幾課，標題本來就不同（理由寫在 OVERRIDES）
        assert mod.norm_title(board[code]) == mod.norm_title(titles[uid]), (
            f"{code} 對到 {uid}，但標題不同：看板「{board[code]}」≠ 課文「{titles[uid]}」"
        )
        checked += 1
    assert checked > 100, f"只比對到 {checked} 課，這條鎖幾乎沒在守東西"


def test_the_board_does_not_derive_ids_from_story_id() -> None:
    """舊的 `story_id` 一律不可以拿來組線上網址或推 uid。"""
    # ⛔ 比對前先把註解剝掉。這個 repo 2026-09-17 一天三次被自家的門 regex 到註解，
    #    而這支測試的註解裡就寫著它要禁的那個字樣。
    def _strip_comment(ln: str) -> str:
        out, in_str, quote, esc = [], False, "", False
        for i, ch in enumerate(ln):
            if in_str:
                out.append(ch)
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == quote:
                    in_str = False
                continue
            if ch in "\"'`":
                in_str, quote = True, ch
                out.append(ch)
                continue
            if ch == "/" and ln[i + 1 : i + 2] == "/":
                break
            out.append(ch)
        return "".join(out)

    src = BOARD_JS.read_text("utf-8")
    offenders = [
        ln.strip()
        for ln in src.splitlines()
        if re.search(
            r"(learn/\$\{[^}]*story_id|/learn/\$\{L\.story_id|Number\(L\.story_id\))",
            _strip_comment(ln),
        )
    ]
    assert not offenders, (
        "看板又拿凍結快照的 story_id 當線上 id 了（那組 id 現行後端一律 404）：\n  "
        + "\n  ".join(offenders)
    )


def test_the_board_loads_the_map_before_app() -> None:
    html = INDEX.read_text("utf-8")
    i_map, i_app = html.find("lesson-uid-map.js"), html.find("app.js")
    assert i_map != -1, "index.html 沒有載入 lesson-uid-map.js"
    assert i_map < i_app, "lesson-uid-map.js 必須在 app.js 之前載入"


@pytest.mark.parametrize(
    "code,uid,why",
    [
        ("G4-L1", "L0011", "看板 G4-L1 贏得喝采的輸家 = 現行 L0011（不是 L0001）"),
        ("G4-L2", "L0001", "看板 G4-L2 十秒的背後 = 現行 L0001（現行 G4-L2 是別篇）"),
        ("G4-L7", "L0013", "同名 6 課，看板這筆是四年級"),
    ],
)
def test_known_pairs(code: str, uid: str, why: str) -> None:
    """三個親手查過的樣本 —— 對照表整個重算錯掉時，這幾條會先叫。"""
    assert _committed().get(code) == uid, why


# ─────────────────────────────────────────────────────────────────────
# 下面這幾條補的是複審指出的洞：原本 9 條測試對 `OVERRIDES` 完全沒有牙齒
# —— 把某一條 override 改指到「另一課真實存在但完全不相干的課」，9 條全綠。
# 而我唯一判錯的那一條（G7-L31 誤標下架）正好就是那個形狀。
# ─────────────────────────────────────────────────────────────────────

_DOCX_PREFIX = re.compile(r"^[\wＧ一-鿿]{1,3}[-‑]L\s*\d+(?:\s*[-~～]\s*\d+)?")


def _docx_core(fn: str | None) -> str | None:
    """原稿檔名剝到「這是哪一篇」——去課號前綴、策略註記、日期尾碼、標點。

    這是獨立於「標題」的第二訊號：`OVERRIDES` 是照標題查的，
    所以拿標題再驗一次等於自己驗自己。
    """
    if not fn:
        return None
    import unicodedata

    s = unicodedata.normalize("NFKC", fn)
    s = re.sub(r"[\U000E0100-\U000E01EF]", "", s).replace("台", "臺")
    s = _DOCX_PREFIX.sub("", s)
    s = re.sub(r"\.docx?$", "", s, flags=re.I)
    s = re.sub(r"[（(][^（()）]*[)）]\s*$", "", s)  # 尾端策略註記
    s = re.sub(r"(學生版|教師版|\d{4})$", "", s)
    s = re.sub(r"[\s　]+", "", s)
    return re.sub(r"[（）()「」『』《》\[\]【】,，、。.:：;；!！?？~〜\-－—─–_]+", "", s) or None


def test_every_override_is_corroborated_by_the_source_docx() -> None:
    """每一條指定 uid 的 override，都要有第二個訊號站在它那邊。

    少了這條，把 `G5-L8` 從 L0031 改成 L0032（真實存在、但完全不同的課）
    整套測試照樣全綠 —— 複審實測過。
    """
    import difflib

    mod = _gen()
    board_src = mod.read_board_sources()
    gcs = json.loads(
        (REPO / "backend" / "data" / "worksheets" / "gcs_mapping.json").read_text("utf-8")
    )["lessons"]
    cores: dict[str, set[str]] = {}
    for uid, e in gcs.items():
        c = {
            _docx_core((e.get(v) or {}).get("original_filename")) for v in ("teacher", "student")
        } - {None}
        if c:
            cores[uid] = c

    def sim(a: str, b: str) -> float:
        """順序不敏感的字集覆蓋 ∪ 逐字相似度，取大的那個。

        改名有兩種形狀：插字（奧運銀牌**背後**的…）逐字比得出來；
        換語序（見前人所未見—達爾文與長喙天蛾的故事 → 長喙天蛾見前人所未見）比不出來
        —— 後者逐字只有 0.44，字集覆蓋卻是滿的。
        """
        sa, sb = set(a), set(b)
        cover = len(sa & sb) / min(len(sa), len(sb)) if sa and sb else 0.0
        return max(cover, difflib.SequenceMatcher(None, a, b).ratio())

    def best(core: str, uid: str) -> float:
        return max(sim(core, h) for h in cores[uid])

    checked, unverifiable, retired = [], [], []
    for code, (uid, why) in mod.OVERRIDES.items():
        if uid is None:
            # 下架列沒有 uid 可佐證 —— 它們由 check_source_file_guard 守（見下一條測試）
            retired.append(code)
            continue
        if uid not in cores:
            unverifiable.append(code)
            continue
        raw = board_src.get(code, "")
        want = _docx_core(raw)
        # ⛔ 多文本合併列（「多文本-A+B+C」）不適用這個訊號：檔名是三篇標題串起來的，
        #    整串去比會被稀釋 —— G9-L17-19 真正對的 L0144(馬拉松王者)只有 0.30，
        #    而共用「馬拉松」三字的 L0035(寫信馬拉松)反而 0.44。
        #    這兩列改由標題鎖 + known_pairs + injectivity 守，這裡誠實跳過並計數。
        if not want or "多文本" in raw or "+" in raw:
            unverifiable.append(code)
            continue
        # ⛔ 不能要求字字相等 —— 改過名的那幾條本來就不等，那正是它們需要 override 的理由。
        #    要問的是：在全部 179 課裡，它是不是**唯一最像**的那一個。
        ranked = sorted(cores, key=lambda u: best(want, u), reverse=True)
        mine, top = best(want, uid), best(want, ranked[0])
        assert uid == ranked[0] or mine >= top - 1e-9, (
            f"{code} → {uid}（理由：{why}）不是最像的那一課：\n"
            f"  看板原稿核心：{want}（與 {uid} 相似度 {mine:.2f}）\n"
            f"  更像的是 {ranked[0]}：{sorted(cores[ranked[0]])}（{top:.2f}）"
        )
        assert mine > 0.75, f"{code} → {uid} 連最像都只有 {mine:.2f}，這個配對站不住"
        checked.append(code)
    assert len(checked) >= 10, f"只驗到 {checked}，這條幾乎沒在守東西（無法驗：{unverifiable}）"
    assert len(unverifiable) <= 3, f"跳過太多條就等於沒守：{unverifiable}"


def test_a_retired_row_never_shares_its_source_with_a_mapped_row() -> None:
    """標成下架的列，不可以跟已對到課的列共用同一份原稿 docx。

    純字串比對、零正規化 —— 沒有旋鈕就不會隨參數漂。
    這條就是抓 G7-L31 的那一條（它與 G7-L23 共用原稿，其實是同一課的第二篇）。
    """
    mod = _gen()
    mapping, _ = mod.build()
    assert not mod.check_source_file_guard(mapping)


def test_two_board_rows_may_share_a_uid_only_when_they_share_the_source() -> None:
    mod = _gen()
    mapping, _ = mod.build()
    assert not mod.check_injectivity(mapping)


def test_the_table_says_whether_each_lesson_still_has_a_keypoints_section() -> None:
    """「課文在」跟「有重點表」是兩件事，表裡要分得開。"""
    table = _table()
    for code, e in table.items():
        if not e.get("uid"):
            assert e["keypoints"] is False, f"{code} 沒有 uid 卻標成有重點表"
            continue
        on_disk = bool(list((LESSONS / e["uid"] / "v3").glob("keypoints.*.yml")))
        assert e["keypoints"] is on_disk, f"{code}→{e['uid']} 的 keypoints 標錯（磁碟上：{on_disk}）"
    # 正向對照：真的有一批是 False，否則這條等於在驗一個常數
    assert 0 < sum(1 for e in table.values() if e.get("uid") and not e["keypoints"]) < 40


def test_the_board_shows_the_right_state_for_every_lesson() -> None:
    """行為測試：在真的 JS 引擎裡跑看板的判斷式，逐課斷言三態。

    ⛔ 不用 regex 掃原始碼 —— 那種鎖用中間變數、字串相接、寫到 index.html 都繞得過，
       而且行尾註解提到舊寫法還會誤紅（這個 repo 9/17 才踩過三次）。
    """
    node = shutil.which("node")
    if not node:
        pytest.skip("沒有 node，跳過行為測試")
    board = MAP_JS.read_text("utf-8")
    app = BOARD_JS.read_text("utf-8")
    # 只取判斷式那幾支，不跑整個看板（它要 DOM）
    picked = []
    # ⚠️ `renderFrame` 一定要進來實跑 —— 它就是 #3192 漏改的那一支：判斷式自己長一個
    #    （`if (!L.story_id)`），跟 learnUrl 用的判準不同，而只驗 lessonState() 是綠的。
    for name in ("catalogEntry", "lessonUid", "liveStoryId", "lessonState", "learnUrl", "renderFrame"):
        m = re.search(rf"\n  function {name}\(.*?\n  \}}\n", app, re.S)
        assert m, f"抓不到 {name}()"
        picked.append(m.group(0))
    consts = re.search(r"\n  const ST_OK = .*?;\n", app, re.S)
    assert consts, "抓不到三態常數"
    texts = re.search(r"\n  const STATE_TEXT = \{.*?\n  \};\n", app, re.S)
    assert texts, "抓不到 STATE_TEXT（renderFrame 要用它組訊息）"
    script = (
        "globalThis.window=globalThis;\n"
        + board
        + consts.group(0).replace("const ", "var ")
        + texts.group(0).replace("const ", "var ")
        + "\n".join(picked)
        + """
// 讓 renderFrame() 真的跑起來：假的 DOM + 假的 lesson()
let CUR = null;
const NODES = {};
function mk(){ const inner={textContent:""};
  return {src:"",href:"",textContent:"",_cls:new Set(),
          classList:{add(c){this._o._cls.add(c)},remove(c){this._o._cls.delete(c)}},
          querySelector(){return inner}, _inner:inner}; }
for (const id of ["renderFrame","openFrame","frameHint","hintBase"]) {
  const n = mk(); n.classList._o = n; NODES[id] = n;
}
globalThis.$ = (id) => NODES[id] || mk();
globalThis.lesson = () => CUR;
globalThis.renderBase = () => "https://example.invalid";

const out = {ok:0,no_keypoints:0,gone:0,no_map:0,overlay_disagrees:[]};
for (const code of Object.keys(window.LESSON_CATALOG_BY_CODE)) {
  const st = lessonState({lesson_code:code});
  out[st]++;
  CUR = {lesson_code:code};
  NODES.frameHint._cls.clear();
  renderFrame();
  const shown = NODES.frameHint._cls.has("show");
  // 唯一的不變式：蓋住 iframe ⟺ 這一課不是「可比對」
  if (shown !== (st !== "ok")) out.overlay_disagrees.push([code, st, shown]);
}
// 對照表整個抽掉 → 必須是 no_map，而不是把每一課都宣告成已下架
const saved = window.LESSON_CATALOG_BY_CODE; delete window.LESSON_CATALOG_BY_CODE;
out.without_map = lessonState({lesson_code:'G4-L1'});
window.LESSON_CATALOG_BY_CODE = saved;
out.live_id_G4L1 = liveStoryId({lesson_code:'G4-L1'});
out.live_id_gone = liveStoryId({lesson_code:'G6-L4'});
console.log(JSON.stringify(out));
"""
    )
    tmp = REPO / "backend" / "specs" / ".kpqa_state_probe.mjs"
    try:
        tmp.write_text(script, encoding="utf-8")
        got = json.loads(subprocess.run([node, str(tmp)], capture_output=True, text=True,
                                        check=True).stdout.strip())
    finally:
        tmp.unlink(missing_ok=True)
    assert got["no_map"] == 0, "正常情況下不該有 no_map"
    assert got["ok"] > 100, f"可審的課太少：{got}"
    assert got["gone"] > 0 and got["no_keypoints"] > 0, f"三態要各有樣本才證明得了什麼：{got}"
    assert got["without_map"] == "no_map", (
        f"對照表載不到時看板說了 {got['without_map']} —— 那是在說謊，不是在報錯"
    )
    assert not got["overlay_disagrees"], (
        "遮罩的判準跟 lessonState 不一致 —— 有課對到了卻被蓋住、或該說明的卻留一格空白：\n"
        + "\n".join(f"  {c}: state={st} overlay={sh}" for c, st, sh in got["overlay_disagrees"][:12])
    )
    assert got["live_id_G4L1"] == 20011, got["live_id_G4L1"]
    assert got["live_id_gone"] is None, got["live_id_gone"]
