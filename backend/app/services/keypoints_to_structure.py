"""keypoints_to_structure.py — 重點表 source bridge for the uid tree (#2683).

WHY THIS EXISTS
---------------
The 重點表 step calls ``/stories/{id}/structure``, which serves the teacher-authored
table from ``story["story_structure_table"]`` — a raw list-of-lists produced by the
first edition's ``_parsed_2026-05-01`` parser. Fall through that and the endpoint
asks an LLM to invent a table instead, which is both a cost and a fidelity loss: the
whole point of the extracted table is that it is what the teacher actually wrote.

The second-edition pipeline emits ``keypoints.yml`` per lesson, already parsed into
``{columns, rows[{label, value|sub_rows, blanks}], structure, title}``. So the uid
tree has the content but not the shape the route reads.

Rather than teach the route a second shape (two parsers for one table is how the
first edition's two-layer merge started), this converts the structured form BACK to
the raw list-of-lists and lets ``_format_yaml_structure_table`` stay the single
formatter. It is a lossless direction: the raw form is strictly less structured.

Round-trip rules, mirroring ``_parse_yaml_table_row``:
    title                              → ``[title]``
    {label, value}                     → ``[label, value]``
    {label, sub_rows:[{sub_label, template}]}
                                       → ``[label, sub1, tpl1, sub2, tpl2, …]``
Blanks are rendered back into their cell as ``【answer】``, which is the marker the
route's fill-blank detection looks for.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any, Optional

# The cell marker the route treats as a fill-in blank.
_BLANK_OPEN, _BLANK_CLOSE = "【", "】"

# A cell whose text is only underscores/whitespace is a placeholder for the blank
# that follows it, not content — the raw form carries the answer in the cell itself.
_PLACEHOLDER = set("_＿ 　")

# A gap the teacher wrote. Two notations, because the two extractors chose
# differently: the first edition wrote runs of underscores, the multimodal one writes
# an empty 【　】 (that is a full-width space inside). Both mean "student fills this".
# One underscore is not a gap — it appears inside ordinary text.
_GAP_RE = re.compile(r"[_＿]{2,}|【[\s　]*】")


def _render_cell(text: Any, blanks: Optional[list]) -> str:
    """One table cell: the authored text with its blanks' answers put back in place.

    "In place" is the whole point. The cell text carries the gaps the teacher wrote
    as runs of underscores — 「需要驚人的__與__」 — and the answers belong inside
    them. Appending instead put every answer at the end of the sentence
    (「需要驚人的__與__。【記憶力】【反應力】」), which reads as the answer key
    printed under the question: the student sees both the gap and what fills it,
    and the gap is no longer answerable.
    """
    # ⛔ 絕不可以 str() 一個 mapping。有些課把整個小題寫進儲存格
    #    （L0004 的「感受」欄），`str()` 出來的是 Python 的 repr，而 repr 裡帶著
    #    `'answer': [1, 3]` —— **答案跟題目一起印給學生**。route 的消毒
    #    (`_strip_blank_answers`) 只認 `【…】`，對 repr 完全無效：挖掉空格之後
    #    答案還原封不動留在後面那半截，反而更醒目。
    if isinstance(text, Mapping):
        return _render_mapping_cell(text, blanks)

    # ⛔ 同理，也不可以 str() 一個 list。有幾課把編號小題寫成 list[str]
    #    （L0167／L0168／L0169 的「內容」欄），`str()` 出來是 Python 的 list repr ——
    #    學生看到的是 `['1.小美看見…', '2.阿哲…']`，連方括號和引號都在畫面上。
    #    這些本來就是一行一題，用換行接起來就是它們該有的樣子。
    if isinstance(text, (list, tuple)):
        s = "\n".join(
            _render_cell(item, None) if isinstance(item, (Mapping, list, tuple))
            else ("" if item is None else str(item))
            for item in text
        )
    else:
        s = "" if text is None else str(text)
    answers = [
        str(b.get("answer", "")).strip()
        for b in (blanks or [])
        if isinstance(b, dict) and str(b.get("answer", "")).strip()
    ]
    if not answers:
        return s

    def wrap(a: str) -> str:
        return f"{_BLANK_OPEN}{a}{_BLANK_CLOSE}"

    # A cell that is nothing but a placeholder IS the blank.
    if not s or set(s) <= _PLACEHOLDER:
        return "".join(wrap(a) for a in answers)

    # Substitute answers into the underscore runs, left to right. Extra gaps keep
    # their underscores (an unanswered gap is a content gap, not something to
    # invent); extra answers append, because dropping one would lose data silently.
    remaining = list(answers)

    def take(_match) -> str:
        return wrap(remaining.pop(0)) if remaining else _match.group(0)

    out = _GAP_RE.sub(take, s)
    return out + "".join(wrap(a) for a in remaining)


def _render_mapping_cell(node: Mapping, blanks: Optional[list] = None) -> str:
    """一整個小題被寫進單一儲存格時，照它的欄位渲染 —— 而不是印出它的 repr。

    欄位對應跟 `_flatten_items` 完全一致（那條路已經這樣接了）：
        value / template / instruction → 這一格的文字
        blanks                          → 【答案】填回文字裡的空格
        options (+ answer / answers)    → `□①…②…` 記法，答案不加 □

    這裡**不會**印出 `answer` 這個欄位本身；答案只以「哪個選項沒有 □」和
    「填回 `【…】`」兩種既有記法表達，兩種下游的消毒都認得。
    """
    base = node.get("value")
    if base is None:
        base = node.get("template")
    if base is None:
        base = node.get("instruction")

    inner = node.get("blanks")
    rendered = _render_cell(base, inner if inner is not None else blanks)

    if node.get("options"):
        choice = _render_choice_cell(node)
        return f"{rendered}\n{choice}" if str(rendered).strip() else choice
    return rendered


def _text_only(value: Any) -> str:
    """區段標題那一格：只取得出文字，絕不帶答案。

    第一欄在原始形式裡是區段標題，而消毒只走 value 不走區段標題 —— 填了答案
    學生會直接看到（見 `_columns_to_structure_table` 的註解）。所以 mapping 進來時
    只挑純文字欄位，`options`／`blanks`／`answer` 一律不碰。
    """
    if isinstance(value, Mapping):
        for k in ("value", "template", "instruction", "text", "label"):
            v = value.get(k)
            if isinstance(v, str) and v.strip():
                return v.strip()
        return ""
    return str(value or "").strip()


def _sidecar(row: dict, column: str, suffix: str, *, is_last: bool = False) -> Any:
    """找 `column` 這一欄的旁掛資料（答案 / 選項）。

    正規寫法是 `{欄名}_blanks`（skill ⑥.7 已寫死），但已經抽出來的課有三種變體：

        事件_blanks        正規
        想法_blanks        長欄名縮寫（欄名是「面對失敗的想法」）
        故事結構_blank     單數
        blanks             裸的 —— 指的是主要內容欄（最後一欄）

    容錯放在這裡是**安全網不是機制**：`normalize_block_types.py` 會要求新抽的課用
    正規寫法。少了這層網，寫錯名字的後果是「答案沒填進去、畫面照樣出得來」——
    沒有任何錯誤訊息，只是那格永遠是空的。
    """
    singular = suffix[:-1] if suffix.endswith("s") else None
    best, best_len = None, -1
    for key, value in row.items():
        if not isinstance(key, str):
            continue
        for suf in (suffix, singular):
            if not suf or not key.endswith(suf):
                continue
            prefix = key[: -len(suf)]
            if prefix and prefix in column and len(prefix) > best_len:
                best, best_len = value, len(prefix)
    if best is not None:
        # 單數形只裝一筆，統一成 list，下游才不用分兩種情況。
        # ⚠️ 只對「空格」這種**一筆一個 dict** 的旁掛做。`_options` 的 dict
        #    **本身就是**選項表（`{1: 甲, 2: 乙}`），包成 list 之後
        #    `_render_choice_cell` 會把整張表當成「第一個選項的文字」，
        #    印出 `□①{1: '甲', 2: '乙'}` —— 9 課中招。
        if isinstance(best, dict) and suffix in ("_blanks", "_blank"):
            return [best]
        return best

    bare = row.get(suffix.lstrip("_"))
    return bare if (is_last and bare is not None) else None


def _with_prompt(node: Any, rendered: Any) -> Any:
    """把 `prompt`（題幹）接到**已經渲染好**的內容前面。

    `prompt` 承載的是題目在問什麼（「下列哪個是阿耀遇到的問題？(單選)」），
    而這個模組原本全檔沒讀過這個 key —— 於是題幹渲染成空字串，畫面上只剩選項，
    學生不知道在選什麼，而且不報錯。跟 `sub_label` 那個是同一族的靜默流失。

    ⚠️ 一定要接在**渲染之後**。`_render_cell` 會把答案填回文字裡的空格位置，
    先併字串的話，答案會跑進題幹的空格、而不是內容的空格 —— 那種錯位比原本的
    缺漏更難發現。

    沒有 `prompt` 就原樣回傳（含 None），所以對不帶 `prompt` 的資料是零影響。
    """
    if not isinstance(node, dict):
        return rendered
    stem = str(node.get("prompt") or "").strip()
    if not stem:
        return rendered
    body = "" if rendered is None else str(rendered).strip()
    return f"{stem}\n{body}" if body else stem


def _flatten_items(items: list) -> list[dict]:
    """`items[]`（可能還有 `sub_items[]`）攤平成 `sub_rows` 的形狀。

    原始 list-of-lists 只有兩層（區段 → 子項），沒有第三層。抽取到的第三層
    （L0003「天空的變化」底下還有兩個小項）用序號帶進子項標籤保留層級關係，
    而不是丟掉 —— 丟掉的話畫面上會少兩個空格，而且不會有人發現。
    """
    out: list[dict] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        # `label` 放在最後：現行規格（skill §⑥.55b）叫抽取者用 `label` 寫子項名字，
        # 但這裡原本只讀 `sub_label`/`index` —— 於是照規格寫的每一課，子項名字
        # 都渲染成空字串（2026-08-18 實測 63 課、365 個），畫面上整欄空白而且不報錯。
        # 擺最後是為了對既有兩種寫法零影響：全庫沒有任何子項同時帶 `label` 和
        # `sub_label`/`index`，所以順序其實是惰性的，但寫在最後能讓這件事一眼看出來。
        label = str(
            item.get("sub_label") or item.get("index") or item.get("label") or ""
        ).strip()
        subs = item.get("sub_items")
        if isinstance(subs, list) and subs:
            head = str(item.get("value") or item.get("template") or "").strip()
            for sub in subs:
                if not isinstance(sub, dict):
                    continue
                inner = str(sub.get("index") or "").strip()
                out.append({
                    "sub_label": f"{label}-{inner}" if inner else label,
                    "template": sub.get("value") if sub.get("value") is not None else sub.get("template"),
                    "blanks": sub.get("blanks"),
                })
            head = _with_prompt(item, head)
            if head:
                # 母項自己的文字（「天空的變化」）當第一個子項，不然那句話會消失。
                # 母項只有 `prompt` 沒有 value 時，`_with_prompt` 會讓 head 變成題幹本身，
                # 一樣要插進去 —— 不然那句題幹沒有任何位置可以出現。
                out.insert(len(out) - len(subs), {"sub_label": label, "template": head, "blanks": None})
            continue
        # ⚠️ 帶 `options` 的小題要轉成 `□①…` 記法，不然它只是一段純文字：
        #    畫得出來、但**學生點不了**，而 interaction_profile 也看不到它
        #    （checkbox_count 掉成 0，整課被判成 display_only）。
        #    答案在 `answer`／`answers`，來源是紅色 ☑（圖形層），文字流沒有。
        if item.get("options"):
            base = str(item.get("value") or item.get("template") or "").strip()
            rendered = _render_choice_cell(item)
            out.append({
                "sub_label": label,
                "template": _with_prompt(item, f"{base}\n{rendered}" if base else rendered),
                "blanks": None,
            })
            continue

        tpl = item.get("template") if item.get("template") is not None else item.get("value")
        blanks = item.get("blanks")
        if str(item.get("prompt") or "").strip():
            # 帶題幹的要先渲染（答案填回空格）再接題幹，否則答案會落到題幹的空格裡
            tpl, blanks = _with_prompt(item, _render_cell(tpl, blanks)), None
        out.append({"sub_label": label, "template": tpl, "blanks": blanks})
    return out


def _render_choice_cell(question: dict) -> str:
    """選擇題 → 原始形式的 `□①…②…`。

    `parse_checkbox_options` 的規則是「有 □ 的是誘答，沒 □ 的是答案」，所以答案不加
    □、其餘加。答案欄位兩種都收：`answer`（單選）與 `answers`（複選）。

    ⚠️ 全部選項都是答案時，這個記法表達不了「這是選擇題」（沒有任何 □ → 偵測器
    不會觸發），那一列會退成 display。內容還在、只是不能作答 —— 記在 PRD TODO，
    不在這裡用假的 □ 硬湊，那會把正確選項標成誘答。
    """
    options = question.get("options") or {}
    items = (sorted(options.items(), key=lambda kv: str(kv[0]))
             if isinstance(options, dict) else list(enumerate(options, 1)))
    # 兩個欄名、兩種形狀都要收：`answer: 2`、`answer: [1, 3]`、`answers: [1, 3]`。
    # 少收一種的後果是「一個選項都不算答案」→ 全部加 □ → 整列退成 display，
    # 而且不會報錯（`{str(a) for a in 1}` 則會直接 TypeError）。
    answers = question.get("answers")
    if answers is None:
        answers = question.get("answer")
    if answers is None:
        answers = []
    elif not isinstance(answers, (list, tuple, set)):
        answers = [answers]
    correct = {str(a).strip() for a in answers}

    marks = "①②③④⑤⑥⑦⑧⑨⑩"
    out = []
    for i, (key, text) in enumerate(items):
        mark = marks[i] if i < len(marks) else f"({i + 1})"
        is_answer = str(key).strip() in correct or str(i + 1) in correct
        out.append(f"{'' if is_answer else '□'}{mark}{text}")
    return " ".join(out)


def _columns_to_structure_table(kp: dict) -> Optional[list[list[str]]]:
    """欄位式重點表（多模態抽取的形狀）→ 原始 list-of-lists。

    形狀長這樣，第一欄是段落/主角，其餘每欄是一個子項：

        columns: [主角, 事件, 面對失敗的想法]
        rows:
          - 主角: 小齊（1～3段）
            事件: 1.…輪到小齊站上【　】。2.小齊（①被投手三振 □②擊出安打）…
            事件_blanks:  [{answer: 打擊區}]
            事件_choices: [{options: [被投手三振, 擊出安打], answer: 1}]

    為什麼要接這一層：不接的話，`_format_yaml_structure_table` 讀不到任何 label／
    value，整張表變成 5 列空的 display 列 —— 畫面上是一張空表格，而且**學生不能作答**。
    2026-08-17 v3 換上去之後就是這個狀態，逐字門、拆模組、聚光燈 render 全綠，
    只有 keypoints manifest 那道 ratchet 因為 `interaction_profile` 掉成
    `display_only` 才叫出來。
    """
    columns = [str(c) for c in (kp.get("columns") or []) if str(c).strip()]
    rows_in = kp.get("rows")
    if len(columns) < 2 or not isinstance(rows_in, list) or not rows_in:
        return None

    out: list[list[str]] = []
    title = str(kp.get("title") or "").strip()
    if title:
        out.append([title])

    head, rest = columns[0], columns[1:]

    # ⚠️ `columns` 的名字不一定對得上 row 的 key。L0004 的 columns 是中文
    #    （段落／事件／感受），row 的 key 卻是英文（paragraph／event／feeling）——
    #    照名字查一個都查不到，整張表變成空的，而且**不會報錯**。
    #    對不上就改用 row 自己的 key（照原序，扣掉旁掛欄位），欄名仍用 columns 顯示。
    sample = next((r for r in rows_in if isinstance(r, dict)), {})
    if sample and not any(c in sample for c in columns):
        keys = [k for k in sample
                if isinstance(k, str)
                and not any(k.endswith(suf) for suf in ("_blanks", "_blank", "_choices",
                                                        "_multi_answer", "_options"))
                and k not in ("blanks", "items", "sub_rows", "sub_items", "tail", "tail_blank")]
        if len(keys) >= 2:
            head, rest = keys[0], keys[1:]
            # 顯示用的欄名還是照 columns（那是教材印的），只有取值改用實際 key
            rest = list(zip(rest, columns[1:] + rest[len(columns) - 1:]))

    for row in rows_in:
        if not isinstance(row, dict):
            continue
        # ⚠️ 第一欄**不填答案**，即使抽取到了。
        #    第一欄在原始形式裡是「區段標題」，而消毒（把答案換回空格再給學生）只走
        #    value 不走區段標題 —— 填進去的話學生直接看到答案。
        #    2026-08-17 preview 實測：填了之後 文-L6 的第一格印出「【起因】/案由」。
        #    答案仍留在 keypoints.yml 裡，教師端要用再取。
        cells = [_text_only(row.get(head))]
        for i, entry in enumerate(rest):
            key, shown = entry if isinstance(entry, tuple) else (entry, entry)
            text = row.get(key)
            if text is None:
                continue
            cells.append(str(shown))
            opts = _sidecar(row, key, "_options", is_last=(i == len(rest) - 1))
            if opts:
                # 規格（skill §⑥.55b）寫的是 `{欄名}_answer` / `{欄名}_answers`；
                # 原本只查 `_multi_answer`，於是照規格寫的課答案一律查無 →
                # 每個選項都加 □ → 沒有任何選項是答案。`_answers` 這個 suffix
                # 的單數退路（見 `_sidecar`）順帶把 `_answer` 也收進來。
                answers = _sidecar(row, key, "_answers", is_last=(i == len(rest) - 1))
                if answers is None:
                    answers = _sidecar(row, key, "_multi_answer",
                                       is_last=(i == len(rest) - 1))
                cells.append(_render_choice_cell({"options": opts, "answers": answers}))
                continue
            # 配對題：整份共用一組選項，收在 `option_bank`，而這一格放的是**答案代號**。
            # 沒有這個 case 的話代號會被當純文字送出去 —— L0016 八題的 A–H 全印在
            # 學生眼前（他們手上有印著對照表的紙本），而且整課 17 個元素都是 display，
            # 一題都不能作答（2026-08-19 實測）。
            # 轉成選擇題記法：選項來自 bank、這一格的代號是答案。答案之後由消毒器
            # 擋在學生端外（`_sanitize_row_for_client` 的白名單），作答後才由
            # `/structure/grade` 回傳 —— 那條路已經鋪好了。
            bank = kp.get("option_bank")
            if isinstance(bank, dict) and str(text).strip() in bank:
                cells.append(_render_choice_cell({"options": bank, "answers": str(text).strip()}))
                continue
            blanks = _sidecar(row, key, "_blanks", is_last=(i == len(rest) - 1))
            cells.append(_render_cell(text, blanks))
        if len(cells) >= 3:
            out.append(cells)

    return out or None


def keypoints_to_structure_table(keypoints: Any) -> Optional[list[list[str]]]:
    """Structured keypoints → the raw ``story_structure_table`` list-of-lists.

    Returns None when there is nothing usable, so callers can fall through exactly
    as they did when the field was absent — never an empty table, which would render
    as a stripped-down 重點表 and look like content rather than a gap.
    """
    if not isinstance(keypoints, dict):
        return None
    kp = keypoints.get("keypoints") if "keypoints" in keypoints else keypoints
    if not isinstance(kp, dict):
        return None
    rows_in = kp.get("rows")
    if not isinstance(rows_in, list) or not rows_in:
        return None

    # 欄位式（多模態抽取）跟 label/sub_rows 式（第一版）兩種形狀都要收。
    # 判準用「列裡有沒有 label」而不是「有沒有 columns」—— 兩種形狀都可能有 columns。
    if not any(isinstance(r, dict) and r.get("label") for r in rows_in):
        table = _columns_to_structure_table(kp)
        if table:
            return table

    out: list[list[str]] = []
    title = str(kp.get("title") or "").strip()
    if title:
        out.append([title])

    for row in rows_in:
        if not isinstance(row, dict):
            continue
        label = str(row.get("label") or "").strip()
        # `items` 是 `sub_rows` 的別名（多模態抽取寫 items，第一版寫 sub_rows），
        # 兩者同義。不認得的話整列只剩 label，底下的小題全部不見。
        subs = row.get("sub_rows") or row.get("items")
        if isinstance(subs, list) and subs:
            subs = _flatten_items(subs)
        if isinstance(subs, list) and subs:
            cells = [label]
            for sub in subs:
                if not isinstance(sub, dict):
                    continue
                cells.append(str(sub.get("sub_label") or "").strip())
                cells.append(_render_cell(
                    sub.get("template") if sub.get("template") is not None else sub.get("value"),
                    sub.get("blanks"),
                ))
            # `_parse_yaml_table_row` reads a >3-cell row as paired only when the
            # remainder after the label is even. It always is here: cells starts at
            # one (the label) and every accepted sub_row appends exactly two, so the
            # count is invariably odd. A guard for the even case would be unreachable
            # — mutation-checked, it survived every test because nothing can enter it.
            if len(cells) >= 3:
                out.append(cells)
            continue
        out.append([label, _with_prompt(row, _render_cell(row.get("value"), row.get("blanks")))])

        # 有些列在主要內容之後還接一句結語，自己帶一個空格
        # （L0124「→所以製作植物肉需額外添加維生素【　】。」）。不接的話那一格不見。
        tail = row.get("tail")
        if tail:
            tail_blank = row.get("tail_blank")
            out.append([label, _render_cell(tail,
                                            [tail_blank] if isinstance(tail_blank, dict) else tail_blank)])

    # 表末的星號題（多為複選）。它印在重點表下方、屬於這張表，
    # 不接的話整題連題幹都不會出現在畫面上。
    tq = kp.get("tail_question")
    if isinstance(tq, dict) and str(tq.get("stem") or "").strip():
        out.append([("★ " if tq.get("star") else "") + str(tq["stem"]).strip(),
                    _with_prompt(tq, _render_choice_cell(tq))])

    return out or None
