"""
STT (Speech-to-Text) evaluation service.

Ported from frontend/src/utils/pinyin.ts.

The core correction algorithm also runs client-side for zero-latency feedback
during the reading loop. This server-side implementation is the authoritative
version used for session persistence and server-side validation.
"""

import re
from typing import Literal

# ---------------------------------------------------------------------------
# Pinyin lookup map (toneless): character → pinyin syllable
# Compact encoding mirroring the TypeScript PINYIN_GROUPS constant.
# ---------------------------------------------------------------------------

_PINYIN_GROUPS: dict[str, str] = {
    "a": "啊阿", "ai": "愛哀矮挨礙癌唉藹", "an": "安暗按岸案俺鞍氨",
    "ang": "昂", "ao": "凹熬傲奧懊澳",
    "ba": "八把爸吧拔巴罷壩芭疤霸叭扒靶笆",
    "bai": "百白擺拜敗柏佰", "ban": "半班般辦版搬伴扮瓣拌絆頒斑",
    "bang": "幫棒綁膀榜傍磅蚌",
    "bao": "包報保抱暴薄寶飽爆剝雹堡褒豹鮑",
    "bei": "北被背杯備悲倍輩碑貝卑悖", "ben": "本笨奔苯",
    "beng": "繃崩蹦迸泵",
    "bi": "比筆必避閉鼻壁幣逼畢臂碧蔽弊彼辟璧庇痹",
    "bian": "變邊便編遍辨辯鞭貶扁卞",
    "biao": "表標彪錶飆鏢", "bie": "別憋鱉",
    "bin": "賓濱彬斌鬢擯殯",
    "bing": "病兵冰並併丙餅屏秉柄炳",
    "bo": "波播伯薄撥剝玻泊柏舶博搏脖膊駁簸",
    "bu": "不步布佈部補捕怖卜哺簿",
    "ca": "擦", "cai": "才菜材財猜採彩裁蔡踩",
    "can": "參殘餐蠶慘燦慚", "cang": "倉蒼藏艙滄",
    "cao": "草操曹槽糙嘈", "ce": "側策冊測廁",
    "cen": "參岑", "ceng": "層曾蹭",
    "cha": "查茶差插叉察岔剎", "chai": "拆柴豺",
    "chan": "產纏蟬饞顫鏟禪攙",
    "chang": "長常場唱廠嘗嚐腸敞暢倡猖昌償",
    "chao": "超朝吵抄潮巢炒鈔", "che": "車徹撤扯掣澈",
    "chen": "陳沉晨趁襯稱塵辰忱",
    "cheng": "成城程乘稱承撐呈誠橙懲澄逞秤",
    "chi": "吃尺遲池持翅恥齒赤匙斥熾侈",
    "chong": "充重蟲衝崇寵", "chou": "抽仇愁臭醜綢籌稠酬瞅",
    "chu": "出初處除楚觸廚儲矗雛櫥鋤",
    "chua": "欻", "chuai": "揣",
    "chuan": "穿傳船串川喘", "chuang": "窗床創闖",
    "chui": "吹垂錘炊捶", "chun": "春純蠢唇醇",
    "chuo": "戳綽",
    "ci": "次此詞辭刺磁慈瓷雌茨", "cong": "從聰叢匆蔥囪",
    "cou": "湊", "cu": "粗促醋簇卒猝",
    "cuan": "竄篡攢", "cui": "催脆翠摧粹崔淬",
    "cun": "村存寸", "cuo": "錯措搓挫",
    "da": "大打達答搭瘩", "dai": "大代帶待袋戴呆歹貸怠逮",
    "dan": "但單擔蛋淡膽彈旦丹誕氮",
    "dang": "當黨擋檔蕩", "dao": "到道倒刀島導盜稻悼蹈",
    "de": "的得德", "deng": "等燈登鄧凳瞪",
    "di": "的地低底第敵滴遞帝抵弟迪堤笛締",
    "dian": "點電店典墊殿顛澱碘佃甸",
    "diao": "掉調吊釣雕刁凋",
    "die": "跌爹碟蝶迭諜疊", "ding": "定頂丁訂盯釘鼎叮",
    "diu": "丟", "dong": "動東冬懂洞凍棟董侗",
    "dou": "都斗豆抖逗兜陡竇",
    "du": "度讀都毒獨堵肚督渡杜妒鍍篤",
    "duan": "段短斷端鍛", "dui": "對堆隊兌",
    "dun": "頓蹲噸盾墩敦燉鈍遁",
    "duo": "多朵躲奪墮舵惰",
    "e": "額惡餓鵝俄厄扼", "en": "恩",
    "er": "二兒耳而爾餌",
    "fa": "發法罰髮伐乏閥筏",
    "fan": "反飯翻番犯煩繁凡泛帆販範藩",
    "fang": "方放房防訪仿紡芳妨",
    "fei": "非飛費肥廢肺沸匪誹",
    "fen": "分份粉紛奮憤糞芬焚氛墳",
    "feng": "風封豐峰峯鋒瘋逢縫馮蜂諷奉楓",
    "fo": "佛", "fou": "否",
    "fu": "父夫服福富副付復附婦幅腐浮府輔撫膚扶符腹敷賦覆伏俘傅拂斧孵弗氟",
    "ga": "嘎尬噶", "gai": "改該蓋概鈣溉",
    "gan": "幹敢感趕甘肝桿柑竿稈",
    "gang": "剛鋼港崗缸槓綱杠", "gao": "高搞告糕膏稿",
    "ge": "個各歌哥格革割閣隔葛擱戈鴿",
    "gei": "給", "gen": "根跟", "geng": "更耕",
    "gong": "工公共供功攻宮弓鞏恭拱貢",
    "gou": "夠狗溝勾構購鉤苟",
    "gu": "古故骨鼓姑孤辜股估谷顧固僱菇",
    "gua": "掛瓜刮寡褂卦", "guai": "怪拐乖",
    "guan": "關管觀官館慣灌冠貫罐", "guang": "光廣逛",
    "gui": "歸規貴鬼桂跪軌櫃閨龜瑰",
    "gun": "滾棍", "guo": "國過果鍋裹郭",
    "ha": "哈蛤", "hai": "還海害孩亥駭氦",
    "han": "漢喊含寒韓汗函罕翰旱焊憾悍",
    "hang": "行航杭", "hao": "好號毫浩豪耗壕",
    "he": "和河合何喝賀荷核禾盒鶴嚇貉赫褐",
    "hei": "黑嘿", "hen": "很恨狠痕",
    "heng": "橫哼恆衡",
    "hong": "紅洪宏轟虹鴻哄弘",
    "hou": "後厚候猴喉吼侯",
    "hu": "湖護戶呼忽壺胡虎糊蝴狐互滬乎弧",
    "hua": "花話化畫華划滑嘩", "huai": "壞懷淮",
    "huan": "還換歡環幻患喚煥緩宦",
    "huang": "黃荒皇慌謊晃恍惶煌簧",
    "hui": "會回灰揮毀悔匯慧繪惠輝徽恢賄",
    "hun": "混婚魂昏渾", "huo": "活火或貨獲禍惑豁",
    "ji": "幾及機己記計集級急技極積基季紀寄既濟繼擠祭劑際跡激績雞緝吉即姬肌饑譏棘輯",
    "jia": "家加假價甲架駕嘉夾佳頰",
    "jian": "見間件建漸減檢簡堅肩艱尖兼揀剪煎踐鍵箋薦鑑",
    "jiang": "將講江降獎疆姜漿僵醬匠",
    "jiao": "叫腳教角交較覺焦膠嬌澆驕嚼攪餃矯繳",
    "jie": "結節接街借姐界解介揭截戒屆傑劫潔",
    "jin": "進近金今僅緊盡儘禁勁筋斤津錦謹",
    "jing": "經京精靜境鏡驚景井竟敬警淨徑勁晶睛",
    "jiong": "窘迥", "jiu": "就九酒久舊救究糾",
    "ju": "局舉句具距巨拒懼劇居聚據鋸俱菊矩",
    "juan": "卷捲倦絹眷", "jue": "覺決絕掘嚼爵倔",
    "jun": "軍均君俊菌",
    "ka": "卡咖喀", "kai": "開凱慨揩",
    "kan": "看砍刊堪勘", "kang": "抗康扛慷糠",
    "kao": "考靠烤拷",
    "ke": "可科課客克刻渴殼顆棵柯苛",
    "ken": "肯墾懇啃", "keng": "坑",
    "kong": "空恐控孔", "kou": "口扣叩寇",
    "ku": "苦哭庫枯褲酷窟", "kua": "跨誇垮挎",
    "kuai": "快塊筷會", "kuan": "寬款",
    "kuang": "況狂礦框眶", "kui": "虧愧潰窺盔饋",
    "kun": "困昆捆坤", "kuo": "括擴闊廓",
    "la": "拉啦辣蠟喇垃", "lai": "來賴萊",
    "lan": "藍懶爛蘭攔籃覽欄瀾",
    "lang": "浪狼朗郎廊", "lao": "老勞撈牢佬姥澇",
    "le": "了瞭樂勒", "lei": "類累雷淚壘擂",
    "leng": "冷楞愣",
    "li": "裡裏力理利離立歷例禮粒厲梨勵瀝隸籬麗",
    "lia": "倆",
    "lian": "臉連練聯憐蓮煉鏈廉簾戀斂",
    "liang": "兩量亮涼梁糧良輛晾諒",
    "liao": "了瞭料聊療遼廖撩燎",
    "lie": "列烈獵裂劣",
    "lin": "林臨鄰淋磷吝凜",
    "ling": "另令領零靈齡鈴嶺玲凌",
    "liu": "六流留劉柳瘤溜",
    "long": "龍弄籠聾隆攏壟",
    "lou": "樓漏陋摟簍",
    "lu": "路錄陸露鹿魯盧爐虜碌",
    "luan": "亂卵", "lue": "略掠",
    "lun": "論輪倫",
    "luo": "落絡羅螺裸駱洛",
    "lv": "綠旅律率慮濾履呂氯",
    "ma": "嗎媽馬罵麻螞碼", "mai": "買賣麥埋邁脈",
    "man": "滿慢漫蠻瞞饅蔓", "mang": "忙盲茫芒",
    "mao": "毛貓冒帽矛茅貿錨",
    "me": "麼麽",
    "mei": "每沒美妹梅煤眉媒枚玫",
    "men": "們門悶",
    "meng": "夢猛盟蒙萌孟",
    "mi": "米密迷秘祕蜜覓瞇謎彌",
    "mian": "面棉免眠綿緬",
    "miao": "苗妙秒描廟瞄渺",
    "mie": "滅蔑", "min": "民敏閩",
    "ming": "名明命鳴銘冥",
    "mo": "摸末沒莫默磨墨膜魔模抹摩漠",
    "mou": "某謀牟",
    "mu": "木母目牧墓幕暮慕穆畝姆拇",
    "na": "那拿哪納娜", "nai": "奶耐乃奈",
    "nan": "南男難", "nang": "囊",
    "nao": "腦鬧惱撓", "ne": "呢",
    "nei": "內", "nen": "嫩", "neng": "能",
    "ni": "你泥擬逆匿膩",
    "nian": "年念唸粘撚", "niang": "娘釀",
    "niao": "鳥尿", "nie": "捏涅鑷",
    "nin": "您", "ning": "寧擰凝",
    "niu": "牛扭紐", "nong": "農濃弄",
    "nu": "努怒奴", "nuan": "暖",
    "nue": "虐", "nuo": "挪諾",
    "nv": "女",
    "o": "哦噢", "ou": "歐偶嘔毆藕",
    "pa": "怕爬趴帕琶", "pai": "排派拍牌",
    "pan": "盤判盼攀叛畔潘", "pang": "旁胖龐",
    "pao": "跑炮泡拋袍咆",
    "pei": "配陪培佩賠沛",
    "pen": "盆噴",
    "peng": "朋碰捧棚蓬膨烹澎",
    "pi": "批皮片匹劈披疲脾僻屁啤琵",
    "pian": "片偏篇騙翩", "piao": "票飄漂",
    "pie": "撇瞥", "pin": "品拼貧頻聘",
    "ping": "平瓶評屏憑蘋萍",
    "po": "破坡婆迫頗潑魄",
    "pu": "普鋪撲朴僕葡",
    "qi": "七起其氣期妻器棋騎齊旗奇泣企欺漆歧祈砌",
    "qia": "恰洽掐",
    "qian": "前千錢淺遷牽簽欠鉛謙潛嵌",
    "qiang": "強槍牆搶腔嗆",
    "qiao": "橋巧敲悄翹竅殼瞧俏",
    "qie": "切且竊茄怯",
    "qin": "親琴勤侵禽芹寢",
    "qing": "請清青輕情晴慶傾氫卿",
    "qiong": "窮瓊", "qiu": "球秋求丘囚蚯",
    "qu": "去取區曲趣驅屈渠娶",
    "quan": "全權圈拳勸泉犬",
    "que": "卻缺確雀瘸鵲", "qun": "群裙",
    "ran": "然染燃", "rang": "讓嚷壤",
    "rao": "繞饒擾", "re": "熱惹",
    "ren": "人認任忍仁韌刃",
    "reng": "仍扔", "ri": "日",
    "rong": "容融榮溶絨冗", "rou": "肉柔揉",
    "ru": "如入乳儒辱褥", "ruan": "軟",
    "rui": "銳瑞蕊", "run": "潤", "ruo": "若弱",
    "sa": "撒灑薩", "sai": "賽塞腮",
    "san": "三散傘", "sang": "嗓喪桑",
    "sao": "掃嫂騷", "se": "色澀瑟",
    "sen": "森",
    "sha": "殺沙紗傻剎啥", "shai": "曬篩",
    "shan": "山善閃衫扇珊杉刪煽",
    "shang": "上商傷賞尚",
    "shao": "少燒紹稍勺哨韶",
    "she": "社設舌射蛇捨攝涉赦",
    "shen": "身深什神甚審伸慎腎滲紳申",
    "sheng": "生聲升省勝剩繩盛牲甥",
    "shi": "是時十使事世實石師市食始試史式識失濕詩適示士勢釋室視氏誓施屍",
    "shou": "手首受收守壽授售瘦獸",
    "shu": "書樹數屬術述輸束鼠熟叔舒疏暑署蔬殊淑薯梳",
    "shua": "刷耍", "shuai": "帥摔衰甩",
    "shuan": "拴栓", "shuang": "雙爽霜",
    "shui": "水睡誰稅", "shun": "順瞬吮",
    "shuo": "說碩",
    "si": "四死私思司似絲斯撕嗣肆飼",
    "song": "送松宋頌訟聳", "sou": "搜嗖艘",
    "su": "素速蘇訴俗塑肅縮宿溯",
    "suan": "算酸蒜", "sui": "隨歲雖碎穗遂",
    "sun": "孫損筍", "suo": "所縮鎖索瑣",
    "ta": "他她它牠踏塔拓", "tai": "太台臺態抬胎泰颱",
    "tan": "談彈探嘆攤灘壇貪癱",
    "tang": "湯糖堂趟躺燙唐塘",
    "tao": "桃逃套陶淘討萄", "te": "特",
    "teng": "疼騰藤",
    "ti": "體提題替踢梯剃啼",
    "tian": "天田甜添填", "tiao": "條跳挑調",
    "tie": "鐵貼",
    "ting": "聽停庭挺廷亭艇",
    "tong": "同通痛統筒銅童桶",
    "tou": "頭偷透投",
    "tu": "土圖突吐塗途兔屠", "tuan": "團",
    "tui": "推退腿", "tun": "吞屯囤",
    "tuo": "拖脫託妥橢駝",
    "wa": "挖瓦哇蛙窪娃", "wai": "外歪",
    "wan": "萬完晚玩碗灣彎丸挽頑",
    "wang": "王望往網忘旺汪",
    "wei": "為位未味衛圍微偉維威尾委危胃違魏畏喂慰桅",
    "wen": "問文聞溫穩紋吻蚊瘟", "weng": "翁",
    "wo": "我握窩臥渦蝸",
    "wu": "五無物屋武午舞悟務污霧吳誤伍侮",
    "xi": "西習席喜洗細戲系吸希息犧析稀膝嬉溪熙惜錫",
    "xia": "下夏嚇蝦瞎峽俠狹霞",
    "xian": "先線現顯限險鮮獻鹹閒賢弦嫌掀",
    "xiang": "想向象像響香相鄉箱詳湘",
    "xiao": "小笑校消效曉削宵銷蕭",
    "xie": "寫些鞋血謝斜協歇脅邪攜",
    "xin": "心新信辛欣薪芯鋅",
    "xing": "行星性姓興形型醒幸杏刑",
    "xiong": "兄胸雄熊凶匈",
    "xiu": "修秀休袖銹繡嗅",
    "xu": "需許續虛序緒蓄敘畜絮",
    "xuan": "選宣懸旋玄",
    "xue": "學血雪穴削",
    "xun": "訓尋巡訊迅遜",
    "ya": "呀壓牙鴨芽崖啞雅亞",
    "yan": "眼煙言嚴沿演研鹽岩顏延焰雁燕驗",
    "yang": "樣養陽洋央揚氧仰癢楊",
    "yao": "要藥搖咬腰遙窯謠姚",
    "ye": "也夜野業葉爺頁液",
    "yi": "一以已意義藝易衣醫億憶移議宜益依疑亦誼異儀遺翼",
    "yin": "因音引印銀隱飲陰",
    "ying": "應英影營迎映硬贏鷹嬰瑩",
    "yong": "用勇永擁湧庸雍",
    "you": "有又由友油遊右幼優悠誘猶郵尤",
    "yu": "與於魚雨語玉育遇預域餘愈裕宇羽御獄浴寓譽",
    "yuan": "原遠員院圓願源園緣袁冤怨",
    "yue": "月越約閱岳悅樂粵",
    "yun": "雲運允暈韻孕",
    "za": "雜砸咋", "zai": "在再災載栽宰",
    "zan": "咱暫贊攢", "zang": "髒葬臟",
    "zao": "早造遭糟棗燥澡灶皂", "ze": "則責擇澤",
    "zei": "賊", "zen": "怎", "zeng": "增曾贈",
    "zha": "扎炸榨詐柵渣眨",
    "zhai": "摘窄宅債寨齋",
    "zhan": "站戰展占沾粘瞻斬嶄",
    "zhang": "長張章丈掌漲帳障彰仗",
    "zhao": "找照招趙召罩兆",
    "zhe": "這者著着折哲遮",
    "zhen": "真陣針鎮振震珍偵診枕",
    "zheng": "正整證爭政征睜蒸鄭掙症",
    "zhi": "之只知直指紙至制止質治值志智置支職織執植殖",
    "zhong": "中種重眾終鐘忠仲腫",
    "zhou": "周洲州粥軸舟肘皺宙晝",
    "zhu": "主住注助豬竹築柱逐祝著珠株蛀",
    "zhua": "抓", "zhuai": "拽",
    "zhuan": "轉專磚賺傳", "zhuang": "裝莊壯撞狀",
    "zhui": "追墜綴", "zhun": "準",
    "zhuo": "桌捉拙卓琢灼",
    "zi": "子字自紫資姿仔滋籽",
    "zong": "總宗綜棕縱蹤", "zou": "走奏鄒",
    "zu": "族足組祖租阻卒", "zuan": "鑽",
    "zui": "最嘴醉罪", "zun": "尊遵",
    "zuo": "做作坐座左昨",
}

# Build inverted map: character → pinyin (toneless). First mapping wins.
_CHAR_TO_PINYIN: dict[str, str] = {}
for _py, _chars in _PINYIN_GROUPS.items():
    for _ch in _chars:
        if _ch not in _CHAR_TO_PINYIN:
            _CHAR_TO_PINYIN[_ch] = _py

# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

_PUNCTUATION_RE = re.compile(r"[「」『』，。！？：；、\s]")
_NUMERAL_MAP = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九"]


def get_pinyin(ch: str) -> str | None:
    """Return the toneless pinyin for a character, or None if unknown."""
    return _CHAR_TO_PINYIN.get(ch)


def is_homophone(a: str, b: str) -> bool:
    """Return True if two characters share the same toneless pinyin."""
    if a == b:
        return True
    pa, pb = get_pinyin(a), get_pinyin(b)
    if pa is None or pb is None:
        return False
    return pa == pb


def _int_to_chinese(n: int) -> str:
    """Convert a non-negative integer to its Chinese numeral string."""
    if n == 0:
        return "零"
    result = ""
    if n >= 100_000_000:
        result += _int_to_chinese(n // 100_000_000) + "億"
        n %= 100_000_000
        if 0 < n < 10_000_000:
            result += "零"
    if n >= 10_000:
        result += _int_to_chinese(n // 10_000) + "萬"
        n %= 10_000
        if 0 < n < 1_000:
            result += "零"
    if n >= 1_000:
        result += _NUMERAL_MAP[n // 1_000] + "千"
        n %= 1_000
        if 0 < n < 100:
            result += "零"
    if n >= 100:
        result += _NUMERAL_MAP[n // 100] + "百"
        n %= 100
        if 0 < n < 10:
            result += "零"
    if n >= 10:
        tens = n // 10
        if tens > 1 or result:
            result += _NUMERAL_MAP[tens]
        result += "十"
        n %= 10
    if n > 0:
        result += _NUMERAL_MAP[n]
    return result


def _normalize_numbers(text: str) -> str:
    return re.sub(r"\d+", lambda m: _int_to_chinese(int(m.group())), text)


def _normalize_for_comparison(text: str) -> str:
    return _PUNCTUATION_RE.sub("", _normalize_numbers(text))


# ---------------------------------------------------------------------------
# Core algorithm: correct_homophones
# ---------------------------------------------------------------------------

def correct_homophones(stt_text: str, target_text: str) -> str:
    """
    Given raw STT text and the known target text, correct homophone substitutions
    on a character-by-character basis using Levenshtein alignment with backtracking.

    For each aligned pair (stt_char, target_char):
      - Same character → keep as-is.
      - Homophones → replace STT char with target char.
      - Not homophones → keep STT char (genuine error).

    Returns the corrected string.
    Ported from frontend/src/utils/pinyin.ts correctHomophones().
    """
    s = list(stt_text)
    t = list(target_text)
    s_len, t_len = len(s), len(t)

    if s_len == 0 or t_len == 0:
        return stt_text

    # Build DP table (Levenshtein distance)
    dp = [[0] * (t_len + 1) for _ in range(s_len + 1)]
    for i in range(s_len + 1):
        dp[i][0] = i
    for j in range(t_len + 1):
        dp[0][j] = j

    for i in range(1, s_len + 1):
        for j in range(1, t_len + 1):
            cost = 0 if s[i - 1] == t[j - 1] else 1
            dp[i][j] = min(
                dp[i - 1][j] + 1,        # deletion
                dp[i][j - 1] + 1,        # insertion
                dp[i - 1][j - 1] + cost, # substitution
            )

    # Backtrack to find alignment
    result: list[str] = []
    i, j = s_len, t_len

    while i > 0 or j > 0:
        if i > 0 and j > 0:
            cost = 0 if s[i - 1] == t[j - 1] else 1
            if dp[i][j] == dp[i - 1][j - 1] + cost:
                # Match or substitution
                if s[i - 1] == t[j - 1]:
                    result.append(s[i - 1])          # exact match
                elif is_homophone(s[i - 1], t[j - 1]):
                    result.append(t[j - 1])           # homophone → use target
                else:
                    result.append(s[i - 1])           # genuine mismatch → keep STT
                i -= 1
                j -= 1
                continue
        if i > 0 and dp[i][j] == dp[i - 1][j] + 1:
            result.append(s[i - 1])  # deletion (extra char in STT) — keep
            i -= 1
        else:
            j -= 1                   # insertion (missing from STT) — skip

    result.reverse()
    return "".join(result)


# ---------------------------------------------------------------------------
# compute_match_rate
# ---------------------------------------------------------------------------

def compute_match_rate(corrected: str, target: str) -> float:
    """
    Character-frequency overlap between corrected STT and target text.
    Both strings are first normalised (punctuation removed, numbers converted).
    Returns a float in [0, 1].
    """
    spoken_norm = _normalize_for_comparison(corrected)
    target_norm = _normalize_for_comparison(target)

    if not target_norm or not spoken_norm:
        return 0.0

    spoken_freq: dict[str, int] = {}
    for ch in spoken_norm:
        spoken_freq[ch] = spoken_freq.get(ch, 0) + 1

    matched = 0
    for ch in target_norm:
        if spoken_freq.get(ch, 0) > 0:
            matched += 1
            spoken_freq[ch] -= 1

    return matched / len(target_norm)


# ---------------------------------------------------------------------------
# evaluate_reading — main entry point
# ---------------------------------------------------------------------------

Tier = Literal[1, 2, 3]

FEEDBACK_KEYS = {
    1: "tier1",  # ≥ 80% — very good, advance
    2: "tier2",  # ≥ 60% — good, advance
    3: "tier3",  # < 60% — retry same line
}


def evaluate_reading(stt_text: str, target_text: str) -> dict:
    """
    Full evaluation pipeline:
      1. Normalize target for alignment (strip punctuation).
      2. Correct homophones.
      3. Compute match rate.
      4. Return tier, match_rate, and feedback_key.

    Returns:
        {
            "corrected": str,
            "match_rate": float,
            "tier": int (1 | 2 | 3),
            "feedback_key": str,
        }
    """
    target_for_alignment = _normalize_for_comparison(target_text)
    corrected = correct_homophones(stt_text, target_for_alignment)
    match_rate = compute_match_rate(corrected, target_text)

    if match_rate >= 0.8:
        tier: Tier = 1
    elif match_rate >= 0.6:
        tier = 2
    else:
        tier = 3

    return {
        "corrected": corrected,
        "match_rate": round(match_rate, 4),
        "tier": tier,
        "feedback_key": FEEDBACK_KEYS[tier],
    }
