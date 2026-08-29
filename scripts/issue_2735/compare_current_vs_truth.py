"""現行 v3 答案 vs 教師版 ☑ 真值。"""
import re, pathlib, sys, unicodedata, yaml
sys.path.insert(0,'/tmp/gt2735')
from truth import checked_options

REPO=pathlib.Path('/Users/young/project/clp-2736')
DOCX=pathlib.Path('/Users/young/project/kist-curriculum/教材原檔')
FILES=('comprehension','keypoints','spotlight','vocab_application')

def norm(s):
    s=unicodedata.normalize('NFKC',str(s or ''))
    return re.sub(r'[\s。，、．,.!?！？「」『』（）()：:；;…—－\-]','',s)

def resolve(node):
    """(answer, options) -> 答案文字"""
    a, o = node.get('answer'), node.get('options')
    if a is None or not o: return None
    if isinstance(o, dict): return o.get(str(a)) or o.get(a)
    if isinstance(o, list):
        for k in (a, str(a)):
            if isinstance(k,int) and 0 <= k < len(o): return o[k]
        m=re.match(r'^([A-Da-d])$', str(a))
        if m:
            i=ord(m.group(1).upper())-65
            if i < len(o): return o[i]
        if str(a).isdigit():
            for i in (int(a), int(a)-1):
                if 0 <= i < len(o): return o[i]
    return None

def cur_answers(uid):
    out=set()
    def walk(o):
        if isinstance(o,dict):
            if 'answer' in o and 'options' in o:
                t=resolve(o)
                if t and len(norm(t))>=4: out.add(norm(t))
            for v in o.values(): walk(v)
        elif isinstance(o,list):
            for v in o: walk(v)
    for n in FILES:
        p=REPO/f'backend/data/lessons/{uid}/v3/{n}.yml'
        if p.is_file():
            try: walk(yaml.safe_load(p.read_text()))
            except Exception: pass
    return out

code2uid={}
for d in sorted((REPO/'backend/data/lessons').glob('L*')):
    for p in d.glob('v*/*.yml'):
        m=re.search(r'catalog_slot:\s*["\']?(G\d+-L\d+)',p.read_text(errors='ignore'))
        if m: code2uid.setdefault(m.group(1),d.name); break
code2docx={}
for f in DOCX.rglob('*.docx'):
    m=re.search(r'(G\d+)-S?L(\d+)',f.name)
    if not m: continue
    c=f'{m.group(1)}-L{int(m.group(2))}'
    if c not in code2docx or f.stat().st_size>code2docx[c].stat().st_size: code2docx[c]=f

# 正向對照：這套解析在 L0001 撈得到答案文字嗎
pc=cur_answers('L0011'); print(f"  正向對照 L0011 解出答案數: {len(pc)}")
pc=cur_answers('L0001'); print(f"  正向對照 L0001 解出答案數: {len(pc)}  例: {list(pc)[:1]}")

rows=[]
for code in sorted(set(code2uid)&set(code2docx)):
    uid=code2uid[code]
    truth=[norm(t['text']) for t in checked_options(code2docx[code])]
    truth=[t for t in truth if len(t)>=4]
    if not truth: continue
    cur=cur_answers(uid)
    hit=sum(1 for t in truth if any(t in a or a in t for a in cur))
    rows.append((code,uid,len(truth),hit,len(cur)))
T=sum(r[2] for r in rows); H=sum(r[3] for r in rows)
print(f"\n  課數 {len(rows)}   ☑真值題數 {T}   現行答案命中 {H} ({100*H/T:.1f}%)")
bad=[r for r in rows if r[3]<r[2]]
print(f"  有落差的課: {len(bad)}")
for c,u,t,h,n in sorted(bad,key=lambda r:r[3]-r[2])[:10]:
    print(f"    {c:<8} {u}  真值{t:>3}  命中{h:>3}  (該課解出答案 {n})")
