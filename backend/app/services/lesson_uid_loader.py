"""lesson_uid_loader.py — Phase 3 of the second-edition re-ink (#2692).

Reads the uid tree written by `scripts/build_lesson_uid_tree.py`:

    backend/data/lessons/<lesson_uid>/<version_id>/
        lesson.yml   spotlight.yml   keypoints.yml   assets/

WHY IDENTITY IS THE DIRECTORY NAME
----------------------------------
The loader this replaced merged two historical layers (`L*.yml` hand-built 2026-02,
`_parsed_2026-05-01/` batch-parsed 2026-05) on the lesson TITLE. That join is the
root defect the second-edition re-ink existed to remove: a title differing by one
punctuation mark left the row an empty shell, silently, and 26 lessons were
duplicated across the two layers. Both layers are now deleted.

Identity is the directory name and nothing else. It is never derived from a title
or a lesson code — those are properties, and both change between editions.
"""

from __future__ import annotations

import functools
from pathlib import Path
from typing import Any, Optional

import yaml

# backend/app/services/ → backend/
_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
LESSONS_ROOT = _BACKEND_ROOT / "data" / "lessons"

# 一個大題一個模組。舊結構把語詞我最棒／閱讀理解／知識補給站三個大題擠進
# `sections`，而語詞應用、詞語複習連檔案都沒有 —— 抽取器抽不到那兩節，不只是
# 規則寫錯，是連放的地方都沒有。`sections` 留著讀舊版本（v2）。
#
# 文言文的大題集合跟白話課完全不同（文白句子比對／文白詞語比對／自我挑戰，
# 且導讀・古文今譯・原文沒有大題編號），所以那幾個模組也列在這裡；
# 缺檔的課直接跳過，不會因為多列而報錯。
#: 課級模組 —— 一課一份，檔名**沒有 slug**（`metadata.yml`，不是 `metadata.xxxxx.yml`）。
#: 大題模組一課可以有好幾份（一課多篇），所以帶 slug；課級的不會。
COURSE_LEVEL_MODULES = ("metadata", "errata")

MODULES = (
    # 課級
    "metadata",
    "errata",
    # 白話課大題
    "full_text_annotate",   # 一 讀全文-做記號
    "key_reading",          # 二 念順順
    "vocab_definitions",    # 三 語詞我最棒
    "vocab_application",    # 四 語詞應用
    "keypoints",            # 五 文章重點表
    "spotlight",            # 六 閱讀聚光燈
    "comprehension",        # 七 閱讀理解
    "vocab_review",         # 八 詞語複習
    "resources",            # 九 知識補給站
    # 文言文專屬
    "intro_guide",
    "modern_translation",
    "classical_text",
    "sentence_matching",
    "word_matching",
    "self_challenge",
    # 一般課也有的無編號元素 (#2752 Phase 2) — 目標策略框（70 課）與讀前自我
    # 檢核（58 課），兩者都印在「一 讀全文-做記號」之前，不掛在任何大題編號下。
    "goal_box",
    "self_check_before_reading",
    # 多文本合讀課 + 收尾書寫練習 (#2752 Phase 3)。
    "multi_text_parts",             # 第 2/3 篇（第 1 篇在 full_text_annotate）
    "cross_text_banner",            # 「跨課文習作／三篇合讀」過場字
    "keypoints_followup_questions", # 第一篇專屬追問（兩種形狀，見檔頭 schema_gap）
    "writing_practice",             # 語詞書寫練習／難字挑戰（多為大題九）
)

# ⛔ 不留 v2 的 `sections` / `body` 相容入口。
#
# #2683 刪掉兩個歷史 layer 時寫得很清楚：「both layers are deleted rather than kept
# behind a flag — a compatibility path would have preserved exactly the [problem]」。
# 同一個道理在這裡成立：留著讀舊檔名，會讓一棵只翻新了一部分的樹看起來很健康。
#
# 代價是明擺著的：還沒重抽的課會少掉那幾個大題。那不是要藏起來的事，是要數出來的事
# —— 翻新已完成（175/175 走 v3），原本數這件事的 module_migration_gate 已於 #2843 淘汰。


def _is_uid_dir(p: Path) -> bool:
    """A uid dir is `L####` holding at least one `v*` version dir."""
    return (
        p.is_dir()
        and len(p.name) == 5
        and p.name[0] == "L"
        and p.name[1:].isdigit()
        and any(c.is_dir() and c.name.startswith("v") for c in p.iterdir())
    )


def _latest_version(uid_dir: Path) -> Optional[Path]:
    versions = sorted(
        (c for c in uid_dir.iterdir() if c.is_dir() and c.name.startswith("v")),
        key=lambda c: c.name,
    )
    return versions[-1] if versions else None


def _read_yaml(p: Path) -> Any:
    try:
        return yaml.safe_load(p.read_text(encoding="utf-8"))
    except Exception:
        return None


def _drop_assetless_table_figures(spotlight_doc: Any) -> None:
    """Remove figure blocks that point at a table and carry no image (#2455/#2463).

    `{"type": "figure", "referent": "table", "asset": null}` has nothing to render:
    the referent names a table's JSON, which is not an image. The frontend already
    skips them, so today they are invisible rather than broken — but they were only
    ever an extractor artefact, and `inject_per_practice_figures` puts them back
    every time the corpus is rebuilt. 89 of 143 lessons carry them after the
    second-edition rebuild.

    Dropping them here rather than leaning on the frontend guard means anything else
    that reads a spotlight — the eval gates, a future renderer, an export — sees the
    same block list the student does, instead of each consumer needing to know about
    a block type that renders to nothing. Only the assetless ones go: a figure with a
    real asset is a real figure whatever its referent says.
    """
    if not isinstance(spotlight_doc, dict):
        return
    inner = spotlight_doc.get("spotlight")
    target = inner if isinstance(inner, dict) else spotlight_doc
    blocks = target.get("blocks")
    if not isinstance(blocks, list):
        return
    target["blocks"] = [
        b for b in blocks
        if not (
            isinstance(b, dict)
            and b.get("type") == "figure"
            and b.get("referent") == "table"
            and not b.get("asset")
        )
    ]


@functools.lru_cache(maxsize=1)
def available_uids() -> tuple[str, ...]:
    """Every lesson_uid that has at least one version on disk."""
    if not LESSONS_ROOT.exists():
        return ()
    return tuple(sorted(p.name for p in LESSONS_ROOT.iterdir() if _is_uid_dir(p)))


@functools.lru_cache(maxsize=None)
def load_lesson(uid: str, version: Optional[str] = None) -> Optional[dict]:
    """Return the merged lesson dict for a uid, or None.

    `version=None` takes the highest version directory. Fail-closed: a missing
    `lesson.yml` means the directory is half-written and is treated as absent
    rather than served empty.
    """
    uid_dir = LESSONS_ROOT / uid
    if not uid_dir.is_dir():
        return None
    vdir = (uid_dir / version) if version else _latest_version(uid_dir)
    if not vdir or not vdir.is_dir():
        return None

    meta = _read_yaml(vdir / "lesson.yml")
    if not isinstance(meta, dict) or not meta.get("lesson_uid"):
        return None

    lesson: dict[str, Any] = dict(meta)
    lesson["version_id"] = vdir.name
    # 每一份模組檔都有自己的 slug，檔名一律 `{模組}.{slug}.yml`（#2916）——
    # 沒有「有 slug／沒 slug」兩種分支了。同一個模組出現多次（一課多篇）時，
    # 就是多個檔，順序由帳本決定，這裡只負責把第一個放到頂層當預設。
    by_mod: dict[str, list[pathlib.Path]] = {}
    for f in sorted(vdir.glob("*.*.yml")):
        m = f.stem.partition(".")[0]
        if m in MODULES:
            by_mod.setdefault(m, []).append(f)

    # ⛔ 上面那個 glob 要兩個點（`{模組}.{slug}.yml`），而**課級的檔沒有 slug**
    #    —— `metadata.yml` / `errata.yml` 只有一個點，從此配不到。
    #
    #    後果不是「少一個欄位」：_meta(l) 回空 dict，於是 intro 永遠 None，
    #    **175 課的課程簡介整頁空白**，而 174 份 metadata.yml 一直好好躺在磁碟上。
    #    那正是 #2736 修過一次的症狀，換一個機制回來（#2964 抓到）。
    #
    #    只對課級模組補回無 slug 的檔名 —— 不對大題模組開，
    #    否則會把二修前遺留的 `{模組}.yml` 復活成頂層預設。
    for m in COURSE_LEVEL_MODULES:
        f = vdir / f"{m}.yml"
        if m in MODULES and f.exists():
            by_mod.setdefault(m, []).append(f)

    # 帳本決定「哪一份是頂層的預設」——⛔ 不要用檔名排序，slug 是不透明亂碼。
    man_pre = _read_yaml(vdir / "_manifest.yml")
    ledger_files = [s.get("file") for s in ((man_pre or {}).get("sections") or []) if s.get("file")]
    for m, fs in by_mod.items():
        fs.sort(key=lambda f: ledger_files.index(f.name) if f.name in ledger_files else 10**6)

    for mod in MODULES:
        files = by_mod.get(mod) or []
        if not files:
            continue
        data = _read_yaml(files[0])
        if not data:
            continue
        if mod == "spotlight":
            _drop_assetless_table_figures(data)
        # v3 的模組檔外層是 `{lesson_uid, version_id, section_no, <mod>: {…}}`。
        # 存包裝而不是內容，會讓每個消費端都要多剝一層 —— 而漏剝的那個不會報錯，
        # 只是欄位查不到（`key_reading.passage` 就是這樣被判定成缺 passage 而整節丟掉）。
        if isinstance(data, dict) and mod in data:
            inner = data[mod]
            if isinstance(inner, (dict, list)):
                if isinstance(inner, dict):
                    inner = {
                        **{k: v for k, v in data.items() if k in ("section_no",)},
                        **inner,
                    }
                lesson[mod] = inner
                continue
        lesson[mod] = data
    # 念順順 carries two things that fail independently: the passage a student reads
    # aloud, and the characters-per-minute target they read it against. #2722 gave the
    # eleven lessons whose passage is withheld a file holding only the target — correct
    # for the index, which gates on `passage`, and a 500 for the detail route, which
    # reads THIS dict and hands `key_reading` straight to a schema whose `passage` is a
    # required str.
    #
    # Split here rather than in either consumer, because both read this function and
    # only one of them was applying the gate.
    kr = lesson.get("key_reading")
    if isinstance(kr, dict):
        if kr.get("reading_benchmark") and not lesson.get("reading_benchmark"):
            lesson["reading_benchmark"] = kr["reading_benchmark"]
        if not kr.get("passage"):
            lesson.pop("key_reading")

    # 重複出現的大題（#2916）。有些學習單把同一個大題印好幾次 —— 一份多篇文章的課，
    # 每一輪都有自己的讀全文、念順順、語詞…。沿用「一個模組一份 yml」的慣例，
    # 第二輪以後的檔名帶 slug：`key_reading.m7qxv.yml`。同一個 slug ＝ 同一輪。
    #
    # ⚠️ 沒有這一段的話，那些檔案**在硬碟上但沒有人看得到** —— 上面的 MODULES 迴圈
    #    只讀 `{mod}.yml`，多出來的檔會被靜默忽略（2026-08-24 dry run 實測）。
    #    單篇課的檔名沒有 slug，所以完全不受影響。
    # 總帳（#2843/#2916）—— 這一課有哪些大題、照學習單的順序、各自要載哪一份檔。
    # 一課多篇時，同一個大題會出現多次，每一列的 `file` 直接寫明是哪一份
    # （`key_reading.fqwda.yml` / `key_reading.n3qxn.yml`），消費端不必懂 slug 規則。
    man = _read_yaml(vdir / "_manifest.yml")
    if isinstance(man, dict) and man.get("sections"):
        lesson["manifest_sections"] = man["sections"]

    # 「一輪」＝ text_ref 指向同一篇課文的那些大題（#2916）。
    # slug 現在是**每個大題自己的身分**，所以不能再拿它當分組的 key ——
    # 分組要看它指向誰（text_ref），課文自己則用自己的 slug 當這一輪的 key。
    repeats: dict[str, dict[str, Any]] = {}
    for path in sorted(vdir.glob("*.*.yml")):
        mod, _, own = path.stem.partition(".")
        if mod not in MODULES or not own:
            continue
        _probe = _read_yaml(path) or {}
        _body = _probe.get(mod) if isinstance(_probe.get(mod), dict) else _probe
        _ref = (_body or {}).get("text_ref")
        if mod == "full_text_annotate":
            slug = own
        elif isinstance(_ref, str):
            slug = _ref
        else:
            continue          # 跨篇的（text_ref 是清單）不屬於任何單一輪
        data = _read_yaml(path)
        if not data:
            continue
        if mod == "spotlight":
            _drop_assetless_table_figures(data)
        if isinstance(data, dict) and mod in data:
            inner = data[mod]
            if isinstance(inner, dict):
                inner = {
                    **{k: v for k, v in data.items() if k in ("section_no",)},
                    **inner,
                }
            data = inner
        repeats.setdefault(slug, {})[mod] = data
    # 只有**真的多輪**才給 repeat_rounds。單篇課只有一輪，給了會讓 175 課
    # 的下游行為全部改變（念順順會變成兩筆、清單會多一個欄位）。
    if len(repeats) > 1:
        # 形狀：{slug: {module: payload}}。消費端拿 `?p=<slug>` 就取那一輪的全部模組。
        lesson["repeat_rounds"] = repeats

        # 某個模組**只**存在於帶 slug 的檔裡時（例如 L0010 的兩封信各自成檔、
        # 沒有合併版的 full_text_annotate.yml），要在這裡合成一份頂層的。
        #
        # ⚠️ 少了這一段的後果實測過：L0010 的 `paragraphs` 變成 0 段 —— 學生看到
        #    空白課文，而且**朗讀一句都對不到**。音檔本身是用 sha256(句子) 定址的、
        #    不會失效，但 `/api/tts/mapping/{id}` 是從 `lesson["paragraphs"]` 建的，
        #    那個陣列空了就沒有任何句子可以對。
        #
        # 順序用段落自己的 `seq`（整課連續段號）決定，**不是**檔名排序 ——
        # slug 是不透明亂碼，字母序跟課文順序沒有任何關係。
        # 🔴 順序的唯一真相是**總帳**（`_manifest.yml`），不是這裡自己排。
        #
        # 之前這裡按 `seq`／檔名排，結果 L0063 的段落只有 `idx` 沒有 `seq`，
        # 三輪拿到同一個排序值 → 退回檔名字母序（4uee3, 7wavn, p3kud）
        # ＝ 篇2、篇3、篇1。學生打開課文第一段看到的是第23課不是第22課，
        # 而且沒有任何錯誤或紅燈（2026-08-25 真瀏覽器實測抓到）。
        #
        # 帳本已經照學習單的順序列好每一列要載哪一份檔，照它走就不會有第二套順序。
        order: dict[str, list[str]] = {}
        for sec in lesson.get("manifest_sections") or []:
            f = sec.get("file")
            if not f:
                continue
            mod_name, _, rest = f.partition(".")
            slug_name = rest[:-4] if rest.endswith(".yml") else rest
            if slug_name and slug_name != "yml":
                order.setdefault(mod_name, [])
                if slug_name not in order[mod_name]:
                    order[mod_name].append(slug_name)

        for mod in MODULES:
            # ⚠️ 條件是「這個模組有多份檔」，不是「頂層還沒有」——
            #    頂層現在一定有（照帳本挑第一份），所以用舊條件會整段跳過，
            #    L0063 的課文就只剩篇1 的 7 段（實測）。
            if len(by_mod.get(mod) or []) < 2:
                continue
            seq = order.get(mod) or sorted(repeats)
            rounds = [(sl, repeats[sl][mod]) for sl in seq
                      if sl in repeats and isinstance(repeats[sl].get(mod), dict)]
            if len(rounds) < 2:
                continue
            merged = dict(rounds[0][1])
            paras: list = []
            for _slug, payload in rounds:
                paras.extend(payload.get("paragraphs")
                             or (payload.get("body") or {}).get("paragraphs") or [])
            if not paras:
                # 沒有段落的模組（文章重點整理／聚光燈／語詞…）沒有東西可以串接，
                # 但**頂層還是要有一份**，否則那一課在服務端等於少了一整個大題。
                #
                # 🔴 2026-08-25 實測：少了這一段，L0029 / L0063 / L0144 的
                #    keypoints 與 L0111 的 spotlight 全部消失，
                #    `test_keypoints_manifest_spec` 直接報「in manifest but no
                #    served lesson has that code」。
                #
                # 取帳本的第一輪當頂層（既有消費端看到的跟拆之前一樣），
                # 每一輪各自的內容仍然在 `repeat_rounds` 裡，
                # 前台照帶篇次的步驟去拿自己那一輪。
                lesson[mod] = dict(rounds[0][1])
                lesson[mod]["from_round"] = rounds[0][0]
                continue
            merged["paragraphs"] = paras
            merged["paragraph_count"] = len(paras)
            merged["assembled_from_rounds"] = [sl for sl, _ in rounds]
            for k in ("letters", "inline_marked_terms"):
                if any(k in payload for _s, payload in rounds):
                    out: list = []
                    for _s, payload in rounds:
                        out.extend(payload.get(k) or [])
                    merged[k] = out
            lesson[mod] = merged

    assets = vdir / "assets"
    lesson["assets"] = (
        sorted(p.name for p in assets.iterdir() if p.is_file()) if assets.is_dir() else []
    )
    return lesson


def load_all() -> list[dict]:
    """Every lesson in the tree, latest version each. Skips half-written dirs."""
    out = []
    for uid in available_uids():
        lesson = load_lesson(uid)
        if lesson:
            out.append(lesson)
    return out


def reset_cache() -> None:
    """Test-only: the caches are import-time singletons in production."""
    available_uids.cache_clear()
    load_lesson.cache_clear()
