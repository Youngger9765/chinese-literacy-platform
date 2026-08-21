"""從教師版 DOCX 讀出老師真的打勾的選項（#2735 真值）。唯讀，不改 repo。"""
import re, sys, zipfile, pathlib, json

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
BOXES = str.maketrans({"⃞": "□", "▢": "□", "☐": "□", "◻": "□"})

def para_texts(path):
    """每段文字；☑ 保留成 ☑（生產的 reader 會把它抹成 □，那正是資訊丟失處）。"""
    import xml.etree.ElementTree as ET
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    out = []
    for p in root.iter(W + "p"):
        parts = []
        for n in p.iter():
            if n.tag == W + "t":
                parts.append(n.text or "")
            elif n.tag == W + "sym" and (n.get(W + "char") or "").upper() == "F0FE":
                parts.append("☑")
        t = "".join(parts).translate(BOXES).strip()
        if t:
            out.append(t)
    return out

# 選項行形如「□①文字」或「☑②文字」，也可能一行多個選項
OPT = re.compile(r"([□☑])\s*([①-⑳0-9A-Da-d\(（]?[^\s□☑]{0,2}?)\s*([^□☑]{2,})")

def checked_options(path):
    """回傳 [(被勾的選項文字, 該行所有選項數)]"""
    res = []
    for line in para_texts(path):
        if "☑" not in line:
            continue
        opts = [(mark, txt.strip()) for mark, _, txt in OPT.findall(line)]
        if not opts:
            continue
        for mark, txt in opts:
            if mark == "☑":
                res.append({"text": txt, "n_options": len(opts), "line": line[:100]})
    return res

if __name__ == "__main__":
    p = pathlib.Path(sys.argv[1])
    r = checked_options(p)
    print(f"  {p.name[:44]}  勾選數={len(r)}")
    for x in r[:4]:
        print(f"    ☑ {x['text'][:60]}   (該題 {x['n_options']} 選項)")
