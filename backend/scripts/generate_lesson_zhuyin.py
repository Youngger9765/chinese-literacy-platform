#!/usr/bin/env python3
"""逐課注音對照表 —— 多來源產出，固化成表（#3218）

## 為什麼是表而不是引擎

注音本來被當成「執行期要算出來的東西」，於是前端有一套選擇器（方大哥策展的樣式表 +
一/不變調 + hardcode 特例），後端疊出另一套（#3202/#3204/#3215 的四層）。
兩邊對同一段課文會給不同答案 —— 實測全庫 7,682 / 65,754 個破音字位置（11.7%）。

⛔ 「讓兩邊規則一致」走不通：後端結構上無法重現前端那套引擎（第一/第二 pass 優先序、
`skipPrev` 狀態機、`SPECIAL_DOUBLE_CHARACTERS`、`d` 欄位與字型槽的對應）。
#3215 移植過一次，吐出 `不 → ㄈㄨ`。

所以注音改成**課文的一部分** —— 跟課文、重點表、聚光燈、生字一樣是內容，不是計算。
兩邊讀同一份，不一致不是「要修到 0」，是**不可能存在**。

⚠️ 窮舉「詞形」不行（實測）：相異（字,詞形）16,614 種、前 500 種只覆蓋 33%、
42% 只出現一次 —— 長尾沒有頭。窮舉「答案」才行：位置數是固定的。

## 多來源產出，固化成表（Young 2026-09-15）

產表時可以用任何貴的方法；產完就是查表，執行期不再有判斷。

    ① 字型 BpmfZihiSerif-Regular.ttf  → 每個字的合法讀音集合（2–5 個），台灣讀音權威
    ② 出貨的 polyphonicProcessor.ts   → 主答案（方大哥的策展 + 變調），**跑它不移植它**
    ③ pypinyin（後端現況）            → 兩岸分歧偵測器：它跟 ② 不同的位置就是要審的
    ④ 教育部辭典                       → 詞級裁決（③ 標出來的位置）
    ⑤ 人／LLM                          → ④ 查不到的（成語、詞典沒收的詞）
                          ↓
                  固化：backend/data/lessons/<uid>/v3/zhuyin.json

## 檔案為什麼放在課文資料夾裡、又為什麼不註冊成大題

放同一個資料夾：課文與注音一起搬、一起版控，不可能忘記帶。

⛔ **不進 `lesson_uid_loader.MODULES`** —— 進了就會出現在 `sections_present`/`dispatch`/
`_manifest.yml`，而內容忠實度門會拿 section 去對原稿 DOCX，**DOCX 沒有注音大題**。

三個條件都驗過（2026-09-15）：
  - 二修重抽 `parse_docx_lessons_bulk.py` 用 `mkdir(exist_ok=True)` + 逐檔 `open(w)`，
    沒有 rmtree、不清資料夾 → 這個檔存活
  - loader 用 `glob("*.*.yml")`（要兩個點）+ `if m in MODULES` → `zhuyin.json` 看不到
  - `assets/` 已經是同資料夾裡未註冊的先例
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent
FRONTEND = REPO / "frontend"
FONT = FRONTEND / "public" / "fonts" / "BpmfZihiSerif-Regular.ttf"
POYIN_DB = FRONTEND / "public" / "data" / "poyin_db.json"
LESSONS = BACKEND / "data" / "lessons"
RUNNER_TS = FRONTEND / "scripts" / "zhuyinAnswers.ts"
CORRECTIONS = BACKEND / "data" / "zhuyin" / "lesson_corrections.json"
EXTRACTOR = BACKEND / "scripts" / "extract_font_readings.py"

DEFAULT_SLOT = "0000"


def _load(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:  # pragma: no cover
        raise RuntimeError(f"無法載入 {path}")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _to_bopomofo(reading: str) -> str:
    """`le4` → `ㄌㄜˋ`。字型用 `5` 標輕聲而 pypinyin 只認 0–4，先拿掉
    （與 `generate_taiwan_zhuyin_table.py` 共用同一個轉換器，記法保證一致）。"""
    from pypinyin.style.bopomofo import BopomofoConverter

    return BopomofoConverter().to_bopomofo(re.sub(r"5$", "", reading))


def lesson_uids() -> list[str]:
    return sorted(p.name for p in LESSONS.iterdir()
                  if p.is_dir() and re.fullmatch(r"L\d+", p.name)
                  and any(c.is_dir() and c.name.startswith("v") for c in p.iterdir()))


def _vdir(uid: str) -> Path:
    """⛔ 共用 `lesson_uid_loader._latest_version` —— 產表與服務必須看同一個版本目錄。

    新版本（v4／v5）一出現，這支就會寫到新版本底下；**但它必須被跑到** ——
    所以 `specs/run-ci.sh` 有一道 `--check` 門擋住「課文更新了但注音表沒重產」。
    """
    sys.path.insert(0, str(BACKEND))
    from app.services.lesson_uid_loader import _latest_version

    v = _latest_version(LESSONS / uid)
    if v is None:
        sys.exit(f"{uid} 沒有版本目錄")
    return v


def collect_texts(uid: str) -> list[dict]:
    """撈出這一課所有會被畫注音的文字。

    來源是 uid tree —— **不是** `manifest.yml`，那份是一修遺留、少 17 課（見 CLAUDE.md）。
    """
    import yaml

    loader = getattr(yaml, "CSafeLoader", yaml.SafeLoader)
    items: list[dict] = []
    for f in sorted(_vdir(uid).glob("*.yml")):
        try:
            doc = yaml.load(f.read_text(encoding="utf-8"), Loader=loader)
        except Exception:
            continue
        if not isinstance(doc, dict):
            continue
        slug = f.name.split(".")[1] if f.name.count(".") == 2 else None
        fta = doc.get("full_text_annotate")
        if isinstance(fta, dict):
            for p in fta.get("paragraphs") or []:
                if isinstance(p, dict) and isinstance(p.get("text"), str):
                    items.append({"section": "full_text_annotate", "slug": slug,
                                  "idx": p.get("idx"), "text": p["text"]})
        kr = doc.get("key_reading")
        if isinstance(kr, dict) and isinstance(kr.get("passage"), str) and kr["passage"].strip():
            items.append({"section": "key_reading", "slug": slug, "idx": None,
                          "text": kr["passage"]})
        # 文言文課：課文住在 `classical_text`，不是 `full_text_annotate`。
        #
        # ⛔ 漏掉這三個 section 的後果（2026-09-15 對抗式複審實測）：**10 課文言文的表
        # 整個是空的**，55 段 / 5,201 字 / 1,281 個破音字位置全部靜靜走 fallback ——
        # 而文言文正是破音字密度最高的地方。而且三道檢查同時報綠（`test_有課就有表`
        # 只看檔案存在、逐課斷言有 `or not texts` 自動放行、`--check` 對空表重產還是空表）。
        for mod in ("classical_text", "modern_translation"):
            sec = doc.get(mod)
            if isinstance(sec, dict):
                for p_ in sec.get("paragraphs") or []:
                    if isinstance(p_, dict) and isinstance(p_.get("text"), str):
                        items.append({"section": mod, "slug": slug,
                                      "idx": p_.get("idx"), "text": p_["text"]})
                    elif isinstance(p_, str):
                        items.append({"section": mod, "slug": slug, "idx": None, "text": p_})
        sc = doc.get("self_challenge")
        if isinstance(sc, dict) and isinstance(sc.get("passage"), str) and sc["passage"].strip():
            items.append({"section": "self_challenge", "slug": slug, "idx": None,
                          "text": sc["passage"]})

        mtp = doc.get("multi_text_parts")
        if isinstance(mtp, list):
            for n, part in enumerate(mtp):
                if not isinstance(part, dict):
                    continue
                for p in part.get("paragraphs") or []:
                    if isinstance(p, dict) and isinstance(p.get("text"), str):
                        items.append({"section": f"multi_text_parts[{n}]", "slug": slug,
                                      "idx": p.get("idx"), "text": p["text"]})
    # 補上服務端會送、但上面那趟 yml 走法漏掉的字串（見 collect_served_texts 的說明）。
    # 保留原有 items 的順序與 section 標籤不動，只在尾端補漏 —— 這樣既有的表最小變動。
    seen = {i["text"] for i in items}
    for extra in collect_served_texts(uid):
        if extra["text"] not in seen:
            items.append(extra)
            seen.add(extra["text"])
    return items


def _pack_slots(ss: list) -> str:
    """把槽位陣列壓成一個字元一格的字串（#3230）。

    `.` = 預設槽（`0000`）· `1`..`5` = `ss01`..`ss05`。

    全庫 1,291,315 個槽位裡 **96.9% 是預設** —— 存成 JSON 陣列是 10.3 MB，
    壓成字串是 1.3 MB。位置語意完全不變（第 i 個字元 == 第 i 個 UTF-16 單位）。
    """
    out = []
    for v in ss:
        if not v or v == DEFAULT_SLOT:
            out.append(".")
        elif len(v) == 4 and v.startswith("ss") and v[2:].isdigit():
            n = int(v[2:])
            if not 1 <= n <= 9:
                sys.exit(f"槽位超出可壓縮範圍：{v}")
            out.append(str(n))
        else:
            sys.exit(f"沒見過的槽位格式：{v!r}")
    return "".join(out)


def unpack_slots(z: str) -> list[str]:
    """`_pack_slots` 的反向。⛔ 前後端各有一份同語意的實作，改這裡要三處一起改。"""
    return [DEFAULT_SLOT if c == "." else f"ss{int(c):02d}" for c in z]


def u16_chars(text: str) -> list[str]:
    """把字串切成 **UTF-16 單位**，跟 JS 的 `text[i]` 一致（#3230）。

    ⛔ Python 的 `list(text)` 是**碼點**，JS 的 `text[i]` 是 **UTF-16 單位** ——
    純 BMP 的字兩者相同，所以整條路徑一直沒事；但課名〈𪹚龍慶元宵〉（U+2AE5A）
    是 7 個碼點 / 8 個 UTF-16 單位。兩種索引混用就是 #3175 整串位移的形狀，
    所以產表、槽位、poly 的位置**一律**用這一種。

    代理對會被切成兩半（各自不是合法字元），它們在字型表裡查不到、
    也不可能等於任何要裁決的字，所以只是佔位，不影響選擇。
    """
    out: list[str] = []
    for ch in text:
        if ord(ch) > 0xFFFF:
            enc = ch.encode("utf-16-le")
            out.append(enc[0:2].decode("utf-16-le", "surrogatepass"))
            out.append(enc[2:4].decode("utf-16-le", "surrogatepass"))
        else:
            out.append(ch)
    return out


_SERVED_CACHE: dict | None = None


def _served_lessons() -> dict:
    """uid -> 伺服器真的送出去的那份 lesson dict。

    ⛔ 用 `build_all_lessons()`（`/api/stories/{id}` 走的同一支），**不是**再走一遍 yml。

    2026-09-16 實測：產生器原本自己走 yml，跟伺服器組課文的方式不一樣 ——
    179 課裡有 **28 處服務端送出去的文字不在表裡**（L0157 服務 10 段、表只有 5 段；
    L0020/L0097/L0119 的 key_reading 被前端按 `\n` 切行，而表存的是整段），
    那 28 處全部靜靜走舊選擇器。窮舉法的前提是「表的 key 就是消費端會拿的字串」，
    所以 key 只能從服務端來。
    """
    global _SERVED_CACHE
    if _SERVED_CACHE is None:
        sys.path.insert(0, str(BACKEND))
        from app.services.lesson_indexes import build_all_lessons  # noqa: PLC0415
        _SERVED_CACHE = {L["lesson_uid"]: L for L in build_all_lessons() if L.get("lesson_uid")}
    return _SERVED_CACHE


_CJK = re.compile(r"[\u3400-\u9fff\uf900-\ufaff]")

# 不收的 key：URL／檔名／代號 —— 它們不會被畫注音，收了只是讓表變大
_SKIP_KEYS = {
    "thumbnail_url", "knowledge_video_url", "worksheet_docx_url", "worksheet_pdf_url",
    "source_file", "lesson_uid", "slug", "id", "grade_code", "text_ref",
}

# 內部審查用的散文（reviewer 寫給 reviewer 的）—— 學生介面不會渲染它，
# 收進表只是讓表大 12%。⚠️ 這是**唯一**的白名單式排除；內容欄位一律遞迴全收，
# 因為「列得出來的欄位」那條路的失敗模式就是每加一個元件就多一個漏洞。
_INTERNAL_KEY = re.compile(
    r"(answer_note|_note$|^notes$|^qa|review|errata|provenance|evidence|rationale"
    r"|verdict|audit|debug|todo|comment)", re.I)
_MAX_LEN = 1200


def collect_served_texts(uid: str) -> list[dict]:
    """服務端這一課**可能交給前端畫注音的每一個中文字串**。

    ## 為什麼是「遞迴收整份」而不是列幾個欄位

    `useZhuyin()` 有 19 個消費端，它們餵進去的不只課文段落：

        CharacterPractice      processZhuyin(currentChar)        單字
        Intro                  processZhuyin(story.title)        課名／目標框標題／策略名
        MultipleChoiceExercise processZhuyin(text)               題幹與選項
        FillInBlankExercise / VocabDefinitionMatch / VocabWordSearch /
        SentencePractice / ListeningPractice                     生詞、釋義、題目、提示

    2026-09-16 實測：表只涵蓋 6 種課文表面（1,861 個字串、100% 命中），
    上面這十幾種**一個都不在表裡**，全部靜靜走舊的執行期選擇器 ——
    也就是同一個字在課文裡跟在選項裡可能讀不一樣，而那正是 #3224 家長回報的那個症狀。

    所以窮舉的單位不是「我列得出來的欄位」，是**服務端這份 dict 裡的每一個中文字串**。
    列欄位這條路走過了，它的失敗模式是「每次有人加一個新元件就悄悄多一個漏洞」。

    含整串與按 `\n` 切出的每一行（`processZhuyin` 傳整串、`processLines` 傳行）。
    """
    L = _served_lessons().get(uid)
    if not L:
        return []

    found: dict[str, str] = {}   # text -> 第一次看到它的路徑（當 section 標籤用）

    def walk(node, path: str, depth: int = 0) -> None:
        if depth > 8:
            return
        if isinstance(node, str):
            if node.strip() and len(node) <= _MAX_LEN and _CJK.search(node):
                found.setdefault(node, path)
                if "\n" in node:
                    for line in node.split("\n"):
                        if line.strip() and _CJK.search(line):
                            found.setdefault(line, path + "#line")
        elif isinstance(node, dict):
            for k, v in node.items():
                if k in _SKIP_KEYS or _INTERNAL_KEY.search(str(k)):
                    continue
                walk(v, f"{path}.{k}" if path else str(k), depth + 1)
        elif isinstance(node, list):
            for n, v in enumerate(node):
                walk(v, f"{path}[{n}]", depth + 1)

    walk(L, "")
    return [{"section": f"served:{p}", "slug": None, "idx": None, "text": t}
            for t, p in found.items()]


def build_bundle(required: bool = True) -> Path | None:
    """打包出貨的 processor。⛔ 不移植邏輯 —— import 真的那個 class。

    `required=False` 時找不到 esbuild 回 `None`（`--check` 在 CI 沒有
    `frontend/node_modules`，見 `main()` 裡兩段式檢查的說明）。
    """
    esbuild = FRONTEND / "node_modules" / ".bin" / "esbuild"
    if not esbuild.exists():
        if not required:
            return None
        sys.exit(f"找不到 {esbuild} —— 先在 frontend/ 跑 npm ci")
    out = Path(tempfile.mkdtemp()) / "runner.cjs"
    subprocess.run([str(esbuild), str(RUNNER_TS), "--bundle", "--platform=node",
                    "--format=cjs", "--loader:.json=json", f"--outfile={out}"],
                   check=True, capture_output=True, cwd=FRONTEND)
    return out


def run_oracle(bundle: Path, items: list[dict]) -> dict[str, list]:
    with tempfile.TemporaryDirectory() as td:
        tin, tout = Path(td) / "i.json", Path(td) / "o.json"
        tin.write_text(json.dumps([{"key": str(n), "text": i["text"]}
                                   for n, i in enumerate(items)]), encoding="utf-8")
        # ⛔ 不用 check=True + capture_output 直接吞掉 —— runner 的對齊守衛
        #    （非 BMP 字會讓碼點數 != UTF-16 單位數）是 `exit 3` 並把
        #    「長度不符 key=… 輸出 N vs 原文 M」寫到 stderr，而 CalledProcessError
        #    的 str(e) **不含那段訊息**，操作者只會看到一段 Python traceback。
        #    2026-09-15 實測：`〈𪹚龍慶元宵〉`（U+2AE5A，已經是 L0001 的課名）會觸發。
        proc = subprocess.run(["node", str(bundle), str(tin), str(tout)],
                              cwd=FRONTEND, capture_output=True, text=True)
        if proc.returncode != 0:
            sys.stderr.write(proc.stderr or "")
            sys.exit(f"產表失敗（runner exit {proc.returncode}）—— 見上面 stderr")
        return json.loads(tout.read_text(encoding="utf-8"))


#: 「和」當連接詞的槽位（字型：0000=he2 · ss01=han4 · ss02=he4 · ss03=huo4 …）
_HE_CONJUNCTION_SLOT = "ss01"
_HE_DEFAULT_SLOT = DEFAULT_SLOT


# 教育部國語辭典（萌典 API `/uni/相`，2026-09-17 查）：
#
#   ㄒㄧㄤ   [副] 交互，兩方面都進行 —— 互相、守望相助、兩地相思、相得益彰
#            [副] 彼此，強調雙方比較後的差異 —— 相異、相像、旗鼓相當
#            [助] 由交互演變為單方面 —— 有事相煩、實不相瞞
#   ㄒㄧㄤˋ  [動] 審視／占視／輔佐／掌管／挑選 —— 相字、相夫教子、相人
#            [名] 容貌 —— 長相、福相、吃相；相片／相機／照相；宰相／丞相／首相
#
# ⭐ 關鍵結構：**ㄒㄧㄤˋ 是封閉集，ㄒㄧㄤ 是預設**。所以裁決只要列得出 ㄒㄧㄤˋ 的詞，
# 其餘一律 ㄒㄧㄤ —— 不必窮舉交互義那條長尾（那條尾巴沒有頭：相信/相同/相處/相關/
# 相反/相符/相向/相覷/相看/相悖/相爭/相棄/相及/相視/相謂…）。
#
# 出貨 processor 對這個字的錯誤是系統性的：全庫 1,301 個「相」裡有 **38 處**
# 把交互義讀成 ㄒㄧㄤˋ（環環相扣 ×6、互不相讓 ×3、爭相報導 ×2、遠來相視 ×8、
# 賊相謂曰 ×3、餓餒相及 ×3、於是相隨往 ×2、相違背／相傳／互相獨立／兩相宜／
# 自相矛盾／相悖／相爭／相棄／花色相同／將相關 各 1–2 處）。
#
# ⛔ 為什麼是裁決層而不是 38 筆 `lesson_corrections.json`：
#    手工修正綁在「課文 sha + 位置」上，課文一動就過期，而這 38 處分佈在 17 課、
#    同一句還會在 spotlight／word_matching／sentence_matching／選項各出現一份。
#    規則層會自己跟著課文走。同 `_adjudicate_he()` 的既有作法。
#
# ⚠️ 封閉集裡每一筆都必須是「相」在詞中位置固定、不會跨詞界誤命中的。
#    第一版我放了 `出相`／`面相`／`福相`，結果誤命中 **37 處**本來就正確的
#    「找出+相同」「面面+相覷」「禍福+相倚」—— 那三筆已移除。
_XIANG4_WORDS = (
    # 容貌
    "長相", "吃相", "窘相", "窮酸相", "睡相", "站相", "坐相", "醜相", "怪相", "傻相",
    # 影像
    "相片", "相簿", "相機", "照相", "相館", "相框",
    # 官職
    "宰相", "丞相", "首相", "相位", "相國", "相爺", "拜相", "相夫教子", "相不賢",
    # 其他名詞/動詞義
    "真相", "月相", "亮相", "相人", "相字", "相馬", "相術", "相士", "相命", "相貌",
    "相聲", "露相",
)
_XIANG_DEFAULT_SLOT = "ss01"   # ㄒㄧㄤ（交互／彼此／單方面動作）
_XIANG4_SLOT = "0000"          # ㄒㄧㄤˋ（審視／容貌／宰相／照相）


def _xiang4_at(units: list[str], i: int) -> str | None:
    """位置 i 的「相」是不是落在 ㄒㄧㄤˋ 封閉集的某個詞裡。

    ⛔ 吃的是 **UTF-16 單位的 list**，不是原字串 —— `i` 是 UTF-16 位移，
    拿它去索引 Python 字串（碼點）在含非 BMP 字的段落會整串位移。
    第一版就是這樣寫的，結果 L0001 的 `相傳「炸龍」`（同段有 𪹚 U+2AE5A）
    與 L0075 的 `兩條互相獨立` 兩處**沒被裁決到** —— 比對落在錯的位置上。
    這個索引坑在這次改動裡咬了第三次，所以這裡只收 list、不收 str。
    """
    for w in _XIANG4_WORDS:
        k = w.index("相")
        s = i - k
        if s >= 0 and "".join(units[s:s + len(w)]) == w:
            return w
    return None


def _adjudicate_xiang(text: str, ss: list) -> tuple[list, int]:
    """「相」的讀音：ㄒㄧㄤˋ 是封閉集，其餘一律 ㄒㄧㄤ（見上方說明）。"""
    units = u16_chars(text)
    out, changed = list(ss), 0
    for i, ch in enumerate(units):
        if ch != "相":
            continue
        want = _XIANG4_SLOT if _xiang4_at(units, i) else _XIANG_DEFAULT_SLOT
        if out[i] != want:
            out[i] = want
            changed += 1
    return out, changed


def _adjudicate_he(text: str, ss: list) -> tuple[list, int]:
    """「和」的讀音由 `he_conjunction`（jieba 斷詞 + 380 筆教育部例外）裁決，不由樣式表。

    ## 為什麼這一層非有不可（2026-09-15 對抗式複審實測，26 個已驗位置）

    出貨的 processor 靠樣式比對判「和」，而 `services/he_conjunction.py` 用三道門
    （jieba 斷詞、380 筆教育部例外清單、和自我指稱檢查）—— 後者明顯較準：

      表錯（processor 標成 ㄏㄢˋ，實際是 ㄏㄜˊ）：
        L0140「跟他達到一個和解」×3 · L0059「耶和華我的力量」
        兩者都在 `data/tts/he_exceptions.json` 的 380 筆裡

      表漏（該是 ㄏㄢˋ 卻給 ㄏㄜˊ）22 處，全是「和」的鄰居是標點／數字／拉丁字母，
      樣式對不到但 jieba 對得到：
        L0063「供給」和「需求」 · L0012《灌籃高手》和《好小子》 · L0150 2018和2022年

    ## 規則（雙向）

      在 he_positions        → ss01（ㄏㄢˋ）
      不在 且 processor 給 ss01 → 0000（ㄏㄜˊ）—— ㄏㄢˋ **只有**連接詞這一個用法
      其餘                   → 照 processor（一唱一和 ㄏㄜˋ=ss02、和麵 ㄏㄨㄛˋ=ss03 不受影響）

    ⚠️ fail-open：jieba 或例外清單載不到就回原樣（跟這一層不存在時相同）。
    標錯讀音比漏標嚴重。
    """
    if "和" not in text:
        return ss, 0
    try:
        sys.path.insert(0, str(BACKEND))
        from app.services.he_conjunction import _he_conjunction_positions

        he = _he_conjunction_positions(text)
    except Exception:
        return ss, 0
    out, changed = list(ss), 0
    for i, ch in enumerate(u16_chars(text)):
        if ch != "和":
            continue
        if i in he:
            want = _HE_CONJUNCTION_SLOT
        elif out[i] == _HE_CONJUNCTION_SLOT:
            want = _HE_DEFAULT_SLOT
        else:
            continue
        if out[i] != want:
            out[i] = want
            changed += 1
    return out, changed


def _load_corrections(uid: str) -> list[dict]:
    """這一課的人工修正（`backend/data/zhuyin/lesson_corrections.json`）。

    ## 為什麼需要這一層

    出貨的 processor 是樣式比對，會**跨詞界誤命中**：「大量的時間|接受訓練」裡的
    `時間` 被當成 `間接`（教育部：時間 ㄕˊ ㄐㄧㄢ、間接 ㄐㄧㄢˋ ㄐㄧㄝ）。

    那不是 processor 的 bug，是樣式表的固有限制。**「逐課客製化」的意思就是這種個案
    直接在內容層改掉，不回去動樣式** —— 動樣式會弄壞別的詞（方大哥在 `人*`／`福*`／
    `多*` 上踩過四次，每次都是修 A 弄壞 B）。

    ⛔ 每一筆要有 `source`（教育部辭典或其他權威）。
    """
    if not CORRECTIONS.is_file():
        return []
    try:
        doc = json.loads(CORRECTIONS.read_text(encoding="utf-8"))
    except Exception as e:
        sys.exit(f"修正表讀不起來：{e}")
    return [c for c in doc.get("corrections") or [] if c.get("lesson_uid") == uid]


def _apply_corrections(uid: str, texts: list[dict], corrections: list[dict],
                       font_slots: dict) -> int:
    """套用修正。⛔ 對不上就 `exit 1`，不靜靜跳過 —— 課文改了要有人知道。

    ## `expect_bopomofo` 必須被驗（2026-09-15 對抗式複審抓到）

    Gate 11（`--check`）比的是「磁碟 vs 重新產生」，所以**修正表本身寫錯的 slot
    會被一致地套進兩邊，`--check` 照樣 exit 0**。複審把一筆修正的 slot 改壞，
    Gate 11 完全沒反應。

    修正表裡本來就存了 `expect_bopomofo`（人寫修正時對照教育部查的那個讀音），
    但我從來沒驗它 —— 那是個現成的可檢查矛盾：**slot 對應的字型讀音必須等於
    `expect_bopomofo`**。驗了之後，改壞 slot 會在產表當下就 exit 1。
    """
    applied = 0
    for c in corrections:
        # ⛔ 用 **sha 定位**，不用 `(section, idx)` —— 一課多篇時 idx 會重複，
        #    `next(...)` 會挑到第一個，可能是**別一篇**的同號段落（實測 18 課會撞）。
        want_sha = c.get("text_sha256_prefix")
        hits = [t for t in texts
                if hashlib.sha256(t["text"].encode("utf-8")).hexdigest()[:12] == want_sha]
        if len(hits) != 1:
            sys.exit(f"修正過期：{uid} 用 sha {want_sha} 找到 {len(hits)} 段"
                     f"（要剛好 1 段）—— 課文變了或這筆修正該重新確認")
        target = hits[0]
        i = c["i"]
        if i >= target["n"] or target["text"][i] != c["c"]:
            sys.exit(f"修正過期：{uid} i={i} 應是「{c['c']}」實際是"
                     f"「{target['text'][i] if i < target['n'] else '(超出範圍)'}」")
        # ⭐ slot 與 expect_bopomofo 必須一致 —— 這是 Gate 11 抓不到的那一類錯
        slots = font_slots.get(c["c"]) or {}
        raw = slots.get(c["slot"])
        if raw is None:
            sys.exit(f"修正無效：{uid} 的「{c['c']}」字型沒有 {c['slot']} 槽"
                     f"（有的是 {sorted(slots)}）")
        got = _to_bopomofo(raw)
        want = c.get("expect_bopomofo")
        if want and got != want:
            sys.exit(f"修正自相矛盾：{uid} 的「{c['c']}」slot={c['slot']} 在字型是 {got}，"
                     f"但 expect_bopomofo 寫 {want} —— 兩者必須一致，請重新確認要哪個讀音")
        if not want:
            sys.exit(f"修正缺 expect_bopomofo：{uid} 的「{c['c']}」—— "
                     f"每筆修正都要寫出期望讀音，否則 slot 寫錯沒有東西會發現")
        target["ss"][i] = c["slot"]
        applied += 1
    return applied


def build(uid: str, bundle: Path, font_slots: dict) -> dict:
    items = collect_texts(uid)
    slots = run_oracle(bundle, items) if items else {}
    texts = []
    poly_n = 0
    he_total = 0
    xiang_total = 0
    for n, it in enumerate(items):
        chars = u16_chars(it["text"])
        ss = slots[str(n)]
        # ⛔ 對齊守衛不可省：整張表的價值建立在「第 i 個槽位 == 原文第 i 個字」。
        #    一旦錯位，拿到的是一整份看起來合理、實際整串位移的答案（#3175 的形狀）。
        if len(ss) != len(chars):
            sys.exit(f"{uid} 長度不符：{it['section']} idx={it['idx']}")
        ss, he_changed = _adjudicate_he(it["text"], ss)
        he_total += he_changed
        ss, x_changed = _adjudicate_xiang(it["text"], ss)
        xiang_total += x_changed
        texts.append({"section": it["section"], "slug": it["slug"], "idx": it["idx"],
                      "text": it["text"], "n": len(chars), "ss": ss})

    # ── 人工修正要在算 poly **之前**套用，否則 poly[].b 會跟 ss 不同步 ──
    corrections = _load_corrections(uid)
    n_corr = _apply_corrections(uid, texts, corrections, font_slots) if corrections else 0

    # ── 只數破音字位置（統計用），不再把注音存進表 ──────────────────
    #
    # ⛔ 以前每個破音字位置都存一筆 `{"i","c","ss","b"}`（全庫 321,733 筆、15 MB），
    #    而 `b` 是 **(字, 槽位) 經由出貨字型推得出來的** —— 存一份就是第二個真相來源，
    #    而且一旦字型換版就靜靜過期。後端改成自己用 `font_slots.json` 推。
    for t in texts:
        chars = u16_chars(t["text"])
        for ch in chars:
            sl = font_slots.get(ch)
            if sl and len(sl) > 1:
                poly_n += 1

    # 槽位壓成一個字元：'.'=預設、'1'..'5'=ss01..ss05（全庫 96.9% 是預設）
    for t in texts:
        t["ssz"] = _pack_slots(t.pop("ss"))
    return {
        "lesson_uid": uid,
        "_provenance": {
            "generator": "backend/scripts/generate_lesson_zhuyin.py",
            "reading_authority": "frontend/src/components/zhuyin/polyphonicProcessor.ts（跑，非移植）",
            "source_font": str(FONT.relative_to(REPO)),
            # ⛔ 只取 16 字元。完整的 64 字元 hex 會被 repo 的 SecretSanitizer 當成
            #    API key（實測：179 個檔各誤報 AZURE OPENAI／CIRCLECI／LINODE／
            #    LINE CHANNEL SECRET，commit 被擋）。16 字元足夠辨識版本，
            #    而 provenance 要回答的是「從哪個版本的字型/資料推出來的」。
            #    同族前科：40 字元的 git SHA 也會觸發。
            "font_sha256_16": hashlib.sha256(FONT.read_bytes()).hexdigest()[:16],
            "poyin_db_sha256_16": hashlib.sha256(POYIN_DB.read_bytes()).hexdigest()[:16],
            "notation": "pypinyin BopomofoConverter（與 font_readings.json 同一個轉換器）",
            "stats": {"texts": len(texts), "chars": sum(t["n"] for t in texts),
                      "poly_positions": poly_n, "he_adjudicated": he_total,
                      "xiang_adjudicated": xiang_total,
                      "manual_corrections": n_corr},
            # ⛔ 不放 generated_at —— 重跑即使資料一字未變也會產生 diff，
            #    讓人看不出「資料到底變了沒」。provenance 由上面的 sha256 精確回答。
        },
        "texts": texts,
    }


def check_without_oracle(uid: str, font_slots: dict) -> list[str]:
    """不跑 node 也驗得到的四種漂移。

    ## 為什麼要有這條路

    `--check` 原本一律重跑 oracle（需要 `frontend/node_modules/.bin/esbuild`），
    但 spec CI 那個 job 是後端 only、沒有 `npm ci` → Gate 11 在 CI **一定紅**
    （2026-09-16 實測：`找不到 …/esbuild`，exit 1）。

    幫那個 job 裝整套 node 只為了一道門太重。改成兩段式：

      有 esbuild（本機 / 前端 CI）→ 重跑 oracle 逐字比（最強）
      沒有（後端 CI）             → 這條：驗四種漂移，**不是「沒驗到」**

    驗得到的：
      ① 課文改了     —— 表裡的段落集合 vs 現在 YAML 撈出來的（含逐段 sha）
      ② 字型換了     —— `_provenance.font_sha256_16` vs 現在的字型
      ③ poyin_db 改了 —— 同上
      ④ 表自己壞了   —— 槽位長度／`ss` 與 `poly` 同步／讀音在字型合法集合／修正表仍有效

    驗不到的（要 oracle）：**選擇邏輯本身變了**（processor 改了但 poyin_db 沒改）。
    那種改動一定會動到 `frontend/src/components/zhuyin/`，而那條路徑會觸發前端 CI。
    """
    errs: list[str] = []
    p = out_path(uid)
    if not p.is_file():
        return [f"{uid} 沒有 zhuyin.json"]
    try:
        doc = json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        return [f"{uid} zhuyin.json 讀不起來：{e}"]

    prov = doc.get("_provenance") or {}
    if prov.get("font_sha256_16") != hashlib.sha256(FONT.read_bytes()).hexdigest()[:16]:
        errs.append(f"{uid} 字型變了（表是用舊字型產的）")
    if prov.get("poyin_db_sha256_16") != hashlib.sha256(POYIN_DB.read_bytes()).hexdigest()[:16]:
        errs.append(f"{uid} poyin_db 變了（表是用舊樣式表產的）")

    # ① 課文：用**文字本身**當 key，跟執行期一致（`lesson_zhuyin_table` 就是 text → readings）
    #
    # ⛔ 不可以用 `(section, idx)` 當 key —— **一課多篇時 idx 會重複**
    #    （同一個 `paragraphs` 陣列裡每篇各自從 1 編號）。實測 18 課有重複，
    #    L0063 有 3 份，用 dict 當集合會把它們collapse 成一筆 →
    #    多篇課的前幾篇過期了這道門照樣綠。
    want = Counter(i["text"] for i in collect_texts(uid))
    got = Counter(t["text"] for t in doc.get("texts") or [])
    if want != got:
        missing = [t[:20] for t in (want - got)][:3]
        extra = [t[:20] for t in (got - want)][:3]
        errs.append(f"{uid} 課文集合不符（表缺 {missing} · 表多 {extra}）")

    # ④ 表自己的內部一致性
    for t in doc.get("texts") or []:
        units = u16_chars(t.get("text") or "")
        ss = unpack_slots(t.get("ssz") or "")
        # ⛔ 不可以寫成 `a != b != c` —— Python 的鏈式比較等於 `(a != b) and (b != c)`，
        #    所以「槽位長度錯但 n == len(text)」時整句是 False，**這道門是空的**。
        # ⛔ 長度一律用 UTF-16 單位（#3230）—— `len(text)` 是碼點，非 BMP 會差一格
        if not (len(ss) == t.get("n") == len(units)):
            errs.append(f"{uid} {t['section']} idx={t['idx']} 槽位/字數對不上")
            continue
        # 每一個破音字位置的槽位，都要是那個字在字型裡真的有的槽位
        #（#3230 之後表不存注音了，所以這裡驗的是「槽位合法」而不是「注音對得上」——
        #  注音由 `font_slot_readings.json` 推，那一份的同步由 main() 自己比對）
        for i, ch in enumerate(units):
            slots = font_slots.get(ch)
            if not slots or len(slots) == 1:
                continue
            if ss[i] not in slots:
                errs.append(f"{uid} {t['section']} i={i}「{ch}」的槽位 {ss[i]} 不在字型裡")

    # ⭐ 修正的**筆數**要對得上表自己記的 provenance（#3238 補的洞）。
    #
    # ⛔ 原本這道門只驗「還在的修正有沒有被套用」——**刪掉一筆是隱形的**：
    #    表沒重產，被修正過的槽位還在，於是沒有任何東西發現支撐它的那筆修正不見了，
    #    下一次重產就會靜靜把它改回錯的讀音。
    #    （2026-09-17 實測：拿掉 7 筆「和」的修正，這條路回綠。）
    n_now = len([c for c in _load_corrections(uid)])
    n_recorded = ((doc.get("_provenance") or {}).get("stats") or {}).get("manual_corrections")
    if n_recorded is not None and n_now != n_recorded:
        errs.append(
            f"{uid} 修正筆數不符：現在 {n_now} 筆，表記 {n_recorded} 筆 —— "
            f"有人加了或刪了修正而沒重產表")

    # 修正表仍有效（slot ↔ expect_bopomofo ↔ 課文位置）
    for c in _load_corrections(uid):
        # ⛔ 用 **sha 定位**，跟 `_apply_corrections()` 同一種方式（#3238）。
        #    這裡原本用 `(section, idx)` —— 而 `served:*` 的 section 會同名
        #    且 `idx` 是 `None`（同一段的整串與逐行版本），`next(...)` 挑到第一個，
        #    於是 sha 對不上、報成「課文變了」。兩條路的定位方式不一致本身就是 bug：
        #    產表那條用 sha，這條用 (section, idx)，改了一邊沒改另一邊。
        want_sha = c.get("text_sha256_prefix")
        hits = [x for x in doc.get("texts") or []
                if hashlib.sha256(x["text"].encode("utf-8")).hexdigest()[:12] == want_sha]
        if len(hits) != 1:
            errs.append(f"{uid} 修正過期：用 sha {want_sha} 找到 {len(hits)} 段（要剛好 1 段）")
            continue
        t = hits[0]
        got = unpack_slots(t.get("ssz") or "")[c["i"]]
        if got != c["slot"]:
            errs.append(f"{uid} 修正沒被套用：i={c['i']} 表是 {got} 但修正說 {c['slot']}")
    return errs


def out_path(uid: str) -> Path:
    return _vdir(uid) / "zhuyin.json"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("uids", nargs="*", help="課號（例 L0001）；不給就是全部")
    ap.add_argument("--check", action="store_true", help="只比對不寫入，不同步回 exit 1")
    args = ap.parse_args()

    uids = args.uids or lesson_uids()
    # `--check` 在沒有 esbuild 的環境（後端 CI）走 check_without_oracle，
    # 不是「沒驗到」—— 見那支函式的 docstring。
    bundle = build_bundle(required=not args.check)
    font_slots = _load(EXTRACTOR, "extract_font_readings").build_reading_table(str(FONT))

    # ── 槽位 → 注音 的對照，寫成一份給後端用（#3230）────────────────────
    #
    # 以前每一課的表裡每個破音字位置都存一份注音（全庫 321,733 筆 / 15 MB），
    # 而那個注音是 **(字, 槽位) 經由出貨字型推出來的** —— 存進 179 個檔就是
    # 179 份會各自過期的副本。改成只存這一份（約 100 KB），後端自己查。
    slot_map = {
        ch: {sl: _to_bopomofo(raw) for sl, raw in (slots or {}).items() if raw}
        for ch, slots in font_slots.items() if slots and len(slots) > 1
    }
    slot_path = BACKEND / "data" / "zhuyin" / "font_slot_readings.json"
    slot_doc = {
        "_provenance": {
            "generator": "backend/scripts/generate_lesson_zhuyin.py",
            "source_font": str(FONT.relative_to(REPO)),
            "font_sha256_16": hashlib.sha256(FONT.read_bytes()).hexdigest()[:16],
            "notation": "pypinyin BopomofoConverter（與 font_readings.json 同一個轉換器）",
            "note": "破音字的 槽位→注音。單音字走 font_readings.json 的 single。",
        },
        "slots": slot_map,
    }
    slot_body = json.dumps(slot_doc, ensure_ascii=False, separators=(",", ":")) + "\n"
    if args.check:
        if not slot_path.exists() or slot_path.read_text(encoding="utf-8") != slot_body:
            print("✗ font_slot_readings.json 與出貨字型不同步 —— 重跑產生器", file=sys.stderr)
            return 1
    else:
        slot_path.write_text(slot_body, encoding="utf-8")

    if args.check and bundle is None:
        errs: list[str] = []
        for uid in uids:
            errs.extend(check_without_oracle(uid, font_slots))
        if errs:
            print(f"✗ {len(errs)} 個問題（前 10）：", file=sys.stderr)
            for e in errs[:10]:
                print(f"  {e}", file=sys.stderr)
            print("  → python3 backend/scripts/generate_lesson_zhuyin.py", file=sys.stderr)
            return 1
        print(f"✓ {len(uids)} 課的表與課文/字型/poyin_db 同步（結構檢查；"
              f"沒有 esbuild 所以沒重跑 oracle —— 選擇邏輯本身的改動由前端 CI 擋）")
        return 0

    stale, total = [], {"texts": 0, "chars": 0, "poly_positions": 0, "he_adjudicated": 0,
                        "xiang_adjudicated": 0, "manual_corrections": 0}
    for uid in uids:
        doc = build(uid, bundle, font_slots)
        # ⛔ 緊湊輸出（#3230）。`indent=1` 時光是縮排就佔 24 MB / 53 MB ——
        #    這些是**產生出來的資料檔**，沒有人手改，可讀性由 `--check` 與
        #    逐課 TDD 負責，不靠縮排。要看內容用 `python -m json.tool`。
        body = json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n"
        p = out_path(uid)
        for k, v in doc["_provenance"]["stats"].items():
            total[k] += v
        if args.check:
            if not p.exists() or p.read_text(encoding="utf-8") != body:
                stale.append(uid)
        else:
            p.write_text(body, encoding="utf-8")

    if args.check:
        if stale:
            shown = " ".join(stale[:20]) + (" …" if len(stale) > 20 else "")
            print(f"✗ {len(stale)} 課的注音表與現在的課文/字型/poyin_db 不同步：",
                  file=sys.stderr)
            print(f"  {shown}", file=sys.stderr)
            print("  → python3 backend/scripts/generate_lesson_zhuyin.py", file=sys.stderr)
            return 1
        print(f"✓ {len(uids)} 課同步 · {total['poly_positions']:,} 個破音字位置")
        return 0

    print(f"✓ {len(uids)} 課 · {total['texts']:,} 段 · {total['chars']:,} 字 "
          f"· 破音字位置 {total['poly_positions']:,}"
          f"· 「和」裁決改掉 {total['he_adjudicated']:,} 處"
          f"· 「相」裁決改掉 {total['xiang_adjudicated']:,} 處"
          f"· 人工修正 {total['manual_corrections']} 筆")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
