#!/usr/bin/env python3
"""
文字寶貝養成系統 — 決定性產生 babies.json / fragments.json / encounters.json / care.json

跑法：
    cd docs/design/word-babies && python3 generate_config.py

⛔ 全程不用 random.random()、不呼叫 LLM —— 只用 wb_common 的決定性雜湊。
跑兩次（甚至換一台機器跑）只要 `backend/data/lessons/` 內容沒變，結果必須逐位元組相同。
輸出的四份 JSON 是「設計草案」，是給 Young 看、可以手改的起點，不是最終鎖死的正式表。
"""

from __future__ import annotations

import glob
import json
import re
from pathlib import Path

import yaml

from wb_common import SEED, pick_index, sort_key, unit_interval

REPO_ROOT = Path(__file__).resolve().parents[3]
VOCAB_GLOB = str(REPO_ROOT / "backend" / "data" / "lessons" / "*" / "v3" / "vocab_definitions.*.yml")
MANIFEST_GLOB = str(REPO_ROOT / "backend" / "data" / "lessons" / "*" / "v3" / "_manifest.yml")
OUT_DIR = Path(__file__).resolve().parent

# ---------------------------------------------------------------------------
# 1. 稀有度表（對應 design.md §3）
# ---------------------------------------------------------------------------
# diet_size：這個稀有度的寶貝吃幾種碎片口味家族
# stage_count：3~5 個進化姿態（Young 原話：「一隻通常有 3~5 種進化姿態」）
# forces_classical：必須把「文言文」排進牠的飲食（文言文口味全平台最稀少，見 §4）
#
# 2026-10-26 team-lead 第二輪決定（見 design.md §13 回覆）：
#   1) 史詩／傳說的 diet_size 從 1 改成 2（「文言文 + 1 種常見口味」），
#      稀有度不再靠「只吃文言文」疊加第二層稀缺，單靠遭遇機率把關
#   2) 常見／少見的遭遇機率下調，讓「抓到但沒碎片可餵」的隊伍不要一直堆大
RARITY_TABLE = {
    "common":    {"zh": "常見",  "count": 40, "diet_size": 3, "stage_count": 3, "forces_classical": False, "base_encounter_rate": 0.028},
    "uncommon":  {"zh": "少見",  "count": 30, "diet_size": 2, "stage_count": 3, "forces_classical": False, "base_encounter_rate": 0.012},
    "rare":      {"zh": "稀有",  "count": 18, "diet_size": 1, "stage_count": 4, "forces_classical": False, "base_encounter_rate": 0.008},
    "epic":      {"zh": "史詩",  "count": 9,  "diet_size": 2, "stage_count": 4, "forces_classical": True,  "base_encounter_rate": 0.0025},
    "legendary": {"zh": "傳說",  "count": 3,  "diet_size": 2, "stage_count": 5, "forces_classical": True,  "base_encounter_rate": 0.0005},
}
assert sum(r["count"] for r in RARITY_TABLE.values()) == 100

# 每個階段要吃幾片「正確口味」碎片才完成（含最終型態那一階，象徵性收尾）——
# 2026-10-26 改成「每階段直接給一個數字」，不再用「子等級 × 每級片數」的公式算，
# 因為那個公式在供需試算裡會把需求越乘越大（詳見 design.md §11 的重新調校說明）。
#
# 2026-10-26 第三輪調校（team-lead 決定）：32 隻裡 31 隻全破，違反「要有很難搜集的，
# 或是很簡單的」——難度要「依稀有度分層」，不是全部都簡單。常見不動（它本來就該簡單），
# 少見/稀有/史詩/傳說依序拉高，讓「稀有度」這個軸同時管「抓不抓得到」跟「養不養得起」，
# 不是只靠遭遇機率。數字本身是依 §11 的分層目標（常見全破／少見約半數全破／稀有多半停在
# 第 2~3 階段／史詩傳說一學期內多半還在前兩階段）反覆試跑 `simulate_balance.py` 校出來的。
STAGE_COSTS_BY_RARITY = {
    "common":    [1, 2, 2],
    "uncommon":  [3, 4, 5],
    "rare":      [2, 3, 4, 5],
    "epic":      [2, 3, 3, 4],
    "legendary": [2, 3, 4, 5, 5],
}
for _rarity, _cfg in RARITY_TABLE.items():
    assert len(STAGE_COSTS_BY_RARITY[_rarity]) == _cfg["stage_count"], _rarity

# 史詩／傳說吃兩種口味（文言文 + 1 種常見口味），但文言文全平台供給只有 47 個站——
# 拉高牠們的整體碎片成本（上面那張表）來製造難度時，如果兩種口味平分成本（各一半），
# 文言文那一半需求會乘上 9 隻史詩+3 隻傳說，直接把全平台文言文供給打穿（第三輪第一次
# 嘗試就是這樣翻車：供需比掉到 0.21~0.51）。解法：**文言文只收一個很小的固定配額**，
# 難度的大部分（拉高的那一截）改讓「配對到的常見口味」去扛——反正常見口味供給充足，
# 扛得住；文言文只要象徵性地「牠的飲食裡真的有文言文」就好，不需要靠它撐住大部分成本。
# 數字 = 每階段文言文配額（list 長度 = stage_count，最後一階故意不收文言文配額，
# 全部交給常見口味，因為最終型態的「轉大人」階段象徵牠已經消化完文言文的養分）。
CLASSICAL_CAP_BY_RARITY = {
    "epic": [1, 1, 1, 0],
    "legendary": [1, 1, 1, 1, 0],
}

# 休眠要「有效照顧天數」累積到這個數字才孵化（依稀有度，後面階段更久）——
# 第三輪調校後改用「時間」當主要的分層槓桿，不是「碎片量」：碎片成本小幅拉高即可
# （拉太高會跟 §11 的供需比互相拉扯，供需比是全平台終生總量，碎片成本每提高一點，
# 全部 100 隻的總需求就乘上 100 倍放大，很快就把供給打穿；休眠天數不影響供需比，
# 只影響「一學期內走不走得完」，所以拿它當分層的主力）。
# 一學期 = 126 天。少見 2 次休眠疊起來 10+11=21 天／稀有 3 次 20+21+22=63 天／
# 史詩 3 次 30+31+32=93 天／傳說 4 次 40+41+42+43=166 天——傳說單是休眠天數
# 就超過一整學期，不管碎片給得多快都不可能在一學期內走完整條進化線。
BASE_HATCH_DAYS = {"common": 3, "uncommon": 18, "rare": 35, "epic": 45, "legendary": 40}

STAGE_NAME_TEMPLATES = {
    3: ["小寶", "中寶", "大寶"],
    4: ["小寶", "中寶", "大寶", "真寶"],
    5: ["小寶", "中寶", "大寶", "珍寶", "傳說寶"],
}

# ---------------------------------------------------------------------------
# 2. 碎片口味家族 ← 對應 PRD §5.1 的 15 種站（建築）
# ---------------------------------------------------------------------------
# 「module」是 backend/data/lessons/*/v3/_manifest.yml 裡 sections[].module 的真實值，
# 用來從真實課程資料反推每課實際有哪些站（給 simulate_balance.py 用）。
# 「station」是 PRD §5.1 的站 id（給 design 文件/未來實作對照用）。
STATION_TABLE = [
    # module,                station,                          建築,       flavor
    ("lesson_intro",         "lesson-intro",                   "港口燈塔", "朗讀表達"),
    ("key_reading",          "key-passage-reading",             "回音劇場", "朗讀表達"),
    ("full_text_annotate",   "full-text-annotate",              "書卷長廊", "書寫紀錄"),
    ("writing_practice",     "report",                          "星空瞭望台", "書寫紀錄"),
    ("vocab_definitions",    "vocab-definition",                "字源館",   "語文基礎"),
    ("vocab_review",         "vocab-review",                    "精靈牧場", "語文基礎"),
    ("vocab_application",    "vocab-application",               "工匠作坊", "語文基礎"),
    ("resources",            "knowledge-station",               "樹屋補給站", "語文基礎"),
    ("intro_guide",          "knowledge-station",               "樹屋補給站", "語文基礎"),
    ("keypoints",            "keypoints-table",                 "地圖塔",   "閱讀理解"),
    ("comprehension",        "comprehension",                   "謎題神殿", "閱讀理解"),
    ("spotlight",            "spotlight",                       "聚光閣",   "閱讀理解"),
    ("classical_text",       "classical-text",                  "原文閣",   "文言文"),
    ("modern_translation",   "classical-text",                  "原文閣",   "文言文"),
    ("sentence_matching",    "classical-sentence-matching",     "對句碑林", "文言文"),
    ("word_matching",        "classical-word-matching",         "字牌亭",   "文言文"),
    ("self_challenge",       "classical-self-challenge",        "挑戰擂台", "文言文"),
]
MODULE_TO_FLAVOR = {m: flavor for m, _s, _b, flavor in STATION_TABLE}
MODULE_TO_STATION = {m: s for m, s, _b, _flavor in STATION_TABLE}

FLAVOR_FAMILIES = ["語文基礎", "閱讀理解", "朗讀表達", "書寫紀錄", "文言文"]

# 碎片掉落機率——2026-10-26 第二輪調校：拉高到能讓全部 5 個口味的「全平台終生供給 vs
# 100 隻全部養到頂需求」供需比都 ≥ 1（見 design.md §11 的重新調校）。文言文全平台只有
# 10/179 課有，供給天花板最低（47 個站），拉到 85% 仍是 5 個口味裡供需比最吃緊的一個。
DROP_PROBABILITY = {
    "語文基礎": 0.60,
    "閱讀理解": 0.55,
    "朗讀表達": 0.70,
    "書寫紀錄": 0.70,
    "文言文": 0.90,
}

# 休眠型態：依飲食的第一個口味家族決定（design.md §3 的主題對照）
DORMANCY_TYPE_BY_FLAVOR = {
    "語文基礎": "蛋",
    "閱讀理解": "繭",
    "朗讀表達": "蛋",
    "書寫紀錄": "繭",
    "文言文": "冬眠",
}

VOCAB_WORD_RE = re.compile(r"^[一-鿿]{2,4}$")

# ---------------------------------------------------------------------------
# G6 兒童適切文案（design.md §9）—— 2026-10-26 team-lead 第二輪決定：
# 「小孩的寵物名一律用正向或中性的詞，情緒偏負面的全部拿掉，用白名單思路重挑：
#  優先挑物品、自然、動作、正向品質。」
#
# 做法：① 原始候選詞改source（見下方 load_vocab_pool，從每課 vocab_definitions 的
# 完整生詞表撈，而不是只撈 metadata 的 10 個詞摘要，拿到更大的候選池）
# ② 只留「含至少一個物品／自然／正向品質的字，或整段含一個正向品質／動作的詞」的詞
# ③ 排除任何含負面字或負面詞的（含第二輪人工複閱追加的項目，見 design.md §9）
#
# ⚠️ 單字白名單刻意只挑「獨立存在時語意安全」的字——不是把一個正向詞拆成單字塞進去
# （那樣會把『絕望』拆成『絕』『望』，連累『寄予厚望』一起被擋，這是第一輪犯過的錯，
# 見 design.md §9 的教訓）。正向品質／動作類由於多半要兩個字才有意義，改用「整詞子字串」
# 比對，不拆單字。
NATURE_CHARS = set("風雨雲雪霜露虹霞星月日光影山水海湖河溪泉林木花草葉果樹根枝芽春夏秋冬晨昏夜潮汐鳥魚蟲蝶蜂燕雁鷹鹿兔虎龍鳳霧煙沙石岩谷峰川瀑澗潭洋島嶼岸灘野原")
OBJECT_CHARS = set("器皿甕罐壺瓶杯碗盤碟盒箱籠袋包鞋帽衣冠帶舟船橋塔樓閣殿堂屋窗簾幕帳鐘鼓琴笛簫畫卷軸燈燭爐鼎鍋筆墨紙硯印章牌鏡梳珠玉寶石")
QUALITY_CHARS = set("福樂喜美愛甜暖靜穩強壯勇智巧敏銳亮明清新鮮嫩圓滿盛旺昌興茂翠綠金銀彩艷麗俏靈活潑悠閒逸雅致妙奇趣歡笑甘蜜爽朗潔淨純真禮")

QUALITY_WORDS = [
    "成功", "勝利", "茁壯", "蛻變", "孵化", "羽化", "豐收", "豐盛", "豐富", "圓滿", "美滿", "和諧",
    "和睦", "融洽", "團結", "互助", "分享", "奉獻", "感恩", "珍惜", "愛護", "呵護", "疼愛", "寵愛",
    "喜悅", "快樂", "歡樂", "歡喜", "幸福", "甜蜜", "溫暖", "溫馨", "安穩", "安心", "平靜", "寧靜",
    "祥和", "吉祥", "如意", "順利", "亨通", "勇敢", "智慧", "聰穎", "靈巧", "機敏", "堅毅", "溫柔",
    "善良", "仁慈", "誠懇", "忠誠", "正直", "公正", "公平", "謙遜", "謙和", "謙虛", "專注", "堅定",
    "堅強", "堅持", "毅力", "耐心", "細心", "恆心", "決心", "信心", "希望", "夢想", "理想", "志向",
    "抱負", "榮耀", "光榮", "輝煌", "卓越", "優秀", "傑出", "完美", "精彩", "精湛", "精準", "高明",
    "高超", "非凡", "出色", "超群", "出眾", "頂尖", "冠軍", "名列前茅", "脫穎而出", "迎刃而解",
    "兩全其美", "自立自強", "有條不紊", "欣欣向榮", "蒸蒸日上", "日新月異", "與時俱進", "突飛猛進",
    "苦盡甘來", "否極泰來", "水到渠成", "開花結果", "心花怒放", "興高采烈", "活蹦亂跳", "朝氣蓬勃",
    "生機盎然", "欣喜若狂", "喜出望外", "鳳毛麟角", "威風凜凜", "氣勢如虹", "水滴石穿", "滴水穿石",
    "水漲船高", "哄堂大笑", "叱吒風雲",
]
ACTION_WORDS = [
    "飛翔", "奔跑", "跳躍", "探索", "尋找", "追逐", "游泳", "攀爬", "滑行", "飄盪", "搖擺", "盛開",
    "綻放", "成長", "甦醒", "養護", "守護", "陪伴", "攜帶", "迎接", "贈送", "餵食", "哺育", "展翅",
    "啟程", "出發", "冒險", "重整旗鼓", "嶄露頭角", "脫胎換骨", "遍地開花", "雲集", "花團錦簇",
]

NEG_CHARS = set(
    "死殺亡血鬼毒恐悲哭淚凶災禁跌虜讒竄懈怠沮淵咆哮孤茫愁墮困僵呆蠢笨醜髒亂吵鬧躁慌張驚嚇怕懼"
    "畏縮躲逃棄捨絕斷裂碎毀壞爛臭腐朽枯萎凋殘衰弱病傷痛苦累倦疲乏餓渴冷凍滯逝猖獗"
)
NEG_WORDS = [
    "絕望", "憤怒", "墮落", "腐敗", "衰敗", "殘破", "破碎", "斷裂", "摧毀", "毀滅", "壓迫", "詛咒",
    "瘋狂", "暴虐", "恐怖", "驚嚇", "悲慘", "痛苦", "苦悶", "怨恨", "妒嫉", "愁悵", "惆悵",
    "事與願違", "揮之不去", "匪夷所思", "不經意", "不是滋味", "強顏歡笑", "進退維谷", "顫顫巍巍",
    "結結巴巴", "坐困愁城", "面面相覷", "歸咎", "負擔", "滯留", "低潮", "低微", "側目", "命脈",
    "不可收拾", "不堪設想", "人心惶惶", "人滿為患", "作祟", "入不敷出", "危機四伏", "力不從心",
    "功敗垂成", "刻板印象", "剋星", "充耳不聞", "似是而非", "逞強", "添油加醋", "迷思", "茫然",
    "闖禍", "找碴", "逐出", "不見蹤影", "哀鴻遍野", "杳無人煙", "暗無天日", "老態龍鍾", "覆水難收",
    "雪上加霜", "殃及池魚", "羊入虎口", "虎視眈眈", "池魚之殃", "負成長", "壓力鍋", "脫韁野馬",
    "粗野陽剛", "情有可原", "帶風向", "跟風起鬨", "風險意識", "指鹿為馬", "杯水車薪", "守株待兔",
    "木訥", "根據", "秋祺", "風塵僕僕", "雜草叢生", "粉墨登場", "望穿秋水", "滄海一粟", "龍爭虎鬥",
    "排山倒海", "水來土掩", "水洩不通", "激情洋溢", "哀鴻", "猖獗",
    # 第二輪人工複閱追加（抽象不好當名字／語意偏負面或沉重，見 design.md §9 的「被拿掉的詞」表）
    "不得閒", "信以為真", "倔強", "堅持己見", "壁壘分明", "奇貨可居", "屢見不鮮", "心知肚明",
    "愛怨糾葛", "日復一日", "滿手老繭", "滿目瘡痍", "滿腹委屈", "禍福相倚", "訕笑", "自圓其說",
    "養家活口", "腦海", "詞藻優美", "追根究柢", "釐清", "鮮少", "祖靈", "開門見山", "清一色",
    "煙消雲散", "爭強鬥勝",
]


def _is_suitable_as_pet_name(word: str) -> bool:
    if any(ch in NEG_CHARS for ch in word):
        return False
    if any(bad in word for bad in NEG_WORDS):
        return False
    if any(ch in NATURE_CHARS or ch in OBJECT_CHARS or ch in QUALITY_CHARS for ch in word):
        return True
    if any(qw in word for qw in QUALITY_WORDS):
        return True
    if any(aw in word for aw in ACTION_WORDS):
        return True
    return False


def load_vocab_pool() -> list[str]:
    """掃全部 179 課的 `vocab_definitions.*.yml`（每課完整生詞表，比 metadata 的
    10 個詞摘要大很多——1,365 個候選詞），只留白名單通過的（物品／自然／動作／
    正向品質），去重。"""
    words: set[str] = set()
    for path in sorted(glob.glob(VOCAB_GLOB)):
        with open(path, encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        vd = data.get("vocab_definitions") or {}
        candidates: list[str] = []
        for item in vd.get("items") or []:
            candidates.append(str(item.get("word", "")).strip())
        for w in vd.get("vocabulary_bank") or []:
            candidates.append(str(w).strip())
        for w in candidates:
            if VOCAB_WORD_RE.match(w) and _is_suitable_as_pet_name(w):
                words.add(w)
    if len(words) < 100:
        raise RuntimeError(f"vocab pool too small after whitelist filter: {len(words)} < 100")
    return sorted(words)  # sorted = 先固定住輸入順序，排序鍵再決定最終順序


def deterministic_shuffle(items: list, tag: str) -> list:
    return sorted(items, key=lambda x: sort_key(tag, x))


def compute_flavor_station_counts() -> dict[str, int]:
    """真的掃一次全部 179 課的 `_manifest.yml`，數每個口味家族實際有幾個站。
    拿來給 build_babies() 做『供給越少的口味、越少寶貝把牠排進飲食』的加權抽樣——
    不這樣做的話，demand 會均勻落在 4 個非文言文口味上，供給卻天差地遠
    （書寫紀錄只有 174 個站，語文基礎有 625 個），任一口味的供需比都調不平
    （見 design.md §11 第二輪調校的說明）。"""
    counts: dict[str, int] = {f: 0 for f in FLAVOR_FAMILIES}
    counts["lesson-intro-bonus"] = 0  # 不使用，純防呆
    for path in sorted(glob.glob(MANIFEST_GLOB)):
        with open(path, encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        counts[MODULE_TO_FLAVOR["lesson_intro"]] += 1  # 每課必有
        for sec in data.get("sections", []):
            module = sec.get("module")
            if module in MODULE_TO_FLAVOR:
                counts[MODULE_TO_FLAVOR[module]] += 1
    del counts["lesson-intro-bonus"]
    return counts


def weighted_pick(candidates: list[str], weights: dict[str, float], k: int, tag: str) -> list[str]:
    """決定性加權抽樣（Efraimidis–Spirakis 做法）：權重越高的候選，越常被排進前 k 名。
    key = u^(1/w)，取 key 最大的 k 個（不是最小——這是標準演算法最容易弄反的地方，
    之前第一版寫成取最小，等於把權重的方向整個反過來，表現得像越稀少越容易被選中）。
    跟 deterministic_shuffle 一樣全程用 wb_common 的雜湊，不用 random。"""
    scored = []
    for c in candidates:
        u = unit_interval(tag, c)
        u = min(max(u, 1e-9), 1 - 1e-9)
        w = weights.get(c, 1.0)
        key = u ** (1.0 / w)
        scored.append((key, c))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored[:k]]


def build_babies() -> list[dict]:
    vocab_pool = load_vocab_pool()
    shuffled_names = deterministic_shuffle(vocab_pool, "name-pool")
    names = shuffled_names[:100]

    # 100 個稀有度標籤攤平成一個 list，再決定性洗牌，跟 names 對應
    rarity_labels: list[str] = []
    for rarity, cfg in RARITY_TABLE.items():
        rarity_labels.extend([rarity] * cfg["count"])
    rarity_labels = deterministic_shuffle(rarity_labels, "rarity-order")

    # 非文言文口味的「供給權重」：越稀少的口味（書寫紀錄 174 站），越少寶貝把牠排進飲食；
    # 越充裕的口味（語文基礎 625 站），越多寶貝吃牠。權重正規化成「相對書寫紀錄的倍數」，
    # 不然 1/625 這種極小指數在加權抽樣公式裡幾乎不會造成任何差異。
    flavor_station_counts = compute_flavor_station_counts()
    min_nonclassical = min(v for f, v in flavor_station_counts.items() if f != "文言文")
    diet_weight = {f: flavor_station_counts[f] / min_nonclassical
                   for f in FLAVOR_FAMILIES if f != "文言文"}

    babies = []
    for i, (name, rarity) in enumerate(zip(names, rarity_labels), start=1):
        cfg = RARITY_TABLE[rarity]
        diet_size = cfg["diet_size"]
        candidate_flavors = FLAVOR_FAMILIES[:]
        if cfg["forces_classical"]:
            diet = ["文言文"]
            remaining = diet_size - 1
            if remaining > 0:
                pool = [f for f in candidate_flavors if f != "文言文"]
                diet.extend(weighted_pick(pool, diet_weight, remaining, f"diet-extra-{name}"))
        else:
            pool = [f for f in candidate_flavors if f != "文言文"]
            diet = weighted_pick(pool, diet_weight, diet_size, f"diet-{name}")

        stage_count = cfg["stage_count"]
        stage_names = STAGE_NAME_TEMPLATES[stage_count]
        primary_flavor = diet[0]
        dormancy_type = DORMANCY_TYPE_BY_FLAVOR[primary_flavor]
        stage_costs = STAGE_COSTS_BY_RARITY[rarity]
        base_hatch = BASE_HATCH_DAYS[rarity]

        classical_caps = CLASSICAL_CAP_BY_RARITY.get(rarity)

        stages = []
        for stage_idx, stage_name in enumerate(stage_names, start=1):
            is_final = stage_idx == stage_count
            total_cost = stage_costs[stage_idx - 1]
            stage: dict = {
                "stage_index": stage_idx,
                "stage_name": stage_name,
                "fragments_to_finish_stage": total_cost,
                "is_final_stage": is_final,
                "dormancy_after_this_stage": None if is_final else {
                    "type": dormancy_type,
                    "hatch_days": base_hatch + (stage_idx - 1),
                },
            }
            if classical_caps is not None:
                # 史詩／傳說：文言文只收一個很小的固定配額，其餘全部由配對到的常見口味扛
                # （見 CLASSICAL_CAP_BY_RARITY 上面的說明），不是兩種口味平分 total_cost。
                classical_part = classical_caps[stage_idx - 1]
                common_part = total_cost - classical_part
                stage["fragments_by_flavor"] = {
                    "文言文": classical_part,
                    diet[1]: common_part,
                }
            stages.append(stage)

        babies.append({
            "id": f"wb-{i:03d}",
            "name": name,
            "rarity": rarity,
            "rarity_zh": cfg["zh"],
            "diet_flavors": diet,
            "stage_count": stage_count,
            "stages": stages,
        })
    return babies


def build_fragments() -> dict:
    return {
        "flavor_families": FLAVOR_FAMILIES,
        "station_flavor_map": [
            {"module": m, "station": s, "building": b, "flavor": f}
            for m, s, b, f in STATION_TABLE
        ],
        "drop_probability_by_flavor": DROP_PROBABILITY,
        "rule": (
            "完成一個站時，用 wb_common.unit_interval(SEED, student_id, lesson_uid, station, 'fragment') "
            "算出 0~1 的決定性數值；小於該站口味家族的 drop_probability 就掉落 1 片該口味碎片，"
            "否則這一站不產碎片。每站最多 1 片，不重複判定（idempotent：同一站只在第一次完成時判定一次，"
            "需要一張 student_station_reward_log 記錄是否已經判定過，見 schema-proposal.md）。"
        ),
        "duplicate_catch_bonus": {
            "description": "重複捕捉到已擁有的寶貝時，不產生第二隻，改發放該寶貝主要口味的碎片做為補償。",
            "bonus_fragment_count": 3,
        },
    }


def build_encounters() -> dict:
    rows = []
    for rarity, cfg in RARITY_TABLE.items():
        rows.append({
            "rarity": rarity,
            "rarity_zh": cfg["zh"],
            "base_encounter_rate_per_station": cfg["base_encounter_rate"],
        })
    total_rate = sum(cfg["base_encounter_rate"] for cfg in RARITY_TABLE.values())
    return {
        "rarity_base_rates": rows,
        "total_encounter_rate_per_station": round(total_rate, 4),
        "rule": (
            "完成一個站時，先用 wb_common.unit_interval(SEED, student_id, lesson_uid, station, 'encounter') "
            "算出 0~1 的決定性數值 r。把各稀有度的 base_encounter_rate_per_station 疊成累積區間，"
            "r 落在哪個區間就是哪個稀有度出現野生寶貝（r 超過全部區間總和 = 這站沒有遭遇，最常見的結果）。"
            "決定稀有度後，從『飲食包含這一站口味家族、且該學生還沒擁有』的寶貝裡，"
            "用 wb_common.pick_index(...) 決定性挑一隻；如果這個稀有度在這個口味下已經全部被該學生擁有，"
            "就退而求其次發放 duplicate_catch_bonus（見 fragments.json）。"
        ),
        "catch_success_note": "目前設計：只要遭遇就直接捕捉成功（不另外設『遭遇後還可能抓不到』的二次機率），理由寫在 design.md §9 的待決清單。",
    }


def build_care() -> dict:
    return {
        "care_actions": [
            "完成平台上任何一個站（任何課），會重設『所有』已擁有寶貝的照顧時鐘",
            "主動餵食某一隻寶貝，額外重設那一隻的照顧時鐘（跟上面疊加，不衝突）",
        ],
        "weaken_after_days": 5,
        "deep_sleep_after_days": 12,
        "weaken_effect": "寶貝畫面變半透明/縮回蛋殼或繭裡探頭，待機動畫變慢；不扣已累積的孵化天數，只是暫停累積",
        "deep_sleep_effect": "寶貝完全縮進休眠型態看不到本體，孵化天數進度凍結在當下數字（不會倒退、不會重置、不會消失）",
        "recovery_rule": "下一次任何 care_action 發生，立刻清除虛弱/深度沉睡狀態，孵化天數從凍結的數字繼續累積，不必重頭來過",
        "effective_day_formula": (
            "有效照顧天數 = 計算期間的日曆天數，扣掉：(a) 落在 paused_periods 裡的天數 "
            "(b) 週六週日（每週固定的安全日，不計入「沒上線」的天數，但若學生當天仍有活動一樣正常累積孵化進度）"
        ),
        "paused_periods": [
            {"name": "寒假（預設值，需跟校務行事曆核對）", "start": "--01-15", "end": "--02-20"},
            {"name": "暑假（預設值，需跟校務行事曆核對）", "start": "--07-01", "end": "--08-25"},
        ],
        "paused_periods_note": (
            "start/end 用 '--MM-DD' 格式代表『每年都套用』，年份留空由後端套用當年；"
            "寒假/暑假實際起訖應對齊各校行事曆，目前是工頭依台灣國小常見假期區間抓的預設值，"
            "上線前應跟均一/學校行事曆資料核對一次，必要時改成可設定的學期行事曆表"
        ),
    }


def main() -> None:
    babies = build_babies()
    fragments = build_fragments()
    encounters = build_encounters()
    care = build_care()

    (OUT_DIR / "babies.json").write_text(
        json.dumps({"seed": SEED, "babies": babies}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (OUT_DIR / "fragments.json").write_text(
        json.dumps({"seed": SEED, **fragments}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (OUT_DIR / "encounters.json").write_text(
        json.dumps({"seed": SEED, **encounters}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (OUT_DIR / "care.json").write_text(
        json.dumps({"seed": SEED, **care}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    by_rarity: dict[str, int] = {}
    for b in babies:
        by_rarity[b["rarity"]] = by_rarity.get(b["rarity"], 0) + 1
    print("babies by rarity:", by_rarity)
    print(f"wrote 4 json files to {OUT_DIR}")


if __name__ == "__main__":
    main()
