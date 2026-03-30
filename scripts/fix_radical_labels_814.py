#!/usr/bin/env python3
"""
Fix issue #814: 1026 形符/部件 components with label == radical char.
Strategy:
1. Use radical-meanings.json where available
2. Use comprehensive LABEL_MAP for all 387 unique bad radicals
3. Truncate to 6 chars max
"""

import json
import re

# Comprehensive label map covering all 387 bad radicals
# Sources: Unicode names, moedict definitions, educational descriptions
LABEL_MAP = {
    # ===== Strokes and abstract components =====
    "□": "方框",
    "⺀": "兩點",
    "⺈": "刀頭",
    "⺊": "卜形",
    "⺌": "小頭",
    "⺍": "小字底",
    "⺗": "心形",
    "㇆": "橫折",
    "㇉": "彎鉤",
    "㐆": "古文字形",
    "㐬": "旒形",
    "㔾": "節形",
    "㠯": "以字古形",
    "㢟": "古文形",
    "㥯": "古文形",
    "㧜": "古文形",
    "䍃": "古文字形",
    "䜌": "複雜形",
    "乀": "撇形",
    "乁": "捺形",
    "乂": "交叉",
    "乇": "依附",
    "乑": "眾人",
    "乚": "隱藏",
    "乛": "橫折",
    "丷": "八字頭",
    "乡": "鄉形",
    "亍": "行走",
    "亏": "虧形",
    "亼": "集合",
    "从": "跟隨",
    "众": "眾多人",
    "冋": "外圍",
    "冎": "骨形",
    "冏": "光亮",
    "冗": "多餘",
    "冝": "宜形",
    "冰": "冰塊",
    "凡": "一般",
    "処": "處形",
    "凶": "兇險",
    "刃": "刀刃",
    "刅": "刀傷",
    "刍": "割草",
    "劦": "合力",
    "勺": "勾取",
    "勾": "彎曲",
    "勿": "不要",
    "包": "包裹",
    "匈": "胸形",
    "卂": "飛形",
    "卄": "二十",
    "卉": "草木",
    "卌": "四十",
    "卬": "仰望",
    "卯": "卯時",
    "厃": "危形",
    "厤": "曆形",
    "厭": "厭惡",
    "叒": "桑形",
    "叚": "借形",
    "啇": "商形",
    "啚": "鄙形",
    "囟": "頭頂",
    "圣": "聖形",
    "圭": "土堆",
    "坐": "坐下",
    "執": "執持",
    "堂": "廳堂",
    "堇": "黃土",
    "壴": "鼓形",
    "夋": "行走",
    "复": "返回",
    "夬": "決斷",
    "夭": "夭折",
    "夸": "誇耀",
    "夾": "夾住",
    "妟": "安形",
    "孚": "信服",
    "宓": "安靜",
    "宛": "宛轉",
    "封": "封閉",
    "專": "專一",
    "尊": "尊貴",
    "尔": "爾形",
    "尗": "豆形",
    "尤": "特別",
    "尺": "長度",
    "尾": "尾巴",
    "屰": "逆形",
    "州": "行政區",
    "巩": "鞏固",
    "巳": "地支六",
    "巴": "緊貼",
    "帀": "圍繞",
    "帚": "掃帚",
    "帛": "絲織品",
    "幸": "幸運",
    "幾": "幾何",
    "廉": "廉潔",
    "廣": "廣大",
    "廷": "朝廷",
    "建": "建立",
    "廿": "二十",
    "开": "開形",
    "弔": "弔念",
    "弟": "弟弟",
    "彑": "彖首",
    "彔": "刻形",
    "彦": "彥才",
    "思": "思考",
    "惡": "惡劣",
    "愈": "更加",
    "戊": "天干五",
    "戌": "天干十一",
    "戎": "武器",
    "我": "自己",
    "戔": "小薄",
    "或": "或者",
    "扁": "扁平",
    "扇": "扇形",
    "故": "原因",
    "敕": "命令",
    "敝": "破舊",
    "失": "失去",
    "散": "分散",
    "斥": "斥責",
    "新": "新鮮",
    "斿": "旗遊",
    "旁": "旁邊",
    "旦": "早晨",
    "旨": "旨意",
    "早": "早晨",
    "昌": "昌盛",
    "昔": "過去",
    "昜": "陽光",
    "星": "星星",
    "暴": "暴力",
    "更": "更換",
    "有": "擁有",
    "朕": "自稱",
    "朝": "朝代",
    "术": "樹形",
    "朿": "刺形",
    "条": "條形",
    "東": "東方",
    "果": "果實",
    "枼": "葉形",
    "柰": "奈何",
    "桼": "漆形",
    "梁": "橋梁",
    "樂": "音樂",
    "欲": "慾望",
    "正": "正確",
    "步": "行走",
    "武": "武術",
    "歰": "澀形",
    "死": "死亡",
    "毄": "擊形",
    "永": "永遠",
    "氿": "泉形",
    "淮": "水名",
    "湯": "熱水",
    "炏": "火形",
    "烏": "烏鴉",
    "烕": "滅形",
    "烝": "蒸形",
    "無": "沒有",
    "爫": "爪形",
    "爯": "稱形",
    "爰": "援引",
    "猋": "狗群",
    "玨": "雙玉",
    "珀": "琥珀",
    "珤": "寶形",
    "甚": "非常",
    "由": "原由",
    "申": "申述",
    "电": "電形",
    "男": "男性",
    "畐": "滿形",
    "番": "輪番",
    "異": "不同",
    "當": "相當",
    "畾": "田疊",
    "疾": "疾病",
    "病": "生病",
    "百": "一百",
    "皃": "樣貌",
    "皆": "全部",
    "盍": "何不",
    "直": "直線",
    "県": "縣形",
    "睪": "睪形",
    "矣": "語氣詞",
    "知": "知道",
    "祭": "祭祀",
    "禺": "角落",
    "禼": "契形",
    "秀": "秀麗",
    "穵": "掘形",
    "竞": "競爭",
    "系": "系統",
    "絲": "絲線",
    "維": "維持",
    "縣": "縣市",
    "罙": "深形",
    "翟": "野雞",
    "耂": "老形",
    "耤": "耕形",
    "肉": "肉體",
    "肋": "肋骨",
    "肖": "相像",
    "能": "能力",
    "臤": "堅形",
    "致": "達到",
    "臽": "陷形",
    "舁": "共舉",
    "舍": "房舍",
    "良": "良好",
    "芒": "芒刺",
    "茍": "苟且",
    "草": "草木",
    "萬": "數字萬",
    "虎": "老虎",
    "蚤": "跳蚤",
    "覀": "西形",
    "角": "角落",
    "豐": "豐富",
    "象": "大象",
    "負": "負擔",
    "貫": "貫穿",
    "責": "責任",
    "貴": "貴重",
    "賈": "商人",
    "賣": "出售",
    "贊": "贊助",
    "軍": "軍隊",
    "迷": "迷失",
    "退": "退後",
    "連": "連接",
    "遀": "遂形",
    "道": "道路",
    "郎": "郎君",
    "酋": "酋長",
    "重": "重量",
    "镸": "長形",
    "門": "門戶",
    "陰": "陰暗",
    "雇": "雇用",
    "雐": "鳥形",
    "雔": "雙鳥",
    "難": "困難",
    "韋": "皮革",
    "風": "風力",
    "馬": "馬匹",
    "魚": "魚類",
    "鹵": "鹽分",
    "鹿": "鹿形",
    "黽": "蛙形",
    "龍": "龍形",
    "龥": "籲形",
    "龴": "古文形",
    "龶": "古文形",
    "龺": "古文形",

    # ===== Common characters =====
    "一": "數字一",
    "丁": "天干四",
    "丂": "古文字",
    "丅": "下形",
    "三": "數字三",
    "上": "上方",
    "不": "否定",
    "丑": "地支二",
    "且": "而且",
    "丘": "小山",
    "业": "職業",
    "丞": "輔佐",
    "並": "並排",
    "丩": "糾纏",
    "中": "中間",
    "丰": "茂盛",
    "丱": "雙髻",
    "丵": "草叢",
    "丸": "圓球",
    "主": "主人",
    "丽": "美麗",
    "二": "數字二",
    "乃": "於是",
    "之": "助詞",
    "乍": "忽然",
    "九": "數字九",
    "乞": "乞求",
    "也": "助詞",
    "了": "完畢",
    "予": "給予",
    "亏": "虧損",
    "云": "說話",
    "五": "數字五",
    "井": "水井",
    "亙": "延續",
    "亚": "亞形",
    "亡": "消亡",
    "亢": "高亢",
    "享": "享受",
    "京": "首都",
    "亲": "親近",
    "人": "人類",
    "今": "現在",
    "令": "命令",
    "以": "用來",
    "余": "剩餘",
    "你": "第二人稱",
    "佰": "百形",
    "來": "到來",
    "侌": "陰形",
    "侖": "條理",
    "保": "保護",
    "兀": "高突",
    "允": "允許",
    "元": "首位",
    "兌": "兌換",
    "免": "免除",
    "兔": "兔子",
    "兩": "數量二",
    "八": "數字八",
    "六": "數字六",
    "关": "關係",
    "兼": "兼顧",
    "分": "分開",
    "切": "切割",
    "制": "制度",
    "加": "增加",
    "北": "北方",
    "匹": "匹配",
    "十": "數字十",
    "千": "數字千",
    "升": "上升",
    "半": "一半",
    "占": "占有",
    "危": "危險",
    "卵": "卵子",
    "卷": "捲曲",
    "去": "離去",
    "反": "反對",
    "取": "拿取",
    "古": "古代",
    "句": "句子",
    "另": "另外",
    "召": "召喚",
    "可": "可以",
    "台": "台形",
    "右": "右邊",
    "号": "號令",
    "各": "各個",
    "合": "合併",
    "吉": "吉祥",
    "吋": "英寸",
    "吏": "官員",
    "启": "開啟",
    "周": "周圍",
    "咅": "對話",
    "咨": "諮詢",
    "咸": "全部",
    "品": "物品",
    "員": "成員",
    "喬": "高形",
    "回": "回轉",
    "多": "數量多",
    "大": "體積大",
    "天": "天空",
    "夫": "丈夫",
    "奉": "奉獻",
    "契": "契約",
    "奚": "奚落",
    "官": "官員",
    "寺": "寺廟",
    "小": "體積小",
    "少": "數量少",
    "山": "高山",
    "市": "市場",
    "布": "布料",
    "水": "液體",
    "火": "燃燒",
    "手": "人體手",
    "才": "才能",
    "牛": "牛隻",
    "羊": "羊隻",
    "刀": "刀器",
    "金": "金屬",
    "木": "樹木",
    "土": "泥土",
    "石": "石頭",
    "日": "太陽",
    "月": "月亮",
    "目": "眼睛",
    "耳": "耳朵",
    "口": "嘴巴",
    "心": "心臟",
    "王": "君王",
    "玉": "玉石",
    "田": "田地",
    "力": "力量",
    "工": "工作",
    "弓": "弓箭",
    "矢": "箭矢",
    "糸": "絲線",
    "貝": "貝殼",
    "走": "行走",
    "足": "腳足",
    "身": "身體",
    "車": "車輛",
    "言": "言語",
    "食": "飲食",
    "衣": "衣服",
    "見": "看見",
    "頁": "頁面",
}


def truncate_label(label, max_len=6):
    """Truncate label to max_len characters."""
    if len(label) <= max_len:
        return label
    # Try to cut at natural boundary
    return label[:max_len]


def get_label_from_radical_meanings(radical, radical_meanings):
    """Extract a short label from radical-meanings.json entry."""
    entry = radical_meanings.get(radical)
    if not entry:
        return None
    meaning = entry.get("meaning", "")
    if not meaning:
        return None
    # Take first clause (before ；or ：or ，)
    for sep in ["；", "：", "，", "。", "、", "(", "（"]:
        idx = meaning.find(sep)
        if idx > 0:
            meaning = meaning[:idx]
            break
    return truncate_label(meaning.strip())


def main():
    with open("frontend/src/data/decompositions-generated.json", encoding="utf-8") as f:
        data = json.load(f)

    with open("frontend/src/data/radical-meanings.json", encoding="utf-8") as f:
        radical_meanings = json.load(f)

    fixed_count = 0
    still_bad = 0
    label_sources = {}  # radical -> source used

    for char, entry in data.items():
        for comp in entry.get("components", []):
            role = comp.get("role", "")
            label = comp.get("label", "")
            radical = comp.get("radical", "")

            if role in ("形符", "部件") and (label == radical or label == ""):
                # Try sources in order:
                new_label = None

                # 1. LABEL_MAP (our comprehensive map)
                if radical in LABEL_MAP:
                    new_label = LABEL_MAP[radical]
                    label_sources[radical] = "label_map"

                # 2. radical-meanings.json
                if not new_label:
                    rm_label = get_label_from_radical_meanings(radical, radical_meanings)
                    if rm_label and rm_label != radical:
                        new_label = rm_label
                        label_sources[radical] = "radical_meanings"

                if new_label:
                    comp["label"] = new_label
                    fixed_count += 1
                else:
                    still_bad += 1
                    label_sources[radical] = "unfixed"

    print(f"Fixed: {fixed_count}")
    print(f"Still bad: {still_bad}")

    # Show which radicals remain unfixed
    if still_bad > 0:
        print("\nUnfixed radicals:")
        unfixed = [r for r, s in label_sources.items() if s == "unfixed"]
        for r in sorted(unfixed):
            print(f"  {r!r}")

    # Write back
    with open("frontend/src/data/decompositions-generated.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

    print("\nDone. File written.")

    # Verification: count remaining bad labels
    bad_after = 0
    for char, entry in data.items():
        for comp in entry.get("components", []):
            role = comp.get("role", "")
            label = comp.get("label", "")
            radical = comp.get("radical", "")
            if role in ("形符", "部件") and (label == radical or label == ""):
                bad_after += 1

    print(f"Remaining bad labels after fix: {bad_after}")


if __name__ == "__main__":
    main()
