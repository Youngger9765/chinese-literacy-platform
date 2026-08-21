"""派工單要帶 `pages`，否則拆分是負收益（#2857）。

## 為什麼這支測試存在

拆模組 skill 的成本論證只有一句話：

> 派工單帶 `pages`，所以 N 支飛機的總 token 不會是「全份 × N」。
> **沒有派工單就不該拆**，那會讓成本乘上去。
>                                    —— `.claude/skills/extract-module/SKILL.md`

#2852 落地時 `_manifest.yml` **一份都沒有 `pages`**（174/174 皆無），
而骨架契約與 issue 都寫著「只讀 manifest 指定的 pages」。
也就是說第一條鐵律當時**沒有東西可以遵守** —— 照著做只能讀全份，
於是 24 支飛機各讀一次全份，比不拆還貴。

這支測試把那個空缺變成紅燈，並且鎖住三件會讓它悄悄退化的事。

## 三條鎖各自擋什麼

| 鎖 | 擋的退化 | 沒有它會怎樣 |
|---|---|---|
| `pages` 存在且在紙張範圍內 | 重產 manifest 時把 pages 弄丟 | 回到 #2852 的狀態，而且沒有症狀 |
| `pages` 必須**真的比全份小** | 定位失敗時圖方便寫成「全部頁」 | 門是綠的，成本卻乘上 N —— 最貴的假綠 |
| `dispatch_pages` 的鍵 == `dispatch` | 派了工卻沒給頁碼，或給了沒派工的模組頁碼 | 飛機收到空的 pages，只好自己讀全份 |

第二條是這裡最重要的一條。定位不到的正確處置是**回報定位不到**，
不是塞一個「技術上正確」的全頁範圍 —— 那會讓門永遠是綠的而拆分永遠沒有收益。
"""
from __future__ import annotations

import pathlib

import pytest
import yaml

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
LESSONS = REPO_ROOT / "backend" / "data" / "lessons"

#: 允許「頁碼涵蓋全份」的**絕對數**。實測基準是 4（見下），不是願望。
#:
#: 🔴 **為什麼不能只用比例。** 這條鎖第一版只斷言比例 ≤ 10%，
#: mutation 當場證明它是裝飾品：把**一整課**九個模組的 pages 全部撐成全份，
#: 比例只從 0.28% 變成 0.63%，**門是綠的**。
#: 一課、五課、十課退化都能無聲通過 —— 而那正是這條鎖唯一要擋的事。
#: 絕對數才咬得住：13 > 4 立刻紅。比例留著擋「整批一起退化」，兩個都要。
#:
#: 目前這 4 個是實測既有狀態，不是新退化：
#:   L0044/spotlight(12p) · L0070/spotlight(10p) · L0106/spotlight(9p) · L0136/comprehension(3p)
#: 前三個是聚光燈橫跨整份的課，第四個全份只有 3 頁。
MAX_WHOLE_DOC_MODULES = 4

#: 涵蓋率到多少就算「等於讀全份」。
#: 🔴 第一版用 `len(pages) >= total`，那是**踩線判定** —— mutation 證明寫
#: 「全份減一頁」可以讓 20 課退化而五條鎖全綠，但那跟讀全份幾乎一樣貴。
#: 而 bracketed 的結構上界（`1 .. 最後一個定位到的`）正好會產生這種形狀。
WHOLE_DOC_COVERAGE = 0.9

#: 比例上限。跟絕對數互補：絕對數擋「少數退化」，比例擋「整批退化同時基準被調高」。
MAX_WHOLE_DOC_RATIO = 0.10

#: 頁碼定位不了的課數上限。目前是 L0028 / L0172 —— LibreOffice 整份轉檔無窮迴圈，
#: 原因跟定位無關，解法是拆 subset 再轉（`extract-lesson-multimodal` ②③ 有記載）。
#:
#: ⚠️ 這裡放行的條件是**課自己在 manifest 裡宣告了 `pages_unavailable` 與原因**。
#: 沒宣告就沒收沒有頁碼的課 —— 否則這個豁免會變成「忘了重產」的藏身處。
MAX_PAGES_UNAVAILABLE = 2


def _declared_unavailable(m: dict) -> str | None:
    """這課有沒有**寫明原因**地宣告拿不到頁碼。空字串不算宣告。"""
    reason = m.get("pages_unavailable")
    return reason if isinstance(reason, str) and reason.strip() else None


def _manifests() -> list[tuple[str, dict]]:
    out = []
    for path in sorted(LESSONS.glob("L*/v3/_manifest.yml")):
        out.append((path.parent.parent.name, yaml.safe_load(path.read_text(encoding="utf-8")) or {}))
    return out


@pytest.fixture(scope="module")
def manifests() -> list[tuple[str, dict]]:
    got = _manifests()
    assert got, "掃不到任何 _manifest.yml —— 這是環境壞了，不是通過"
    return got


def test_every_dispatched_module_gets_pages(manifests):
    """派了工就要給頁碼。給不出來要當紅燈，不是留空讓飛機自己讀全份。"""
    broken = []
    for uid, m in manifests:
        if _declared_unavailable(m):
            continue  # 宣告過的欠債，由 test_pages_unavailable_does_not_grow 管
        dispatch = set(m.get("dispatch") or [])
        pages_map = m.get("dispatch_pages") or {}
        for module in sorted(dispatch):
            if not pages_map.get(module):
                broken.append(f"{uid}/{module}: 派了工卻沒有 pages，且該課沒宣告 pages_unavailable")
    assert not broken, (
        f"{len(broken)} 個模組被派工但沒有頁碼，飛機只能讀全份：\n  "
        + "\n  ".join(broken[:15])
    )


def test_pages_unavailable_does_not_grow(manifests):
    """欠債要看得見，而且只能變少。

    ⛔ 這條**不是**豁免條款 —— 它是把「這幾課還沒有頁碼」釘在一個數字上。
    多一課就紅，於是「重產時弄丟頁碼」不會偽裝成既有欠債溜過去。
    """
    declared = {uid: r for uid, m in manifests if (r := _declared_unavailable(m))}
    assert len(declared) <= MAX_PAGES_UNAVAILABLE, (
        f"宣告拿不到頁碼的課從 {MAX_PAGES_UNAVAILABLE} 變成 {len(declared)} 課：\n  "
        + "\n  ".join(f"{u}: {r}" for u, r in sorted(declared.items()))
    )


def test_dispatch_pages_keys_match_dispatch(manifests):
    """鍵集合要對齊 —— 多的是幽靈派工，少的是漏給頁碼。"""
    mismatched = []
    for uid, m in manifests:
        if _declared_unavailable(m):
            continue
        dispatch = set(m.get("dispatch") or [])
        keys = set((m.get("dispatch_pages") or {}))
        if dispatch != keys:
            mismatched.append(f"{uid}: dispatch-only={sorted(dispatch - keys)} pages-only={sorted(keys - dispatch)}")
    assert not mismatched, (
        f"{len(mismatched)} 課的 dispatch 與 dispatch_pages 鍵對不上：\n  "
        + "\n  ".join(mismatched[:15])
    )


def test_pages_stay_inside_the_paper(manifests):
    """頁碼超出紙張 = 定位器算錯，而算錯的頁碼會讓飛機讀到別課的內容。"""
    out_of_range = []
    for uid, m in manifests:
        if _declared_unavailable(m):
            continue
        total = m.get("pdf_pages")
        if not total:
            out_of_range.append(f"{uid}: 沒有 pdf_pages，無從判斷頁碼合不合法")
            continue
        for module, pages in sorted((m.get("dispatch_pages") or {}).items()):
            bad = [p for p in pages if not isinstance(p, int) or p < 1 or p > total]
            if bad:
                out_of_range.append(f"{uid}/{module}: {bad} 不在 1..{total}")
    assert not out_of_range, (
        f"{len(out_of_range)} 筆頁碼落在紙張之外：\n  " + "\n  ".join(out_of_range[:15])
    )


def test_pages_are_actually_narrower_than_the_whole_document(manifests):
    """🔴 這條是拆分能不能成立的那條。

    定位不到時最順手的「修法」是把 pages 寫成全份 —— 門會變綠，
    而拆分的**唯一**理由（少讀幾頁）同時消失。所以這裡量的不是
    「有沒有 pages」而是「pages 有沒有真的比較小」。
    """
    total_modules = 0
    whole_doc = []
    for uid, m in manifests:
        total = m.get("pdf_pages") or 0
        if total <= 1:
            continue  # 單頁學習單，pages == 全份是事實
        for module, pages in sorted((m.get("dispatch_pages") or {}).items()):
            total_modules += 1
            covered = len(set(pages))
            if covered >= total * WHOLE_DOC_COVERAGE:
                whole_doc.append(f"{uid}/{module} 讀 {covered}/{total} 頁")
    assert total_modules > 0, "沒有任何可比較的模組 —— 這是環境壞了，不是通過"
    ratio = len(whole_doc) / total_modules
    # 絕對數先判：只有它擋得住「一兩課退化」（比例會被 1425 這個分母稀釋掉）
    assert len(whole_doc) <= MAX_WHOLE_DOC_MODULES, (
        f"頁碼涵蓋全份的模組從 {MAX_WHOLE_DOC_MODULES} 個變成 {len(whole_doc)} 個 ——"
        f"這些課的拆分沒有任何節省：\n  " + "\n  ".join(whole_doc[:15])
    )
    assert ratio <= MAX_WHOLE_DOC_RATIO, (
        f"{len(whole_doc)}/{total_modules} ({ratio:.1%}) 的模組頁碼涵蓋全份，"
        f"超過基準 {MAX_WHOLE_DOC_RATIO:.0%} —— 拆分在這些課上沒有任何節省。\n  "
        + "\n  ".join(whole_doc[:15])
    )


def test_pdf_pages_matches_the_page_derivation(manifests):
    """🔴 `pdf_pages` 同時是「頁碼合不合法」的上界與「佔比」的分母。

    mutation 顯示：把 `pdf_pages` 乘 3、同時把 pages 寫成整份，
    **兩條鎖一起被買通**（頁碼落在放大的範圍內、佔比被放大的分母稀釋），五條全綠。
    它來自一個 CI 驗不到的管線，之前沒有任何東西交叉檢查它。

    這裡把它釘回它的推導來源 `specs/modules/section-pages.yml` ——
    手改 manifest 就會紅。⚠️ 這**不**保證那個數字本身是對的
    （來源是同一條管線），它保證的是「manifest 沒有被繞過來源手動改過」。
    """
    pages_file = REPO_ROOT / "specs" / "modules" / "section-pages.yml"
    assert pages_file.is_file(), f"頁碼推導來源不見了：{pages_file}"
    derived = (yaml.safe_load(pages_file.read_text(encoding="utf-8")) or {}).get("lessons") or {}
    assert derived, "section-pages.yml 沒有任何課 —— 這是環境壞了，不是通過"

    mismatched = []
    for uid, m in manifests:
        if _declared_unavailable(m):
            continue
        want = (derived.get(uid) or {}).get("pdf_pages")
        got = m.get("pdf_pages")
        if want != got:
            mismatched.append(f"{uid}: manifest 寫 {got}，section-pages.yml 推導出 {want}")
    assert not mismatched, (
        f"{len(mismatched)} 課的 pdf_pages 跟推導來源對不上（manifest 被手改過？）：\n  "
        + "\n  ".join(mismatched[:15])
    )


def test_dispatch_pages_matches_the_page_derivation(manifests):
    """🔴 前面五條量的是**拆分的經濟性**，不是頁碼**對不對**。

    mutation 證明了這個縫隙：把全庫每個模組的 pages 都改成 `[1, 2]` ——
    窄、在範圍內、鍵也對得上 → **六條全綠**，而每一架飛機都會去讀錯的兩頁。

    所以這裡把 `dispatch_pages` 釘回它的推導：
    「該模組名下所有大題的頁碼聯集」，大題來自 `section-pages.yml`、
    歸屬來自 manifest 自己的 `sections`。手改頁碼就會紅。

    ⚠️ 跟 `test_pdf_pages_matches_the_page_derivation` 一樣，這**不**證明
    推導本身是對的（那靠 `build_section_pages` 的序號判別器，以及飛機自己
    「標題不在我這幾頁上就回 BLOCKED」那一步）。它證明的是**沒有人繞過推導手改**。
    """
    pages_file = REPO_ROOT / "specs" / "modules" / "section-pages.yml"
    derived = (yaml.safe_load(pages_file.read_text(encoding="utf-8")) or {}).get("lessons") or {}
    assert derived, "section-pages.yml 沒有任何課 —— 這是環境壞了，不是通過"

    mismatched, checked = [], 0
    for uid, m in manifests:
        if _declared_unavailable(m):
            continue
        rows = (derived.get(uid) or {}).get("sections") or []
        expected: dict[str, set[int]] = {}
        for idx, section in enumerate(m.get("sections") or []):
            module = section.get("module")
            if not module or idx >= len(rows):
                continue
            for page in rows[idx].get("pages") or []:
                expected.setdefault(module, set()).add(page)
        want = {k: sorted(v) for k, v in expected.items()}
        got = {k: list(v) for k, v in (m.get("dispatch_pages") or {}).items()}
        checked += 1
        if want != got:
            only = {k: (want.get(k), got.get(k)) for k in set(want) | set(got) if want.get(k) != got.get(k)}
            mismatched.append(f"{uid}: {dict(list(only.items())[:3])}")
    assert checked > 0, "沒有比對到任何一課 —— 這是環境壞了，不是通過"
    assert not mismatched, (
        f"{len(mismatched)}/{checked} 課的 dispatch_pages 跟推導對不上（被手改過？）：\n  "
        + "\n  ".join(mismatched[:10])
    )
