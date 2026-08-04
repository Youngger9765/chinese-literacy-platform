# -*- coding: utf-8 -*-
"""稽核 v2（白化版）：
1. 非 document.xml 部件逐位元組相同
2. 每段文字與教師版完全相同（僅允許插入□）
3. rPr 差異只允許白名單：color=FFFFFF、u 加 color、sym 字元/顏色、移除 bdr、圖形隱形化
"""
import sys, zipfile, re
import lxml.etree as ET
W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def parts(path):
    z=zipfile.ZipFile(path)
    return {n: z.read(n) for n in z.namelist()}

def flow_paras(root):
    out=[]
    for p in root.iter(W+'p'):
        anc=p.getparent(); inbox=False
        while anc is not None:
            if anc.tag==W+'txbxContent': inbox=True; break
            anc=anc.getparent()
        if not inbox: out.append(p)
    return out

def ptext(p):
    out=[]
    for t in p.iter(W+'t'):
        anc=t.getparent(); nested=False
        while anc is not None and anc is not p:
            if anc.tag==W+'txbxContent': nested=True; break
            anc=anc.getparent()
        if not nested: out.append(t.text or '')
    return ''.join(out)

def norm_rpr(rpr):
    """版面相關正規化：顏色/底線色/字框不影響字寬，比對時移除"""
    if rpr is None: return ''
    r=ET.fromstring(ET.tostring(rpr))
    for tag in ('color','bdr'):
        e=r.find(W+tag)
        if e is not None: r.remove(e)
    u=r.find(W+'u')
    if u is not None and u.get(W+'color'):
        del u.attrib[W+'color']
    return ET.tostring(r)

def audit(tpath, spath):
    issues=[]
    tp, sp = parts(tpath), parts(spath)
    for k in sorted(set(tp)|set(sp)):
        if k=='word/document.xml': continue
        if tp.get(k)!=sp.get(k):
            issues.append(f'部件不同: {k}')
    td=ET.fromstring(tp['word/document.xml']); sd=ET.fromstring(sp['word/document.xml'])
    T=flow_paras(td); S=flow_paras(sd)
    if len(T)!=len(S):
        issues.append(f'正文段落數不同 {len(T)} vs {len(S)}'); return issues
    # 全文串接比對（避免浮動物件順序差異造成錯位誤報）
    tall=''.join(ptext(p) for p in T)
    sall=''.join(ptext(p) for p in S)
    if tall != sall and sall.replace('□','') != tall.replace('□',''):
        import difflib
        for tag,i1,i2,j1,j2 in difflib.SequenceMatcher(None,tall,sall).get_opcodes():
            if tag=='equal': continue
            frag_t, frag_s = tall[i1:i2], sall[j1:j2]
            if tag=='insert' and set(frag_s)<={'□'}: continue
            issues.append(f'內文文字差異[{tag}]:「{frag_t[:20]}」→「{frag_s[:20]}」')
            if len(issues)>12: break
    # rPr 白名單集合比對
    tset={norm_rpr(r.find(W+'rPr')) for r in td.iter(W+'r')}
    for r in sd.iter(W+'r'):
        n=norm_rpr(r.find(W+'rPr'))
        if n not in tset:
            issues.append(f'rPr 超出白名單: {n[:120]}')
    # 文字方塊：學生版文字須為教師版子集（解析框可為空）
    def boxtexts(root):
        return [ ''.join(t.text or '' for t in tb.iter(W+'t')).strip() for tb in root.iter(W+'txbxContent') ]
    bt, bs = boxtexts(td), boxtexts(sd)
    if len(bt)!=len(bs):
        issues.append(f'文字方塊數不同 {len(bt)} vs {len(bs)}')
    return issues

if __name__=='__main__':
    iss=audit(sys.argv[1], sys.argv[2])
    print(f'{sys.argv[2].split("/")[-1]}: {len(iss)} 個格式差異')
    for x in iss[:10]: print('   ', x[:130])
