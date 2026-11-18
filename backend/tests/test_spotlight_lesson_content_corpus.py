"""Corpus-wide lock: what the API actually serves as ``lesson_content`` for 閱讀聚光燈.

Every lesson with a spotlight goes through the SAME path the story-detail route uses
(``lesson_content_loader.get_lesson_content``). For each lesson that is served:

  1. every student-visible string of the source worksheet appears in the output
     (checked from the SOURCE side, so a block the adapter forgot to walk shows up
     as missing text — not as a count that happens to match);
  2. every choice question's stored answer points at the option TEXT the source
     marks correct (computed here straight from the source keys / 1-based positions,
     not through the adapter's resolver);
  3. no option text is a bare key (the first-edition adapter iterated the options
     dict and showed students 「1」「2」 instead of the options).

And the number of served lessons may only go up (ratchet), while the lessons that
are withheld are withheld for a recorded reason.

Why this exists: until 2026-09 every one of 172 lessons served ``lesson_content: null``
(identity lived in `lesson_uid`, the adapter read `spotlight.lesson`), and once that was
fixed the adapter carried a median of 1 block per lesson against legacy's 13. Both were
invisible from the outside because the frontend quietly falls back to the legacy renderer.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import lesson_content_loader as L  # noqa: E402
from app.services import spotlight_to_lesson_content as A  # noqa: E402
from app.services.lesson_loader import get_all_lessons  # noqa: E402

# Ratchet: raise when more lessons become carriable; never lower it to get green.
MIN_SERVED = 172
MIN_LESSONS_WITH_SPOTLIGHT = 160
# 教師版有 ☑、但學習單寫明「沒有標準答案」而當成無標準答案的題數上限（目前實測值，見下方測試）
MAX_NO_ANSWER_OVERRIDES = 3  # L0004 小試身手第一張表的 3 題

# 反過來列：除了答案、抽取者註記、結構欄以外的字串，都是印在學習單上的字（欄位名不固定 ——
# content / tip / viewpoint / 中文欄名…，白名單一定會漏）。這份規則刻意不引用 adapter 的。
_ANSWER = {"answer", "answers", "answer_free_text", "answer_text", "result", "selected", "subject",
           "answer_label", "answer_chain", "student_filled"}
_META = re.compile(r"note|carrier|errata|source_text|_answers?$|blanks|teacher|circled|marker|_printed|"
                   r"layout|shape|placement|provenance|_ref$|^asset$|^referent$|bind|^id$|option_label|"
                   r"shows_sentences_from|^delete_|^type$|bold_spans|marked_time_words|^keywords_label$")


_ENUM = re.compile(r"^[\s□☐☑■✓✔]*(?:[①-⑳]|\(?[0-9A-Za-zㄅ-ㄩ]{1,2}[\.．、\)）])?[\s□☐☑■✓✔]*")


def _norm(s) -> str:
    if isinstance(s, float) and s.is_integer():
        s = int(s)
    return re.sub(r"\s+", "", str(s))


def _is_model_answer(node: dict) -> bool:
    return (bool(str(node.get("value") or "").strip()) and not node.get("blanks")
            and any(w in str(node.get("answer_carrier") or "") for w in ("橘色手寫", "示範答案")))


def _visible_strings(node, out: list) -> None:
    if isinstance(node, str):
        out.append(node)
        return
    if isinstance(node, list):
        for x in node:
            _visible_strings(x, out)
        return
    if not isinstance(node, dict):
        return
    for k, v in node.items():
        k = str(k)
        if k in _ANSWER or _META.search(k):
            continue
        if k == "explanation" and not node.get("prefilled"):
            continue
        if k == "value" and _is_model_answer(node):
            continue
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            if k in ("label", "sub_label", "title"):
                out.append(v)
            continue
        _visible_strings(v, out)


def _answer_only_strings(node, out: list) -> None:
    """Strings that exist only as answers (blanks, model answers, answer_text…)."""
    if isinstance(node, list):
        for x in node:
            _answer_only_strings(x, out)
        return
    if not isinstance(node, dict):
        return
    opts = node.get("options")
    keys = {str(k).strip().upper() for k in opts} if isinstance(opts, dict) else set()
    for k, v in node.items():
        k = str(k)
        if k in _ANSWER or k.endswith("_answer"):
            for a in v if isinstance(v, list) else [v]:
                if isinstance(a, str) and a.strip() and a.strip().upper() not in keys:
                    out.append(a)
        if (k == "blanks" or k.endswith("_blanks")) and isinstance(v, list):
            out.extend(b["answer"] for b in v if isinstance(b, dict) and isinstance(b.get("answer"), str))
        if k == "value" and _is_model_answer(node):
            out.append(v)
        if isinstance(v, (list, dict)):
            _answer_only_strings(v, out)


def _output_text(node, acc: list) -> None:
    if isinstance(node, str):
        acc.append(node)
    elif isinstance(node, dict):
        for v in node.values():
            _output_text(v, acc)
    elif isinstance(node, list):
        for v in node:
            _output_text(v, acc)


def _expected_option_texts(q: dict):
    """Correct option text(s) straight from the source: numeric answers count from 1,
    anything else names an option key. None = no machine-comparable answer."""
    opts = q.get("options")
    raw = q.get("answers") if q.get("answers") is not None else q.get("answer")
    if not isinstance(opts, (dict, list)) or raw is None or q.get("no_correct_answer"):
        return None
    vals = list(opts.values()) if isinstance(opts, dict) else list(opts)
    by_key = {str(k).strip().upper(): v for k, v in opts.items()} if isinstance(opts, dict) else {}
    out = []
    for a in raw if isinstance(raw, list) else [raw]:
        if isinstance(a, int) and not isinstance(a, bool):
            out.append(vals[a - 1])
        elif str(a).strip().upper() in by_key:
            out.append(by_key[str(a).strip().upper()])
        else:
            return None
    return sorted(_norm(x) for x in out)


def _source_questions(blocks: list) -> list[dict]:
    """Every choice question in the source, including fill_table rows and matching."""
    qs: list[dict] = []

    def walk(nodes):
        for q in nodes:
            if not isinstance(q, dict):
                continue
            if isinstance(q.get("options"), (dict, list)) and q.get("type") in ("single", "multi", None, "sub_block"):
                qs.append(q)
            if isinstance(q.get("items"), list):
                walk(q["items"])
            if q.get("type") == "fill_table" and isinstance(q.get("rows"), list):
                table_opts = q.get("options") if q.get("options") is not None else q.get("option_bank")
                for r in q["rows"]:
                    if not isinstance(r, dict):
                        continue
                    for k in r:
                        if k == "options" or str(k).endswith("_options"):
                            pre = "" if k == "options" else str(k)[: -len("options")]
                            qs.append({"options": r[k], "answer": r.get(pre + "answer"),
                                       "answers": r.get(pre + "answers")})
                    if table_opts is not None and not r.get("options") and r.get("answer") is not None:
                        qs.append({"options": table_opts, "answer": r["answer"]})
            if q.get("type") == "matching" and isinstance(q.get("answer"), dict):
                opts = {rk: f"{rk}. {rv}" for rk, rv in (q.get("right") or {}).items()}
                qs.extend({"options": opts, "answer": v if isinstance(v, list) else str(v)}
                          for v in q["answer"].values())  # 一個左項可以連到多個右項

    walk(blocks)
    return qs


@pytest.fixture(scope="module")
def corpus():
    L._reset_caches_for_test()
    lessons = [l for l in get_all_lessons() if isinstance(l.get("spotlight_v2"), dict) and l["spotlight_v2"]]
    served = {l["lesson_uid"]: (l, L.get_lesson_content(l)) for l in lessons}
    yield lessons, {u: v for u, v in served.items() if v[1] is not None}
    L._reset_caches_for_test()


def test_corpus_is_real_and_served_count_only_goes_up(corpus):
    lessons, served = corpus
    assert len(lessons) >= MIN_LESSONS_WITH_SPOTLIGHT, f"only {len(lessons)} lessons with a spotlight"
    assert len(served) >= MIN_SERVED, (
        f"{len(served)} lessons served lesson_content, ratchet is {MIN_SERVED}. A drop means a "
        "change made previously carriable lessons fall back to the legacy renderer."
    )


def test_every_visible_source_string_is_carried(corpus):
    _, served = corpus
    missing = []
    checked = 0
    for uid, (lesson, lc) in served.items():
        acc: list = []
        _output_text(lc, acc)
        blob = _norm("\n".join(acc))
        src: list = []
        _visible_strings(lesson["spotlight_v2"].get("blocks") or [], src)
        for s in src:
            t = _norm(s)
            if not t or (len(t) < 2 and not t.isalnum()):
                continue
            checked += 1
            # 多行的原稿字串可能被拆成幾個段落 block —— 每一行都在就算帶到；格子裡列舉的選項
            # （「□①…」「☑②…」）改由作答位畫，去掉列舉記號後在就算（☑ 本身是教師版的答案）
            if t not in blob and not all(_norm(x) in blob or _norm(_ENUM.sub("", x)) in blob
                                         for x in str(s).splitlines() if _norm(x)):
                missing.append((uid, str(s)[:60]))
    assert checked >= 10000, f"only {checked} source strings checked — the walk may have stopped early"
    assert missing == [], f"{len(missing)} student-visible strings not carried, e.g. {missing[:5]}"


def test_every_choice_answer_points_at_the_source_answer(corpus):
    _, served = corpus
    bad, overridden = [], []
    checked = 0
    for uid, (lesson, lc) in served.items():
        steps = [s for b in lc["blocks"] if b["type"] == "exercise" for s in b["question"].get("steps") or []]
        # 表格裡的作答位也是題目（選擇 / 複選）
        steps += [s for b in lc["blocks"] if b["type"] == "exercise"
                  for s in b["question"].get("slots") or [] if s.get("type") != "text"]
        for q in _source_questions(lesson["spotlight_v2"].get("blocks") or []):
            exp = _expected_option_texts(q)
            if not exp:
                continue
            src_opts = sorted(_norm(v) for v in (q["options"].values() if isinstance(q["options"], dict) else q["options"]))
            cands = [s for s in steps if s.get("options") and s.get("answer") is not None
                     and sorted(_norm(o) for o in s["options"]) == src_opts]
            if not cands and any(s.get("no_correct_answer") and sorted(_norm(o) for o in s["options"]) == src_opts
                                 for s in steps if s.get("options")):
                # 教師版打了 ☑，但學習單印給學生的是「沒有標準答案，請依自己的想法判斷」——
                # 以印給學生的說明為準（否則另一個選項會被判「再想想看」，跟教材自己的話矛盾）
                overridden.append(uid)
                continue
            if not cands:
                # 沒成為可判分的題目 → 必須是在只讀 generic 裡（內容在、不能作答），不能消失
                gen = _norm(str([b for b in lc["blocks"] if b["type"] == "generic"]))
                assert all(o in gen for o in src_opts), f"{uid}: question {src_opts[:2]}… neither gradable nor shown"
                continue
            checked += 1
            if not any(
                sorted(_norm(s["options"][i]) for i in (s["answer"] if isinstance(s["answer"], list) else [s["answer"]])) == exp
                for s in cands
            ):
                bad.append((uid, str(q.get("prompt") or q.get("stem"))[:40], exp))
    assert checked >= 1000, f"only {checked} answers checked"
    assert bad == [], f"{len(bad)} wrong answers, e.g. {bad[:5]}"
    # 上面那種「說明寫沒有標準答案、教師版卻有勾」的題目要少而且可列舉；變多代表規則在亂吃答案
    assert len(overridden) <= MAX_NO_ANSWER_OVERRIDES, (len(overridden), sorted(set(overridden)))


def test_generic_blocks_never_show_answers(corpus):
    """The read-only floor must not become an answer key: no string that exists only as an
    answer (blanks, model answers, answer_text…) may appear in a generic block."""
    _, served = corpus
    leaks, checked, gens = [], 0, 0
    for uid, (lesson, lc) in served.items():
        gblocks = [b for b in lc["blocks"] if b["type"] == "generic"]
        if not gblocks:
            continue
        gens += len(gblocks)
        acc: list = []
        _output_text(gblocks, acc)
        gblob = _norm("\n".join(acc))
        vis: list = []
        _visible_strings(lesson["spotlight_v2"].get("blocks") or [], vis)
        vblob = _norm("\n".join(map(str, vis)))
        ans: list = []
        _answer_only_strings(lesson["spotlight_v2"].get("blocks") or [], ans)
        for a in ans:
            t = _norm(a)
            if len(t) < 2 or t in vblob:
                continue  # printed on the page anyway
            checked += 1
            if t in gblob:
                leaks.append((uid, a[:40]))
    assert gens >= 1 and checked >= 50, (gens, checked)
    assert leaks == [], leaks[:5]


def test_no_option_text_is_a_bare_key(corpus):
    """Options shown must be the source option TEXT, never its keys. (Some worksheets do
    print only 「(A)(B)(C)(D)」 — the options point at a table or figure — and there the
    text IS the letter; that is not this bug.)"""
    _, served = corpus
    bad = []
    for uid, (lesson, lc) in served.items():
        keys_only, texts = set(), set()
        for q in _source_questions(lesson["spotlight_v2"].get("blocks") or []):
            o = q["options"]
            if isinstance(o, dict):
                texts.add(tuple(str(v) for v in o.values()))
                if [str(k) for k in o] != [str(v) for v in o.values()]:
                    keys_only.add(tuple(str(k) for k in o))
        for b in lc["blocks"]:
            for s in b.get("question", {}).get("steps") or []:
                opts = tuple(s.get("options") or [])
                if opts in keys_only and opts not in texts:
                    bad.append((uid, opts))
    assert bad == [], bad[:5]


def test_withheld_lessons_have_a_recorded_reason(corpus):
    """A withheld lesson must be withheld for a Coverage drop — not because the adapter
    raised or the result failed validation (those would be mapping bugs, hidden as null)."""
    lessons, served = corpus
    unexplained = []
    for l in lessons:
        if l["lesson_uid"] in served:
            continue
        cov = A.Coverage()
        try:
            A.to_lesson(A.assemble_lesson(dict(l["spotlight_v2"]), {}, A.GapLog(), False,
                                          identity=l["lesson_uid"], coverage=cov))
        except Exception as e:  # noqa: BLE001
            unexplained.append((l["lesson_uid"], type(e).__name__))
            continue
        if not cov.dropped:
            unexplained.append((l["lesson_uid"], "no drop recorded"))
    assert unexplained == []
