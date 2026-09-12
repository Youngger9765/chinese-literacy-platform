#!/usr/bin/env python3
"""從出貨字型抽出「字 → styleSet → 讀音」對照表（唯讀，零外部依賴）。

## 為什麼需要這支

`frontend/public/data/poyin_db.json` **沒有讀音**，它只有 pattern 與變體索引。
讀音在**字型裡**：`BpmfZihiSerif-Regular.ttf` 的 `post` 表把變體字符命名為
`uniXXXX.ssNN`，而那些字符是**複合字符**（composite glyph），
它的第一個元件就叫 `z_<拼音><聲調>`。走 `post` → `loca` → `glyf` 三張表就拿得到。

⚠️ 讀的是 `post` 表的字符名稱，**不是** cmap format 14、**不是** GSUB。
   （這份說明原本寫成走 cmap/GSUB，而 code 從來沒那樣做 ——
     註解宣稱的事情 code 沒做，正是 #3177 那個 bug 的形狀，所以改掉。）
   2026-09-12 的複審用 `fontTools` 走**真正的 GSUB stylistic-set lookup** 獨立重算過，
   兩邊對 行／著／了／難／得 完全一致 —— 實作是對的，只有說明寫錯。

    難  0000→z_nan2   ss01→z_nan4   ss02→z_nuo2
    行  0000→z_xing2  ss01→z_hang2  ss02→z_xing4  ss03→z_hang4
    著  0000→z_zhe5   ss01→z_zhu4   ss02→z_zhao1  ss03→z_zhao2  ss04→z_zhuo2

⭐ **這是注音正確性的客觀真值**，而且不受教育部辭典的 CC BY-ND 授權限制 ——
它讀的是本專案已經在出貨的字型。

## 為什麼它比既有測試重要

`frontend/src/components/zhuyin/polyphonicProcessor.test.ts` **44 條全綠**，
而 `行`／`著` 在正式站的兩個最常用讀音是**反的**（銀行讀成 ㄒㄧㄥˊ、著作讀成 ㄓㄜ˙），
833 處裡有 813 處走錯槽，錯了半年沒人發現。

原因是那些斷言停在 **styleSet 字串**（`'ss01'`），而註解寫「ss01 = xíng二聲」——
字型說 `ss01 = hang2`。**綠著的 golden set 鎖住的是一個錯的信念。**

→ 注音的斷言必須打在**字型會畫出來的讀音**上，不是變體索引。這支提供那個對照。

## 用法

    python3 backend/scripts/extract_font_readings.py <font.ttf> [字 字 ...]
    python3 backend/scripts/extract_font_readings.py frontend/public/fonts/BpmfZihiSerif-Regular.ttf 難 行 著

不給字就輸出完整 JSON 到 stdout（13000+ 字）。

**重生前端那份 fixture**（換字型或改了本腳本之後）：

    python3 backend/scripts/extract_font_readings.py --write-fixture

它只留 `poyin_db.json` 裡有變體的那 541 個字，寫進
`frontend/src/components/zhuyin/__fixtures__/fontReadings.generated.json`。
⛔ 那個檔不要手改 —— `test_font_readings_match_shipped_font_3177.py` 會比對。

⚠️ 唯讀：不寫任何檔、不連網、不改字型。

來源：本輪 #3173 調查中由 agent 撰寫，救進 repo 以免隨 session 消失。
"""

import struct, sys, pathlib

class F:
    def __init__(self, data): self.d=data
    def u16(self,o): return struct.unpack_from(">H",self.d,o)[0]
    def i16(self,o): return struct.unpack_from(">h",self.d,o)[0]
    def u32(self,o): return struct.unpack_from(">I",self.d,o)[0]

def tables(d):
    f=F(d); num=f.u16(4); t={}
    for i in range(num):
        o=12+16*i
        tag=d[o:o+4].decode("latin1")
        t[tag]=(f.u32(o+8), f.u32(o+12))
    return t

MAC_GLYPHS=[".notdef",".null","nonmarkingreturn"]+["g%d"%i for i in range(3,258)]

def post_names(d,off,ln):
    f=F(d)
    ver=f.u32(off)
    if ver!=0x00020000: return None, ver
    n=f.u16(off+32)
    idx=[f.u16(off+34+2*i) for i in range(n)]
    p=off+34+2*n
    names=[]
    end=off+ln
    while p<end:
        l=d[p]; names.append(d[p+1:p+1+l].decode("latin1")); p+=1+l
    out=[]
    for i in idx:
        if i<258: out.append(MAC_GLYPHS[i] if i<len(MAC_GLYPHS) else "mac%d"%i)
        else:
            j=i-258
            out.append(names[j] if j<len(names) else "?%d"%i)
    return out, ver

# ─────────────────────────────────────────────────────────────────────────────
# 複合字符 → 第一個注音元件
#
# `uni96E3.ss01` 是複合字符（glyf 的 numberOfContours < 0），它的第一個元件就是
# 注音字符 `z_nan4`。要拿到它得走 loca → glyf，這是把「變體索引」翻譯成「讀音」
# 的最後一哩，也是整支腳本存在的理由。
# ─────────────────────────────────────────────────────────────────────────────

def _loca(d, t, num_glyphs):
    """回傳 glyph id → glyf 內的 offset。indexToLocFormat 決定是短或長格式。"""
    f = F(d)
    head_off = t["head"][0]
    fmt = f.i16(head_off + 50)          # indexToLocFormat
    lo, _ = t["loca"]
    if fmt == 0:
        return [f.u16(lo + 2 * i) * 2 for i in range(num_glyphs + 1)]
    return [f.u32(lo + 4 * i) for i in range(num_glyphs + 1)]


def first_component(d, t, loca, gid):
    """複合字符的第一個元件 glyph id；不是複合字符就回 None。"""
    f = F(d)
    go = t["glyf"][0]
    start, end = loca[gid], loca[gid + 1]
    if start >= end:
        return None                      # 空字符
    if f.i16(go + start) >= 0:
        return None                      # 簡單字符，不是複合
    # 複合字符：header 10 bytes，接著 flags(u16) + glyphIndex(u16)
    return f.u16(go + start + 12)


def build_reading_table(font_path):
    """{字: {styleSet: 讀音}}，例如 {'難': {'0000':'nan2','ss01':'nan4','ss02':'nuo2'}}"""
    d = pathlib.Path(font_path).read_bytes()
    t = tables(d)
    f = F(d)
    num_glyphs = f.u16(t["maxp"][0] + 4)
    names, _ = post_names(d, *t["post"])
    if not names:
        raise SystemExit("字型的 post 表不是 version 2.0，拿不到字符名稱")
    loca = _loca(d, t, num_glyphs)
    by_name = {n: i for i, n in enumerate(names)}

    def reading_of(gid):
        comp = first_component(d, t, loca, gid)
        if comp is None or comp >= len(names):
            return None
        n = names[comp]
        return n[2:] if n.startswith("z_") else None

    out = {}
    for name, gid in by_name.items():
        if not name.startswith("uni") or "." in name:
            continue
        try:
            ch = chr(int(name[3:], 16))
        except ValueError:
            continue
        slots = {}
        base = reading_of(gid)
        if base:
            slots["0000"] = base
        for n in range(1, 6):                     # ss01–ss05
            vg = by_name.get(f"{name}.ss{n:02d}")
            if vg is None:
                continue
            r = reading_of(vg)
            if r:
                slots[f"ss{n:02d}"] = r
        if slots:
            out[ch] = slots
    return out


#: 專案裡的預設路徑（--write-fixture 用）
_REPO = pathlib.Path(__file__).resolve().parents[2]
_FONT = _REPO / "frontend/public/fonts/BpmfZihiSerif-Regular.ttf"
_POYIN = _REPO / "frontend/public/data/poyin_db.json"
_FIXTURE = _REPO / "frontend/src/components/zhuyin/__fixtures__/fontReadings.generated.json"


def write_fixture() -> None:
    """只留 poyin_db 有變體的字，寫成前端斷言用的讀音表。"""
    import json

    table = build_reading_table(str(_FONT))
    db = json.loads(_POYIN.read_text(encoding="utf-8"))["data"]
    wanted = sorted(ch for ch, e in db.items() if isinstance(e, dict) and e.get("v"))
    missing = [ch for ch in wanted if ch not in table]
    if missing:
        raise SystemExit(f"這些字有變體卻不在字型裡，先查清楚再重生：{missing[:20]}")
    out = {ch: table[ch] for ch in wanted}
    _FIXTURE.write_text(
        json.dumps(out, ensure_ascii=False, indent=1, sort_keys=True) + "\n", encoding="utf-8"
    )
    print(f"寫入 {_FIXTURE.relative_to(_REPO)}：{len(out)} 個字")


if __name__ == "__main__":
    import json
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    if sys.argv[1] == "--write-fixture":
        write_fixture()
        raise SystemExit(0)
    table = build_reading_table(sys.argv[1])
    wanted = sys.argv[2:]
    if wanted:
        for ch in wanted:
            print(f"{ch}: {json.dumps(table.get(ch, {}), ensure_ascii=False)}")
        raise SystemExit(0)
    print(json.dumps(table, ensure_ascii=False, indent=1))
