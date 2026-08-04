# -*- coding: utf-8 -*-
"""教師版 → 學生版 + 答案抽取 + QC 報告"""
import re, sys, copy, unicodedata
WNS='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
import lxml.etree as _ETW

def _style_color(r, d):
    st=r._element.rPr.find(WNS+'rStyle') if r._element.rPr is not None else None
    if st is None: return None
    sid=st.get(WNS+'val')
    for s in d.styles.element.iter(WNS+'style'):
        if s.get(WNS+'styleId')==sid:
            rpr=s.find(WNS+'rPr')
            if rpr is not None and rpr.find(WNS+'color') is not None:
                return rpr.find(WNS+'color').get(WNS+'val')
    return None

def whiten_run(r, d):
    """答案文字改白色（寬度零變動）；底線改為原視覺色，維持作答線外觀"""
    rpr=r._element.get_or_add_rPr() if hasattr(r._element,'get_or_add_rPr') else r._element.rPr
    if rpr is None:
        rpr=_ETW.SubElement(r._element, WNS+'rPr')
        r._element.insert(0, rpr)
    # 原視覺色：run 直接色 > 樣式色 > 黑
    c=rpr.find(WNS+'color')
    orig=c.get(WNS+'val') if c is not None else (_style_color(r, d) or '000000')
    if orig in ('auto', None): orig='000000'
    u=rpr.find(WNS+'u')
    if u is not None and u.get(WNS+'val') not in (None,'none'):
        u.set(WNS+'color', orig)
    if c is None:
        c=_ETW.SubElement(rpr, WNS+'color')
    c.set(WNS+'val','FFFFFF')

def split_run_at(r, lo, hi):
    """把 run 依 [lo,hi) 切成至多三段，回傳中段 run（格式複製）"""
    t=r.text
    el=r._element
    parent=el.getparent()
    idx=list(parent).index(el)
    import copy as _copy
    segs=[]
    for a,b in ((0,lo),(lo,hi),(hi,len(t))):
        if a>=b: segs.append(None); continue
        ne=_copy.deepcopy(el)
        # 清掉除 rPr 以外的子節點，重建單一 w:t
        for ch in list(ne):
            if ch.tag!=WNS+'rPr': ne.remove(ch)
        te=_ETW.SubElement(ne, WNS+'t')
        te.set('{http://www.w3.org/XML/1998/namespace}space','preserve')
        te.text=t[a:b]
        segs.append(ne)
    live=[s for s in segs if s is not None]
    for i,ne in enumerate(live):
        parent.insert(idx+1+i, ne)
    parent.remove(el)
    from docx.text.run import Run
    mid=segs[1]
    return Run(mid, r._parent) if mid is not None else None

def _invisible(c):
    # 變體選擇符、零寬字元等：不佔寬度，原樣保留
    return unicodedata.category(c) in ('Mn','Cf') or '\uFE00'<=c<='\uFE0F' or '\U000E0100'<=c<='\U000E01EF'

def blank_same_width(s):
    visible=[c for c in s if not _invisible(c)]
    core=''.join(visible).strip('　 ')
    out=[]
    if len(core) >= 4:  # 長答案：底線＋零寬空白（斷行同中文字、不收合）
        prev_u=False
        for c in s:
            if _invisible(c):
                out.append(c)
            elif c in '　 ':
                out.append(c); prev_u=False
            else:
                if prev_u: out.append('\u200b')
                out.append('＿' if unicodedata.east_asian_width(c) in 'FW' else '_')
                prev_u=True
        return ''.join(out)
    for c in s:
        out.append(c if _invisible(c) else ('　' if unicodedata.east_asian_width(c) in 'FW' else ' '))
    return ''.join(out)
def blank_trimmed(s):
    b = blank_same_width(s)
    return b[:-1] if len(b) >= 3 else b
import docx
from docx.text.paragraph import Paragraph
from docx.enum.text import WD_UNDERLINE

CIRCLED = '①②③④⑤⑥⑦⑧⑨'
FW_LETTERS = 'ＡＢＣＤＥ'

def para_runs(p):
    return [r for r in p.runs]

def char_map(runs):
    """index in full text -> (run_idx, offset)"""
    m = []
    for i, r in enumerate(runs):
        for j in range(len(r.text)):
            m.append((i, j))
    return m

def set_char(runs, cmap, idx, ch):
    ri, off = cmap[idx]
    t = runs[ri].text
    runs[ri].text = t[:off] + ch + t[off+1:]

def del_char(runs, cmap, idx):
    ri, off = cmap[idx]
    t = runs[ri].text
    runs[ri].text = t[:off] + t[off+1:]

ANSWER_STYLE_NAME = '教材：教師解答'

def answer_style_ids(d):
    ids=set()
    W='{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    for s in d.styles.element.iter(W+'style'):
        nm=s.find(W+'name')
        if nm is not None and nm.get(W+'val')==ANSWER_STYLE_NAME:
            ids.add(s.get(W+'styleId'))
    return ids


def is_white(r):
    rpr=r._element.rPr
    if rpr is None: return False
    c=rpr.find(WNS+'color')
    return c is not None and c.get(WNS+'val')=='FFFFFF'

def whiten_span(runs, cmap, lo, hi, d):
    """把段落文字索引 [lo,hi) 的字元改白色：整 run 白化、邊界 run 切割"""
    by={}
    for idx in range(lo, hi):
        ri, off = cmap[idx]
        by.setdefault(ri, []).append(off)
    for ri in sorted(by, reverse=True):
        offs=by[ri]; a,b=min(offs),max(offs)+1
        r=runs[ri]
        if a==0 and b==len(r.text):
            whiten_run(r, d)
        else:
            mid=split_run_at(r, a, b)
            if mid is not None: whiten_run(mid, d)

def process_doc(path):
    d = docx.Document(path)
    digit_rows = []  # 排序題所在的表格列（列內的時間詞字框為答案記號）
    answers = []   # (kind, context, answer)
    qc = []        # flagged items
    log = []       # every modification
    body = d.element.body
    W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
    seen_p = []
    for pel in body.iter(W+'p'):
        seen_p.append(pel)
    texts_all = [Paragraph(x, d).text for x in seen_p]
    # 影片連結／知識補給站表格：內容非答案，整區跳過
    skip_pels = set()
    for tbl in body.iter(W+'tbl'):
        alltx = ''.join(t.text or '' for t in tbl.iter(W+'t'))
        if '影片連結' in alltx or '知識補給站' in alltx:
            for x in tbl.iter(W+'p'): skip_pels.add(id(x))
    # --- 0. ☒答案記號（Wingdings F0FE）→ 同字型空框（F06F），字寬完全相同、版面零位移 ---
    sym_marked_pels = set()
    for pel in seen_p:
        for s in list(pel.findall('.//'+W+'sym')):
            if s.get(W+'font')=='Wingdings' and (s.get(W+'char') or '').upper()=='F0FE':
                s.set(W+'char','F06F')
                rpr=s.getparent().find(W+'rPr')
                if rpr is not None:
                    c=rpr.find(W+'color')
                    if c is not None: c.set(W+'val','auto')
                sym_marked_pels.add(id(pel))
                log.append((0,'SYM','☒→空框(同字型) 原位替換', Paragraph(pel,d).text[:35]))
    texts_all = [Paragraph(x, d).text for x in seen_p]

    for pi, pel in enumerate(seen_p):
        if id(pel) in skip_pels: continue
        p = Paragraph(pel, d)
        runs = para_runs(p)
        if not runs: continue
        text = ''.join(r.text for r in runs)
        if not text.strip(): continue
        # 段內 F06F sym 之後的第一個文字索引（該處選項已有框）
        sym_after_idx = set()
        if id(pel) in sym_marked_pels:
            pos = 0
            for r in runs:
                for child in r._element:
                    if child.tag == W+'sym' and child.get(W+'font')=='Wingdings' and (child.get(W+'char') or '').upper()=='F06F':
                        sym_after_idx.add(pos)
                    elif child.tag == W+'t':
                        pos += len(child.text or '')
        orig = text
        ctx = text.strip()[:35]

        # --- 1. 題首全形括號答案 （ B ）N. ---
        for m in re.finditer(r'（\s*([A-NＡ-Ｎ])\s*）\s*(\d{1,2})?[\.、]?', text):
            letter = m.group(1)
            qnum = m.group(2) or ''
            cmap = char_map(runs)
            li = m.start(1)
            whiten_span(runs, cmap, li, li+1, d)
            runs = para_runs(p)
            answers.append(('選擇題', f'第{qnum}題' if qnum else ctx, letter))
            log.append((pi, 'MC', f'（ {letter} ）→（　）', ctx))
            text = ''.join(r.text for r in runs)

        # --- 1b. 排序題數字答案（ 3 ）---
        for m in re.finditer(r'（(?:\s|\u3000)+([1-9])(?:\s|\u3000)*）|（(?:\s|\u3000)*([1-9])(?:\s|\u3000)+）', text):
            digit = m.group(1) or m.group(2)
            gi = m.start(1) if m.group(1) else m.start(2)
            cmap = char_map(runs)
            whiten_span(runs, cmap, gi, gi+1, d)
            runs = para_runs(p)
            answers.append(('排序題', ctx, digit))
            log.append((pi, 'DIGIT', f'（ {digit} ）→（ ）', ctx))
            anc=pel.getparent()
            while anc is not None and not anc.tag==W+'tr':
                anc=anc.getparent()
            if anc is not None and anc not in digit_rows: digit_rows.append(anc)
            text = ''.join(r.text for r in runs)

        # --- 2. 半形括號克漏字 ( I ) ---
        # 填答一定有空白墊字：( A )；選項標號是緊貼的 (A)，不可誤刪
        for m in re.finditer(r'\((?:\s|\u3000){1,4}([A-N])(?:\s|\u3000){0,4}\)|\((?:\s|\u3000){0,4}([A-N])(?:\s|\u3000){1,4}\)', text):
            letter = m.group(1) or m.group(2)
            gi = m.start(1) if m.group(1) else m.start(2)
            numm = re.match(r'^\((\d+)\)', text.strip())
            cmap = char_map(runs)
            whiten_span(runs, cmap, gi, gi+1, d)
            runs = para_runs(p)
            answers.append(('語詞應用', f'({numm.group(1)})' if numm else ctx, letter))
            log.append((pi, 'CLOZE', f'( {letter} )→(  )', ctx))
            text = ''.join(r.text for r in runs)

        # --- 2b. 全形字母答案 (Ａ) ---
        for m in re.finditer(r'\(\s*([Ａ-Ｎ])\s*\)', text):
            letter = m.group(1)
            cmap = char_map(runs)
            whiten_span(runs, cmap, m.start(1), m.start(1)+1, d)
            runs = para_runs(p)
            answers.append(('題組', ctx, letter))
            log.append((pi, 'MC-FW', f'({letter})→(　)', ctx))
            text = ''.join(r.text for r in runs)

        # --- 3. 勾選題：無□的圈號選項 → 補□，並記錄為正確答案 ---
        i = 0
        while i < len(text):
            ch = text[i]
            if ch in CIRCLED:
                prev = text[:i].rstrip()
                prev_ch = prev[-1] if prev else ''
                para_has_box = '□' in text
                starts = (text[:i].strip() == '')
                is_option = para_has_box
                n_circ = sum(1 for c in text if c in CIRCLED)
                if not is_option and starts:
                    if n_circ >= 2:
                        # 同段多個圈號且無□ → 編號詞庫，整段跳過
                        qc.append(f'編號詞庫（不補□）：「{text.strip()[:30]}」')
                    else:
                        # 單一圈號：沿連續的圈號選項群上下延伸，群內任一段有□即視為選項群
                        def _is_opt_line(s):
                            s=s.strip()
                            return bool(re.match(r'^□?\s*[①②③④⑤⑥⑦⑧⑨]', s))
                        lo=pi
                        while lo-1>=0 and _is_opt_line(texts_all[lo-1]): lo-=1
                        hi=pi
                        while hi+1<len(texts_all) and _is_opt_line(texts_all[hi+1]): hi+=1
                        group=texts_all[lo:hi+1]
                        if any('□' in g for g in group):
                            is_option = True
                        else:
                            qc.append(f'圈號段落未補□（群內皆無□，研判非選項）：「{text.strip()[:30]}」')
                if n_circ >= 2 and not para_has_box:
                    break  # 詞庫段落：整段不處理
                # 圈號前（略過空白）緊鄰空框 sym → 已有框，跳過
                near_sym = any(sp <= i and text[sp:i].strip('　 ') == '' for sp in sym_after_idx)
                if near_sym:
                    i += 1; continue
                if prev_ch != '□' and is_option:
                    # 取選項文字（到下個 □ 或行尾）
                    rest = text[i+1:]
                    stop = len(rest)
                    for stopper in ['□', '　　']:
                        k = rest.find(stopper)
                        if k != -1: stop = min(stop, k)
                    opt = rest[:stop].strip()[:40]
                    cmap = char_map(runs)
                    ri, off = cmap[i]
                    t = runs[ri].text
                    runs[ri].text = t[:off] + '□' + t[off:]
                    answers.append(('勾選題', ctx, ch + opt))
                    log.append((pi, 'BOX', f'補□於 {ch}{opt[:15]}', ctx))
                    text = ''.join(r.text for r in runs)
                    i += 1
            i += 1

        # --- 4. 【答案】清空（逐 run 整段替換，由後往前處理）---
        import unicodedata as _ud
        matches = list(re.finditer(r'【([^【】]{1,60}?)】', text))
        for m in reversed(matches):
            inner = m.group(1)
            if inner.strip('　 ') == '':
                continue
            if '□' in inner or any(c in inner for c in CIRCLED):
                continue
            if inner[0] not in '　 ' and inner[-1] not in '　 ':
                qc.append(f'緊貼【】未清空（研判為標籤非答案）：【{inner[:15]}】｜{ctx}')
                continue
            answers.append(('填空', ctx, inner.strip('　 ')))
            cmap = char_map(runs)
            whiten_span(runs, cmap, m.start(1), m.end(1), d)
            runs = para_runs(p)
            log.append((pi, 'BRACKET', f'【{inner.strip()[:20]}】白化', ctx))
        text = ''.join(r.text for r in runs)

        # --- 5. 粗底線填答 ---
        groups = []
        cur = []
        for r in runs:
            if r.font.underline == WD_UNDERLINE.THICK and not is_white(r):
                cur.append(r)
            else:
                if cur: groups.append(cur); cur = []
        if cur: groups.append(cur)
        for g in groups:
            gt = ''.join(r.text for r in g)
            core = gt.strip('　 ')
            if not core or '【' in gt: continue
            is_vocab = bool(re.match(r'^\(\d+\)', text.strip())) and '：' in text
            is_ref = '參考答案' in core  # 開放題參考答案
            if is_ref or (len(core) <= 12 and not re.search(r'[，。；！？]', core)) or (is_vocab and len(core) <= 15 and '。' not in core):
                answers.append(('填空(底線)', ctx, core))
                for r in g:
                    whiten_run(r, d)
                log.append((pi, 'ULINE', f'底線答案「{core}」白化', ctx))
            else:
                qc.append(f'底線過長未自動清空（請人工確認）：段落「{ctx}」→「{core[:40]}」')

    # --- 5b. 跨段落填空（直式儲存格：】長高【 這類跨段括號）---
    import unicodedata as _ud2
    for tc in body.iter(W+'tc'):
        cell_paras=[c for c in tc if c.tag==W+'p']
        if len(cell_paras)<2: continue
        stream=[]  # (char, para, run, offset)
        for cp in cell_paras:
            P=Paragraph(cp,d)
            for r in P.runs:
                for j,ch in enumerate(r.text):
                    stream.append([ch,cp,r,j])
            stream.append(['\n',cp,None,None])
        chars=''.join(x[0] for x in stream)
        if chars.count('【')+chars.count('】')<2: continue
        pos=[i for i,c in enumerate(chars) if c in '【】']
        for a,b in zip(pos[::2],pos[1::2]):
            seg=chars[a+1:b]
            core=seg.replace('\n','').strip('　 ')
            if not core: continue
            para_span=len({id(stream[i][1]) for i in range(a+1,b) if stream[i][2] is not None})
            if para_span<2: continue          # 同段落的已由主流程處理
            if len(core)>12 or any(c in core for c in '□①②③④⑤。，？！'):
                qc.append(f'跨段括號內容未清空(請確認): 「{core[:20]}」')
                continue
            answers.append(('填空(跨段)','直式儲存格',core))
            edits=0
            by_run={}
            for i in range(a+1,b):
                ch,cp,r,j=stream[i]
                if r is None: continue
                by_run.setdefault(id(r), [r, []])[1].append(j)
            for rid,(r,offs) in by_run.items():
                lo,hi=min(offs),max(offs)+1
                if lo==0 and hi==len(r.text):
                    whiten_run(r, d)
                else:
                    mid=split_run_at(r, lo, hi)
                    if mid is not None: whiten_run(mid, d)
                edits+=1
            if edits: log.append((0,'XBRACKET',f'跨段填空「{core}」白化','直式儲存格'))

    # --- 6b. 清空「教材：教師解答」樣式的 run（權威答案標記）---
    import unicodedata as _ud3
    sids = answer_style_ids(d)
    if sids:
        for pel in body.iter(W+'p'):
            P=Paragraph(pel,d)
            head=P.text.strip()[:2]
            in_option = bool(head) and (head[0] in '□①②③④⑤⑥⑦⑧⑨' )
            for r in P.runs:
                st=r._element.rPr.find(W+'rStyle') if r._element.rPr is not None else None
                if st is None or st.get(W+'val') not in sids: continue
                if is_white(r): continue
                core=r.text.strip('　 \u00A0')
                if not core: continue
                if in_option:
                    qc.append(f'選項句內出現解答樣式（疑原檔誤用格式，未清空）：「{core[:15]}」｜{P.text[:30]}')
                    continue
                answers.append(('參考答案(樣式)', P.text[:30], core))
                whiten_run(r, d)
                log.append((0,'STYLE',f'解答樣式run「{core[:15]}」白化', P.text[:30]))

    # --- 6b2. 排序題列內的字框（w:bdr）為圈選答案記號，移除 ---
    for tr in digit_rows:
        for r_el in tr.iter(W+'r'):
            rpr=r_el.find(W+'rPr')
            if rpr is None: continue
            bdr=rpr.find(W+'bdr')
            if bdr is not None:
                rpr.remove(bdr)
                t=''.join(x.text or '' for x in r_el.findall(W+'t'))
                log.append((0,'RUNBDR',f'移除排序題列中字框「{t[:10]}」','排序表'))
                answers.append(('圈選答案(字框)','排序表', t[:20]))

    # --- 6c. 移除紅框答案圈選圖形（教師圈出時間詞等）---
    MC_NS2='{http://schemas.openxmlformats.org/markup-compatibility/2006}'
    A_NS='{http://schemas.openxmlformats.org/drawingml/2006/main}'
    RED={'FF0000','EE0000','C00000','RED','E97132','ED7D31','4472C4'}  # 4472C4=解析框指引線
    def _is_red_marker(container):
        has_text=any((t.text or '').strip() for t in container.iter(W+'t'))
        if has_text: return False
        for ln in container.iter(A_NS+'ln'):
            sf=ln.find(A_NS+'solidFill')
            if sf is not None:
                c=sf.find(A_NS+'srgbClr')
                if c is not None and (c.get('val') or '').upper() in RED: return True
                sc=sf.find(A_NS+'schemeClr')
                if sc is not None and sc.get('val') in ('accent1','accent2'): return True
        for el in container.iter():
            if el.tag.startswith('{urn:schemas-microsoft-com:vml}'):
                stroke=(el.get('strokecolor') or '').upper().lstrip('#')
                if stroke.split(' ')[0].lstrip('#') in RED or stroke[:6] in RED: return True
        return False
    import lxml.etree as _ET9
    def _hide_shape(cont):
        n=0
        for ln in cont.iter(A_NS+'ln'):
            for ch in list(ln): ln.remove(ch)
            _ET9.SubElement(ln, A_NS+'noFill'); n+=1
        for el in cont.iter():
            if el.tag.startswith('{urn:schemas-microsoft-com:vml}') and (el.get('strokecolor') or el.get('stroked')):
                el.set('stroked','f'); n+=1
        return n
    for pel in body.iter(W+'p'):
        for cont in list(pel.iter(MC_NS2+'AlternateContent')) + [x for x in pel.iter(W+'drawing') ] + [x for x in pel.iter(W+'pict')]:
            par=cont.getparent()
            if par is None: continue
            if cont.tag!=MC_NS2+'AlternateContent' and par.getparent() is not None and any(a.tag==MC_NS2+'AlternateContent' for a in [par.getparent()] ): continue
            if _is_red_marker(cont):
                _hide_shape(cont)   # 隱形化：保留佔位與列高，僅隱藏框線
                log.append((0,'REDMARK','記號/指引線隱形化', Paragraph(pel,d).text[:30]))

    # --- 7. 教師解析文字方塊（字色 0F4761）→ 隱形化：清空文字＋隱藏框線，保留佔位（版面不動）---
    A_NS2='{http://schemas.openxmlformats.org/drawingml/2006/main}'
    cleared_boxes=set()
    for tb in list(body.iter(W+'txbxContent')):
        cols={c.get(W+'val') for c in tb.iter(W+'color')}
        if '0F4761' not in cols: continue
        txt=''.join((t.text or '') for t in tb.iter(W+'t')).strip()
        if not txt: continue
        for t in tb.iter(W+'t'):
            t.text=''
        # 隱藏整個解析裝置（方塊＋群組內的指引線）：往上到 w:r，抹掉其下所有外框
        import lxml.etree as _ET2
        anc=tb
        while anc is not None and anc.tag!=W+'r': anc=anc.getparent()
        if anc is not None:
            for ln in anc.iter(A_NS2+'ln'):
                for ch in list(ln): ln.remove(ch)
                _ET2.SubElement(ln, A_NS2+'noFill')
            for el in anc.iter():
                if el.tag.startswith('{urn:schemas-microsoft-com:vml}') and (el.get('strokecolor') or el.get('stroked')):
                    el.set('stroked','f')
        if txt[:25] not in cleared_boxes:
            cleared_boxes.add(txt[:25])
            log.append((0,'ANNOT','解析方塊隱形化', txt[:35]))
            answers.append(('教師解析(隱形化)', '', txt[:80]))
    return d, answers, qc, log

def save_exact(d, src_path, out_path):
    """只替換 document.xml，其餘部件位元組不動"""
    import zipfile, lxml.etree as _ET
    xml = _ET.tostring(d.element.getroottree().getroot(), encoding='UTF-8', standalone=True)
    # 比照 Word 的宣告格式
    xml = xml.replace(b"<?xml version='1.0' encoding='UTF-8' standalone='yes'?>",
                      b'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n', 1)
    zin = zipfile.ZipFile(src_path)
    with zipfile.ZipFile(out_path, 'w', zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == 'word/document.xml':
                data = xml
            zout.writestr(item, data)

if __name__ == '__main__':
    src, out_student, out_ans, out_qc = sys.argv[1:5]
    d, answers, qc, log = process_doc(src)
    save_exact(d, src, out_student)
    with open(out_ans, 'w') as f:
        for k, c, a in answers:
            clean=lambda s: s.replace('\t',' ').replace('\n',' ').replace('\r',' ')
            f.write(f'{clean(k)}\t{clean(c)}\t{clean(a)}\n')
    with open(out_qc, 'w') as f:
        f.write(f'共修改 {len(log)} 處；抽出答案 {len(answers)} 筆\n\n== 需人工確認 ==\n')
        for x in qc: f.write(x + '\n')
        f.write('\n== 修改明細 ==\n')
        for pi, kind, desc, ctx in log:
            f.write(f'[{kind}] {desc} ｜ 位置：{ctx}\n')
    print(f'{src.split("/")[-1]}: {len(log)} edits, {len(answers)} answers, {len(qc)} flags')
