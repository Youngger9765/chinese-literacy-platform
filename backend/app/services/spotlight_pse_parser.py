"""PSE (問題-解決-結果) line parser — shared by build_lesson_schema and spec tests."""

from __future__ import annotations

import re
from typing import Any

_PSE_ANSWER_KEYWORDS = ("偷", "模仿", "雞叫", "水位線")


def parse_pse_mcq_line(line: str) -> dict[str, Any] | None:
    """Parse ❶❷❸❹ summary-PSE line into single or free_text block."""
    line = line.strip()
    m = re.match(r"^([❶❷❸❹])\s*(.+)$", line)
    if not m:
        return None
    circled, body = m.group(1), m.group(2).strip()

    if "【" in body and "】" in body:
        bm = re.search(r"【\s*([^】]+?)\s*】", body)
        answer_hint = bm.group(1).strip() if bm else None
        prompt_body = re.sub(r"【[^】]+】", "【　　　】", body)
        block: dict[str, Any] = {"type": "free_text", "prompt": f"{circled}{prompt_body}"}
        if answer_hint and re.sub(r"\s+", "", answer_hint):
            block["answer"] = answer_hint
        return block

    prompt = f"{circled}{body}"
    options: list[str] = []
    answer: str | None = None
    rest = ""
    opt_text = ""

    if re.search(r"[？?]", body):
        q_text, rest = re.split(r"[？?]", body, maxsplit=1)
        prompt = f"{circled}{q_text.strip()}？"
        rest = rest.strip()
    else:
        rest = body

    if "□" in rest or "□" in body:
        opt_text = rest if rest else body
        if "？" in body and not rest:
            opt_text = body.split("？", 1)[-1].strip()
        parts = re.split(r"\s*□\s*", opt_text)
        for i, part in enumerate(parts):
            part = part.strip()
            if not part:
                continue
            clean = re.sub(r"^[①②③④⑤]\s*", "", part).strip()
            if not clean:
                continue
            if i == 0 and not opt_text.strip().startswith("□"):
                answer = clean
            options.append(clean)
    elif rest:
        chunks = [c.strip() for c in re.split(r"[　\s]{2,}", rest) if c.strip()]
        for i, ch in enumerate(chunks):
            if i == 0:
                answer = ch
            options.append(ch)

    if len(options) >= 2:
        chosen = answer or options[0]
        if opt_text.strip().startswith("□"):
            for opt in options:
                if any(kw in opt for kw in _PSE_ANSWER_KEYWORDS):
                    chosen = opt.split("　", 1)[-1].strip() if "　" in opt else opt
                    break
            else:
                chosen = max(options, key=len)
        if chosen.startswith("再去買一件"):
            chosen = re.sub(r"^再去買一件[　\s]*", "", chosen).strip()
        return {
            "type": "single",
            "prompt": prompt,
            "options": options,
            "answer": chosen,
        }
    return {"type": "free_text", "prompt": prompt}
