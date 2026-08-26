#!/usr/bin/env python3
"""每一份模組 yml 都有自己的 slug，需要課文的用 text_ref 指過去（#2916）。

## 為什麼

QR 定址的單位是「一個大題」，所以每一個大題都要有**自己的**、穩定的身分。
之前的做法把**課文的 id** 拿去當念順順／重點表／語詞的檔名 ——
等於用別人的身分證當自己的名字。QR 一旦印在紙上就是永久的，
所以在發碼之前必須先把兩件事分乾淨：

    slug      這份檔自己是誰      → 檔名 `{模組}.{slug}.yml`，也寫在內容裡
    text_ref  我需要誰的課文      → 寫**別人的** slug；跨篇的寫多個

課文（full_text_annotate）本身就是被指的對象，不需要 text_ref；
它既有的 id 保留不動（已在登記簿裡，而且是別人指著的目標）。

## 規則

    有篇次的大題   text_ref = 同一篇的課文 slug
    跨篇的大題     text_ref = 這一課全部課文的 slug（依帳本順序）
    單篇課         text_ref = 那唯一一份課文的 slug

⛔ 退役的 id 永不重用（舊紙本的 QR 會指到別的東西）。
"""
from __future__ import annotations
import argparse, pathlib, random, sys, yaml, collections

LES = pathlib.Path('data/lessons')
REG = pathlib.Path('data/part_ids_registry.yml')
#: 紙上會看錯的字元全部排掉（0/O、1/l/I、2/Z、5/S、8/B、g/q）
ALPHABET = "34679acdefhjkmnpqrtuvwxy"
ID_LEN = 5
#: 不是大題的檔（課本身的骨架、衍生檔）
NOT_SECTION = {'lesson', 'metadata', 'errata', '_manifest', 'multi_text_parts'}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()

    reg = yaml.safe_load(REG.read_text(encoding='utf-8')) or {}
    taken = set(reg)
    rng = random.Random(29160825)   # 決定性：同輸入同輸出，重跑不會亂發

    def new_id() -> str:
        while True:
            c = "".join(rng.choice(ALPHABET) for _ in range(ID_LEN))
            if c not in taken:
                taken.add(c)
                return c

    stats = collections.Counter()
    for d in sorted(LES.glob('L*/v3')):
        uid = d.parent.name
        man = yaml.safe_load((d / '_manifest.yml').read_text(encoding='utf-8')) \
            if (d / '_manifest.yml').is_file() else {}
        rows = [s for s in (man.get('sections') or []) if s.get('module')]

        # ── ① 先決定每一份檔自己的 slug（課文保留既有 id）──────────────
        own: dict[pathlib.Path, tuple[str, str]] = {}   # path -> (module, slug)
        for f in sorted(d.glob('*.yml')):
            mod, _, cur = f.stem.partition('.')
            if mod in NOT_SECTION or f.stem.startswith('_'):
                continue
            keep = (mod == 'full_text_annotate' and cur)
            own[f] = (mod, cur if keep else new_id())
            stats['保留' if keep else '新發'] += 1

        # ── ② 課文 slug 依帳本順序，供 text_ref 指過去 ────────────────
        text_by_round: dict[str, str] = {}
        text_order: list[str] = []
        for f, (mod, sid) in own.items():
            if mod != 'full_text_annotate':
                continue
            text_order.append(sid)
            old = f.stem.partition('.')[2]
            if old:
                text_by_round[old] = sid
        # 帳本的順序才是課本順序（檔名字母序跟它無關）
        if rows:
            seq = [s['slug'] for s in rows if s['module'] == 'full_text_annotate' and s.get('slug')]
            if seq:
                text_order = [text_by_round.get(x, x) for x in seq]

        # ── ③ 寫檔：slug 進內容、text_ref 指別人、檔名改成自己的 slug ──
        row_by_file = {s.get('file'): s for s in rows if s.get('file')}
        for f, (mod, sid) in sorted(own.items()):
            doc = yaml.safe_load(f.read_text(encoding='utf-8')) or {}
            body = doc.get(mod) if isinstance(doc.get(mod), dict) else None
            if body is None:
                body = doc
            body['slug'] = sid
            if mod != 'full_text_annotate':
                row = row_by_file.get(f.name)
                rnd = (row or {}).get('slug')          # 帳本說它屬於哪一輪
                if rnd and rnd in text_by_round:
                    body['text_ref'] = text_by_round[rnd]
                elif len(text_order) == 1:
                    body['text_ref'] = text_order[0]
                elif text_order:
                    body['text_ref'] = list(text_order)   # 跨篇：全部
            target = f.with_name(f"{mod}.{sid}.yml")
            if args.apply:
                f.write_text(yaml.safe_dump(doc, allow_unicode=True, sort_keys=False), encoding='utf-8')
                if target != f:
                    f.rename(target)
                reg[sid] = {'status': 'active', 'lesson_uid': uid, 'module': mod,
                            'label_snapshot': f"{uid} {mod}"}
        stats['課'] += 1

    if args.apply:
        head = ''.join(l for l in REG.read_text(encoding='utf-8').splitlines(keepends=True)
                       if l.startswith('#'))
        REG.write_text(head + yaml.safe_dump(reg, allow_unicode=True, sort_keys=True), encoding='utf-8')
    print(f"  {'已套用' if args.apply else 'DRY RUN'}：{stats['課']} 課、"
          f"新發 {stats['新發']}、保留 {stats['保留']}、登記簿 {len(reg)} 筆")
    return 0


if __name__ == '__main__':
    sys.exit(main())
