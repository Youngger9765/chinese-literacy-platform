"""Turn Pydantic validation errors on a StoryPack into what the admin
studio shows: a Chinese field label plus a Chinese message, issue 3615.

Pydantic's own messages are English ("Field required", "String should have
at most 20 characters", "Value error, ..."); our validators raise Chinese
ValueErrors but Pydantic prefixes them with "Value error, ". Everything that
reaches the admin goes through translate_validation_error() below.
"""
from __future__ import annotations

import re

_TOP_LABELS = {
    "schema_version": "格式版本",
    "key": "劇情包代號",
    "era": "時代標籤",
    "title": "標題",
    "intro": "開場白",
    "faction_labels": "陣營名稱",
    "energy_bar_label": "能量條名稱",
    "milestones": "里程碑",
    "background_art": "背景圖",
    "chest": "寶箱",
    "badges": "徽章",
    "result_copy": "結果文案",
}

_SUB_LABELS = {
    "name": "名稱",
    "description": "說明",
    "art": "圖示",
    "kind": "類型",
    "value": "內容",
    "ratio": "進度比例",
    "message": "訊息",
    "key": "種類",
    "win": "（獲勝）",
    "lose": "（落後）",
    "draw": "（平手）",
}


_NUMBERED_TOP = {
    "intro": "開場白第 {n} 段",
    "faction_labels": "第 {n} 個陣營名稱",
    "milestones": "第 {n} 個里程碑",
    "badges": "第 {n} 個徽章",
}


def _is_internal_loc_part(part) -> bool:
    # Pydantic sometimes inserts union-member / validator tags into loc,
    # such as a model class name. They mean nothing to an admin.
    return isinstance(part, str) and (part[:1].isupper() or "[" in part)


def field_label(loc) -> str:
    parts = [p for p in loc if not _is_internal_loc_part(p)]
    if not parts:
        return "劇情包"
    top, rest = parts[0], parts[1:]
    if top not in _TOP_LABELS:
        return f"未知欄位「{top}」"
    label = _TOP_LABELS[top]
    if rest and isinstance(rest[0], int):
        n = rest[0] + 1
        label = _NUMBERED_TOP.get(top, label + "第 {n} 項").format(n=n)
        rest = rest[1:]
    for part in rest:
        if isinstance(part, int):
            label += f"第 {part + 1} 項"
        elif part in _SUB_LABELS:
            label += _SUB_LABELS[part]
        else:
            label += f"「{part}」"
    return label


_PYDANTIC_PREFIXES = ("Value error, ", "Assertion failed, ")

_NUMBER_TYPES = {
    "float_type", "float_parsing", "int_type", "int_parsing", "int_from_float",
    "decimal_type", "decimal_parsing", "finite_number",
}
_OBJECT_TYPES = {"model_type", "dict_type", "model_attributes_type"}


def _literal_choices(expected: str) -> str:
    values = re.findall(r"'([^']*)'", expected) or [expected]
    return "或".join(f"「{v}」" for v in values)


def error_message(err: dict) -> str:
    kind = err.get("type", "")
    ctx = err.get("ctx") or {}
    if kind in ("value_error", "assertion_error"):
        text = str(ctx.get("error") or err.get("msg", ""))
        for prefix in _PYDANTIC_PREFIXES:
            if text.startswith(prefix):
                text = text[len(prefix):]
        return text
    if kind == "missing":
        return "必填，不可省略"
    if kind == "extra_forbidden":
        return "不允許的欄位，請刪除"
    if kind == "string_too_short":
        n = ctx.get("min_length", 1)
        return "不可空白" if n == 1 else f"至少要 {n} 個字"
    if kind == "string_too_long":
        return f"最多 {ctx.get('max_length')} 個字"
    if kind == "too_short":
        return f"至少要 {ctx.get('min_length')} 項"
    if kind == "too_long":
        return f"最多 {ctx.get('max_length')} 項"
    return _type_message(kind, ctx)


def _type_message(kind: str, ctx: dict) -> str:
    if kind == "string_type":
        return "必須是文字"
    if kind == "list_type":
        return "必須是清單"
    if kind in _OBJECT_TYPES:
        return "必須是物件"
    if kind in _NUMBER_TYPES:
        return "必須是數字"
    if kind == "greater_than":
        return f"必須大於 {ctx.get('gt')}"
    if kind == "greater_than_equal":
        return f"不可小於 {ctx.get('ge')}"
    if kind == "less_than":
        return f"必須小於 {ctx.get('lt')}"
    if kind == "less_than_equal":
        return f"不可大於 {ctx.get('le')}"
    if kind == "literal_error":
        return "只能是" + _literal_choices(str(ctx.get("expected", "")))
    if kind in ("bool_type", "bool_parsing"):
        return "必須是真或假"
    return "格式不正確"


def translate_validation_error(err: dict) -> dict:
    loc = tuple(err.get("loc", ()))
    shown = [str(part) for part in loc if not _is_internal_loc_part(part)]
    return {
        "loc": ".".join(shown),
        "field": field_label(loc),
        "msg": error_message(err),
    }
