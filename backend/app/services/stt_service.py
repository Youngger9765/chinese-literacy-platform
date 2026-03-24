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
    "a": "啊阿嗄", "ai": "愛哀矮挨礙癌唉藹艾埃隘欸捱靄", "an": "安暗按岸案俺鞍氨黯庵鵪諳",
    "ang": "昂盎骯", "ao": "凹熬傲奧懊澳翱遨驁坳媼",
    "ba": "八把爸吧拔巴罷壩芭疤霸叭扒靶笆跋耙",
    "bai": "百白擺拜敗柏佰襬稗", "ban": "半班般辦版搬伴扮瓣拌絆頒斑板闆扳粄",
    "bang": "幫棒綁膀榜傍磅蚌邦",
    "bao": "包報保抱暴薄寶飽爆剝雹堡褒豹鮑胞苞煲",
    "bei": "北被背杯備悲倍輩碑貝卑悖盃焙憊狽蓓揹", "ben": "本笨奔苯",
    "beng": "繃崩蹦迸泵",
    "bi": "比筆必避閉鼻壁幣逼畢臂碧蔽弊彼辟璧庇痹蓽痺鄙弼敝",
    "bian": "變邊便編遍辨辯鞭貶扁卞辮匾",
    "biao": "表標彪錶飆鏢杓", "bie": "別憋鱉彆癟",
    "bin": "賓濱彬斌鬢擯殯繽瀕檳",
    "bing": "病兵冰並併丙餅屏秉柄炳稟",
    "bo": "波播伯薄撥剝玻泊柏舶博搏脖膊駁簸蔔勃菠跛缽鈸",
    "bu": "不步布佈部補捕怖卜哺簿",
    "ca": "擦", "cai": "才菜材財猜採彩裁蔡踩采綵纔",
    "can": "參殘餐蠶慘燦慚璨摻粲", "cang": "倉蒼藏艙滄",
    "cao": "草操曹槽糙嘈", "ce": "側策冊測廁",
    "cen": "參岑", "ceng": "層曾蹭噌",
    "cha": "查茶差插叉察岔剎搽", "chai": "拆柴豺",
    "chan": "產纏蟬饞顫鏟禪攙闡潺懺",
    "chang": "長常場唱廠嘗嚐腸敞暢倡猖昌償徜悵嫦",
    "chao": "超朝吵抄潮巢炒鈔嘲", "che": "車徹撤扯掣澈",
    "chen": "陳沉晨趁襯稱塵辰忱臣縝瞋",
    "cheng": "成城程乘稱承撐呈誠橙懲澄逞秤丞埕晟騁",
    "chi": "吃尺遲池持翅恥齒赤匙斥熾侈馳痴嗤呎喫叱敕",
    "chong": "充重蟲衝崇寵沖憧忡舂", "chou": "抽仇愁臭醜綢籌稠酬瞅丑疇惆躊",
    "chu": "出初處除楚觸廚儲矗雛櫥鋤齣杵躇",
    "chua": "欻", "chuai": "揣啜",
    "chuan": "穿傳船串川喘舛椽", "chuang": "窗床創闖幢瘡愴",
    "chui": "吹垂錘炊捶槌陲", "chun": "春純蠢唇醇脣淳椿鶉",
    "chuo": "戳綽輟",
    "ci": "次此詞辭刺磁慈瓷雌茨賜祠", "cong": "從聰叢匆蔥囪淙",
    "cou": "湊", "cu": "粗促醋簇卒猝踧",
    "cuan": "竄篡攢", "cui": "催脆翠摧粹崔淬璀萃",
    "cun": "村存寸吋", "cuo": "錯措搓挫厝磋撮",
    "da": "大打達答搭瘩沓躂", "dai": "大代帶待袋戴呆歹貸怠逮黛",
    "dan": "但單擔蛋淡膽彈旦丹誕氮耽啖憚澹",
    "dang": "當黨擋檔蕩盪噹", "dao": "到道倒刀島導盜稻悼蹈搗禱",
    "de": "的得德", "deng": "等燈登鄧凳瞪",
    "di": "的地低底第敵滴遞帝抵弟迪堤笛締蒂柢邸荻",
    "dian": "點電店典墊殿顛澱碘佃甸奠巔踮惦簟",
    "diao": "掉調吊釣雕刁凋叼貂",
    "die": "跌爹碟蝶迭諜疊喋鰈", "ding": "定頂丁訂盯釘鼎叮",
    "diu": "丟", "dong": "動東冬懂洞凍棟董侗咚鶇",
    "dou": "都斗豆抖逗兜陡竇鬥痘蚪",
    "du": "度讀都毒獨堵肚督渡杜妒鍍篤嘟睹蠹",
    "duan": "段短斷端鍛緞", "dui": "對堆隊兌",
    "dun": "頓蹲噸盾墩敦燉鈍遁盹",
    "duo": "多朵躲奪墮舵惰鐸哆踱咄剁垛掇跺",
    "e": "額惡餓鵝俄厄扼噩遏顎愕訛娥", "en": "恩",
    "er": "二兒耳而爾餌",
    "fa": "發法罰髮伐乏閥筏琺",
    "fan": "反飯翻番犯煩繁凡泛帆販範藩返蕃",
    "fang": "方放房防訪仿紡芳妨坊肪",
    "fei": "非飛費肥廢肺沸匪誹啡菲吠翡扉蜚緋痱",
    "fen": "分份粉紛奮憤糞芬焚氛墳",
    "feng": "風封豐峰峯鋒瘋逢縫馮蜂諷奉楓鳳丰俸",
    "fo": "佛", "fou": "否缶",
    "fu": "父夫服福富副付復附婦幅腐浮府輔撫膚扶符腹敷賦覆伏俘傅拂斧孵弗氟負複彿佛赴俯甫芙縛咐釜阜跗訃",
    "ga": "嘎尬噶呷", "gai": "改該蓋概鈣溉丐",
    "gan": "幹敢感趕甘肝桿柑竿稈干尷杆",
    "gang": "剛鋼港崗缸槓綱杠", "gao": "高搞告糕膏稿羔篙槁",
    "ge": "個各歌哥格革割閣隔葛擱戈鴿咯胳嗝閤鬲",
    "gei": "給", "gen": "根跟亙哏", "geng": "更耕梗羹哽埂鯁",
    "gong": "工公共供功攻宮弓鞏恭拱貢躬",
    "gou": "夠狗溝勾構購鉤苟垢搆",
    "gu": "古故骨鼓姑孤辜股估谷顧固僱菇穀呱雇箍",
    "gua": "掛瓜刮寡褂卦颳聒剮", "guai": "怪拐乖枴",
    "guan": "關管觀官館慣灌冠貫罐", "guang": "光廣逛獷",
    "gui": "歸規貴鬼桂跪軌櫃閨龜瑰詭檜鮭匱晷",
    "gun": "滾棍", "guo": "國過果鍋裹郭粿",
    "ha": "哈蛤", "hai": "還海害孩亥駭氦",
    "han": "漢喊含寒韓汗函罕翰旱焊憾悍涵撼瀚憨頷酣",
    "hang": "行航杭", "hao": "好號毫浩豪耗壕皓嚎",
    "he": "和河合何喝賀荷核禾盒鶴嚇貉赫褐呵蚵闔曷壑",
    "hei": "黑嘿", "hen": "很恨狠痕",
    "heng": "橫哼恆衡亨",
    "hong": "紅洪宏轟虹鴻哄弘烘魟",
    "hou": "後厚候猴喉吼侯后",
    "hu": "湖護戶呼忽壺胡虎糊蝴狐互滬乎弧瑚鬍葫琥斛",
    "hua": "花話化畫華划滑嘩劃譁", "huai": "壞懷淮徊踝",
    "huan": "還換歡環幻患喚煥緩宦浣奐鬟圜",
    "huang": "黃荒皇慌謊晃恍惶煌簧凰潢磺",
    "hui": "會回灰揮毀悔匯慧繪惠輝徽恢賄迴彙諱誨暉喙晦洄穢燴",
    "hun": "混婚魂昏渾", "huo": "活火或貨獲禍惑豁夥穫伙",
    "ji": "幾及機己記計集級急技極積基季紀寄既濟繼擠祭劑際跡激績雞緝吉即姬肌饑譏棘輯擊藉籍圾疾蹟寂暨脊飢忌汲嫉亟羈岌瘠霽踖",
    "jia": "家加假價甲架駕嘉夾佳頰嫁傢莢枷岬戛浹",
    "jian": "見間件建漸減檢簡堅肩艱尖兼揀剪煎踐鍵箋薦鑑健箭撿劍繭儉濺賤毽餞鑒諫澗蹇鰹鶼",
    "jiang": "將講江降獎疆姜漿僵醬匠薑槳韁絳",
    "jiao": "叫腳教角交較覺焦膠嬌澆驕嚼攪餃矯繳礁郊蕉椒酵跤狡皎窖",
    "jie": "結節接街借姐界解介揭截戒屆傑劫潔階捷皆竭芥誡睫拮詰桀絜",
    "jin": "進近金今僅緊盡儘禁勁筋斤津錦謹晉巾浸襟燼矜",
    "jing": "經京精靜境鏡驚景井竟敬警淨徑勁晶睛競鯨頸莖荊憬逕脛旌",
    "jiong": "窘迥", "jiu": "就九酒久舊救究糾臼啾疚",
    "ju": "局舉句具距巨拒懼劇居聚據鋸俱菊矩橘拘沮鞠倨咀鉅遽踞据掬侷",
    "juan": "卷捲倦絹眷捐鵑雋涓", "jue": "覺決絕掘嚼爵倔訣抉厥攫",
    "jun": "軍均君俊菌駿峻",
    "ka": "卡咖喀", "kai": "開凱慨揩鎧",
    "kan": "看砍刊堪勘檻坎侃瞰", "kang": "抗康扛慷糠亢",
    "kao": "考靠烤拷銬",
    "ke": "可科課客克刻渴殼顆棵柯苛咳蝌坷窠嗑磕瞌",
    "ken": "肯墾懇啃", "keng": "坑",
    "kong": "空恐控孔", "kou": "口扣叩寇",
    "ku": "苦哭庫枯褲酷窟", "kua": "跨誇垮挎",
    "kuai": "快塊筷會膾", "kuan": "寬款",
    "kuang": "況狂礦框眶曠筐誑", "kui": "虧愧潰窺盔饋葵魁睽簣喟",
    "kun": "困昆捆坤睏綑", "kuo": "括擴闊廓",
    "la": "拉啦辣蠟喇垃臘剌邋", "lai": "來賴萊",
    "lan": "藍懶爛蘭攔籃覽欄瀾纜嵐斕婪",
    "lang": "浪狼朗郎廊螂榔瑯", "lao": "老勞撈牢佬姥澇酪烙",
    "le": "了瞭樂勒", "lei": "類累雷淚壘擂蕾纍磊",
    "leng": "冷楞愣稜",
    "li": "裡裏力理利離立歷例禮粒厲梨勵瀝隸籬麗李里栗璃黎罹曆哩狸釐俐荔鯉笠礫吏犁驪戾唳",
    "lia": "倆",
    "lian": "臉連練聯憐蓮煉鏈廉簾戀斂鍊漣楝瀲",
    "liang": "兩量亮涼梁糧良輛晾諒",
    "liao": "了瞭料聊療遼廖撩燎繚寮寥嘹撂",
    "lie": "列烈獵裂劣咧冽",
    "lin": "林臨鄰淋磷吝凜鱗拎",
    "ling": "另令領零靈齡鈴嶺玲凌聆陵伶菱羚翎",
    "liu": "六流留劉柳瘤溜琉瀏硫遛綹",
    "long": "龍弄籠聾隆攏壟嚨朧隴",
    "lou": "樓漏陋摟簍",
    "lu": "路錄陸露鹿魯盧爐虜碌蘆嚕鷺滷廬擄漉櫓",
    "luan": "亂卵巒欒", "lue": "略掠",
    "lun": "論輪倫淪",
    "luo": "落絡羅螺裸駱洛蘿邏鑼籮",
    "lv": "綠旅律率慮濾履呂氯屢鋁驢縷",
    "ma": "嗎媽馬罵麻螞碼瑪嬤蟆", "mai": "買賣麥埋邁脈霾",
    "man": "滿慢漫蠻瞞饅蔓曼謾幔", "mang": "忙盲茫芒莽蟒",
    "mao": "毛貓冒帽矛茅貿錨貌茂卯袤",
    "me": "麼麽么",
    "mei": "每沒美妹梅煤眉媒枚玫魅媚黴鎂寐袂",
    "men": "們門悶",
    "meng": "夢猛盟蒙萌孟蜢濛朦",
    "mi": "米密迷秘祕蜜覓瞇謎彌咪泌靡謐瀰糜",
    "mian": "面棉免眠綿緬麵勉",
    "miao": "苗妙秒描廟瞄渺喵",
    "mie": "滅蔑篾", "min": "民敏閩閔憫",
    "ming": "名明命鳴銘冥螟暝瞑",
    "mo": "摸末沒莫默磨墨膜魔模抹摩漠陌寞沫蘑歿",
    "mou": "某謀牟眸繆",
    "mu": "木母目牧墓幕暮慕穆畝姆拇募沐睦",
    "na": "那拿哪納娜吶捺", "nai": "奶耐乃奈",
    "nan": "南男難喃囡赧", "nang": "囊",
    "nao": "腦鬧惱撓瑙", "ne": "呢",
    "nei": "內", "nen": "嫩", "neng": "能",
    "ni": "你泥擬逆匿膩尼妳溺睨",
    "nian": "年念唸粘撚黏碾捻鯰輦", "niang": "娘釀孃",
    "niao": "鳥尿裊", "nie": "捏涅鑷躡齧",
    "nin": "您", "ning": "寧擰凝嚀濘",
    "niu": "牛扭紐鈕妞", "nong": "農濃弄儂",
    "nu": "努怒奴弩", "nuan": "暖",
    "nue": "虐", "nuo": "挪諾懦糯喏",
    "nv": "女",
    "o": "哦噢", "ou": "歐偶嘔毆藕鷗甌謳",
    "pa": "怕爬趴帕琶杷", "pai": "排派拍牌徘湃",
    "pan": "盤判盼攀叛畔潘拚蹣槃", "pang": "旁胖龐彷螃",
    "pao": "跑炮泡拋袍咆刨",
    "pei": "配陪培佩賠沛醅",
    "pen": "盆噴",
    "peng": "朋碰捧棚蓬膨烹澎砰篷抨怦",
    "pi": "批皮片匹劈披疲脾僻屁啤琵媲譬闢枇疋",
    "pian": "片偏篇騙翩", "piao": "票飄漂瓢縹",
    "pie": "撇瞥", "pin": "品拼貧頻聘",
    "ping": "平瓶評屏憑蘋萍坪",
    "po": "破坡婆迫頗潑魄珀",
    "pu": "普鋪撲朴僕葡埔譜蒲樸瀑曝圃菩噗璞脯仆",
    "qi": "七起其氣期妻器棋騎齊旗奇泣企欺漆歧祈砌啟棄汽契棲淇綺戚崎豈乞淒憩臍畦訖",
    "qia": "恰洽掐",
    "qian": "前千錢淺遷牽簽欠鉛謙潛嵌乾歉籤遣虔騫阡慳",
    "qiang": "強槍牆搶腔嗆",
    "qiao": "橋巧敲悄翹竅殼瞧俏喬僑鍬峭蹺橇",
    "qie": "切且竊茄怯愜",
    "qin": "親琴勤侵禽芹寢秦沁擒",
    "qing": "請清青輕情晴慶傾氫卿擎頃蜻磬",
    "qiong": "窮瓊穹", "qiu": "球秋求丘囚蚯邱裘鰍",
    "qu": "去取區曲趣驅屈渠娶趨軀覷嶇麴衢祛",
    "quan": "全權圈拳勸泉犬券痊蜷詮",
    "que": "卻缺確雀瘸鵲", "qun": "群裙",
    "ran": "然染燃髯冉", "rang": "讓嚷壤攘",
    "rao": "繞饒擾", "re": "熱惹",
    "ren": "人認任忍仁韌刃紉稔仞",
    "reng": "仍扔", "ri": "日",
    "rong": "容融榮溶絨冗蓉榕茸熔", "rou": "肉柔揉",
    "ru": "如入乳儒辱褥茹濡汝蠕溽", "ruan": "軟",
    "rui": "銳瑞蕊睿", "run": "潤", "ruo": "若弱偌",
    "sa": "撒灑薩", "sai": "賽塞腮鰓",
    "san": "三散傘", "sang": "嗓喪桑",
    "sao": "掃嫂騷搔", "se": "色澀瑟",
    "sen": "森",
    "sha": "殺沙紗傻剎啥砂鯊煞廈鎩", "shai": "曬篩晒",
    "shan": "山善閃衫扇珊杉刪煽擅膳搧訕跚潸姍",
    "shang": "上商傷賞尚裳觴",
    "shao": "少燒紹稍勺哨韶梢捎",
    "she": "社設舌射蛇捨攝涉赦舍奢",
    "shen": "身深什神甚審伸慎腎滲紳申嬸莘呻",
    "sheng": "生聲升省勝剩繩盛牲甥聖昇",
    "shi": "是時十使事世實石師市食始試史式識失濕詩適示士勢釋室視氏誓施屍飾溼獅駛拾逝蝕侍拭仕柿矢噬嗜軾螫恃豉",
    "shou": "手首受收守壽授售瘦獸",
    "shu": "書樹數屬術述輸束鼠熟叔舒疏暑署蔬殊淑薯梳抒豎恕贖蜀倏黍",
    "shua": "刷耍", "shuai": "帥摔衰甩蟀",
    "shuan": "拴栓閂", "shuang": "雙爽霜",
    "shui": "水睡誰稅", "shun": "順瞬吮",
    "shuo": "說碩爍朔蒴",
    "si": "四死私思司似絲斯撕嗣肆飼寺嘶鷥巳",
    "song": "送松宋頌訟聳鬆誦忪", "sou": "搜嗖艘蒐擻餿叟",
    "su": "素速蘇訴俗塑肅縮宿溯酥甦",
    "suan": "算酸蒜痠", "sui": "隨歲雖碎穗遂隧邃",
    "sun": "孫損筍飧隼", "suo": "所縮鎖索瑣梭嗦蓑",
    "ta": "他她它牠踏塔拓塌祂遢", "tai": "太台臺態抬胎泰颱跆苔",
    "tan": "談彈探嘆攤灘壇貪癱坦潭碳毯譚檀",
    "tang": "湯糖堂趟躺燙唐塘倘膛淌",
    "tao": "桃逃套陶淘討萄掏滔濤饕", "te": "特",
    "teng": "疼騰藤",
    "ti": "體提題替踢梯剃啼屜涕剔蹄嚏惕",
    "tian": "天田甜添填舔恬腆靦", "tiao": "條跳挑調眺迢",
    "tie": "鐵貼帖",
    "ting": "聽停庭挺廷亭艇廳蜓霆",
    "tong": "同通痛統筒銅童桶桐彤僮慟",
    "tou": "頭偷透投",
    "tu": "土圖突吐塗途兔屠徒凸禿", "tuan": "團湍摶",
    "tui": "推退腿蛻褪頹", "tun": "吞屯囤豚",
    "tuo": "拖脫託妥橢駝托陀唾鴕馱橐",
    "wa": "挖瓦哇蛙窪娃襪漥媧", "wai": "外歪",
    "wan": "萬完晚玩碗灣彎丸挽頑宛婉腕蜿綰",
    "wang": "王望往網忘旺汪亡妄惘枉",
    "wei": "為位未味衛圍微偉維威尾委危胃違魏畏喂慰桅唯謂餵偽蔚緯蝟惟葦偎尉帷",
    "wen": "問文聞溫穩紋吻蚊瘟紊刎", "weng": "翁嗡甕",
    "wo": "我握窩臥渦蝸幄",
    "wu": "五無物屋武午舞悟務污霧吳誤伍侮汙烏巫勿吾鵡梧摀兀毋捂嫵嗚",
    "xi": "西習席喜洗細戲系吸希息犧析稀膝嬉溪熙惜錫係悉襲夕繫嘻隙晰犀昔熄蜥蟋汐羲曦皙蓆",
    "xia": "下夏嚇蝦瞎峽俠狹霞暇匣遐罅",
    "xian": "先線現顯限險鮮獻鹹閒賢弦嫌掀縣仙陷纖羨銜餡腺閑蘚舷",
    "xiang": "想向象像響香相鄉箱詳湘項享翔祥巷橡廂嚮饗鑲餉庠",
    "xiao": "小笑校消效曉削宵銷蕭孝肖嘯霄囂瀟哮梟",
    "xie": "寫些鞋血謝斜協歇脅邪攜蟹諧泄屑懈偕瀉洩擷褻",
    "xin": "心新信辛欣薪芯鋅馨",
    "xing": "行星性姓興形型醒幸杏刑倖惺擤",
    "xiong": "兄胸雄熊凶匈洶",
    "xiu": "修秀休袖銹繡嗅羞咻鏽脩岫饈",
    "xu": "需許續虛序緒蓄敘畜絮須徐栩鬚吁噓煦墟酗",
    "xuan": "選宣懸旋玄渲炫喧絢眩暄泫",
    "xue": "學血雪穴削靴謔",
    "xun": "訓尋巡訊迅遜循旬薰馴勛詢",
    "ya": "呀壓牙鴨芽崖啞雅亞埡涯訝鴉押丫椏揠軋",
    "yan": "眼煙言嚴沿演研鹽岩顏延焰雁燕驗炎厭菸豔彥掩宴淹諺醃焉嚥簷晏蜒咽儼奄硯筵巖灩",
    "yang": "樣養陽洋央揚氧仰癢楊羊秧徉漾烊颺",
    "yao": "要藥搖咬腰遙窯謠姚邀耀妖鑰肴堯夭舀餚",
    "ye": "也夜野業葉爺頁液吔椰曳揶謁",
    "yi": "一以已意義藝易衣醫億憶移議宜益依疑亦誼異儀遺翼譯椅蟻咦怡毅裔抑溢奕逸詣頤矣倚蜴漪咿懿邑貽軼壹痍揖佚噫翳姨疫",
    "yin": "因音引印銀隱飲陰癮吟姻殷蔭蚓茵垠",
    "ying": "應英影營迎映硬贏鷹嬰瑩螢穎櫻盈蠅鸚縈熒楹",
    "yong": "用勇永擁湧庸雍泳詠蛹壅俑踴",
    "you": "有又由友油遊右幼優悠誘猶郵尤游憂幽柚祐黝囿佑",
    "yu": "與於魚雨語玉育遇預域餘愈裕宇羽御獄浴寓譽予籲娛欲漁愉喻逾瑜嶼鬱郁癒余芋豫禦虞愚輿隅鷸迂揄燠踰諛萸歟竽鬻",
    "yuan": "原遠員院圓願源園緣袁冤怨元猿援淵苑鳶垣",
    "yue": "月越約閱岳悅樂粵躍曰",
    "yun": "雲運允暈韻孕蘊耘醞紜慍",
    "za": "雜砸咋紮咂", "zai": "在再災載栽宰",
    "zan": "咱暫贊攢讚簪", "zang": "髒葬臟",
    "zao": "早造遭糟棗燥澡灶皂藻躁蚤鑿譟噪", "ze": "則責擇澤嘖",
    "zei": "賊", "zen": "怎", "zeng": "增曾贈憎",
    "zha": "扎炸榨詐柵渣眨札乍喳蚱",
    "zhai": "摘窄宅債寨齋",
    "zhan": "站戰展占沾粘瞻斬嶄詹綻湛蘸盞輾棧氈",
    "zhang": "長張章丈掌漲帳障彰仗蟑脹杖",
    "zhao": "找照招趙召罩兆爪昭肇沼啁",
    "zhe": "這者著着折哲遮摺蔗轍輒浙褶赭",
    "zhen": "真陣針鎮振震珍偵診枕圳",
    "zheng": "正整證爭政征睜蒸鄭掙症徵箏拯鯖幀怔",
    "zhi": "之只知直指紙至制止質治值志智置支職織執植殖製隻致枝址汁誌肢脂緻蜘旨芝稚擲芷摯滯幟炙櫛枳秩",
    "zhong": "中種重眾終鐘忠仲腫鍾衷塚盅",
    "zhou": "周洲州粥軸舟肘皺宙晝週驟咒",
    "zhu": "主住注助豬竹築柱逐祝著珠株蛀煮朱註諸麈駐蛛燭鑄囑茱佇炷誅杼渚箸",
    "zhua": "抓", "zhuai": "拽",
    "zhuan": "轉專磚賺傳撰篆饌囀", "zhuang": "裝莊壯撞狀妝樁",
    "zhui": "追墜綴", "zhun": "準准諄",
    "zhuo": "桌捉拙卓琢灼濁啄茁酌擢濯",
    "zi": "子字自紫資姿仔滋籽茲諮梓漬孜恣",
    "zong": "總宗綜棕縱蹤粽", "zou": "走奏鄒揍",
    "zu": "族足組祖租阻卒", "zuan": "鑽纂",
    "zui": "最嘴醉罪", "zun": "尊遵樽鱒",
    "zuo": "做作坐座左昨佐",
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
