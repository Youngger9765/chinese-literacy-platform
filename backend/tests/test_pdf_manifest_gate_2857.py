"""派工前的 PDF／派工單頁數對帳（#2857 B1）。

## 為什麼這道門必須存在

派工單的 `pages` 是對某一次 DOCX→PDF 轉檔算的，那份 PDF 只活在暫存目錄。
飛機拿到的是另一次獨立轉檔的產物，而兩次不保證一樣 —— 實測同一份 DOCX
連轉三次：L0016 → 8/9/9 頁，L0013 → 11/10/11 頁。整份對比 172 課，
7 課頁數不同、11 課共 33 個大題頁碼不同。

⛔ 失敗形狀是**靜默截斷**：span 含下一節的起始頁，位移一頁通常仍有重疊，
飛機會找到自己那一節的一部分、然後回報成功。

## 這支測什麼

只測這道門本身分不分得出來 —— 不測不可重現的根因（未查明）。
每條都配正向對照：少了它，「擋住」可能只是整支腳本壞了。
"""
from __future__ import annotations

import pathlib
import shutil
import subprocess
import sys

import pytest
import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
GATE = REPO / "scripts" / "assert_pdf_matches_manifest.py"
UID = "L0011"


def _make_pdf(path: pathlib.Path, pages: int) -> None:
    objs = [
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
        "2 0 obj\n<< /Type /Pages /Kids [%s] /Count %d >>\nendobj\n"
        % (" ".join(f"{3 + i} 0 R" for i in range(pages)), pages),
    ]
    objs += [
        f"{3 + i} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n"
        for i in range(pages)
    ]
    head = "%PDF-1.4\n"
    offs, pos = [], len(head)
    for o in objs:
        offs.append(pos)
        pos += len(o)
    xref = f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n" + "".join(
        f"{o:010d} 00000 n \n" for o in offs
    )
    path.write_text(
        head + "".join(objs) + xref
        + f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{pos}\n%%EOF\n"
    )


def _run(pdf: pathlib.Path) -> int:
    return subprocess.run(
        [sys.executable, str(GATE), "--uid", UID, "--pdf", str(pdf)],
        cwd=REPO, capture_output=True, text=True, timeout=120,
    ).returncode


@pytest.fixture(scope="module")
def expected_pages() -> int:
    mf = REPO / "backend" / "data" / "lessons" / UID / "v3" / "_manifest.yml"
    if not mf.is_file():
        pytest.skip(f"{UID} 沒有派工單")
    n = (yaml.safe_load(mf.read_text(encoding="utf-8")) or {}).get("pdf_pages")
    if not isinstance(n, int) or n <= 0:
        pytest.skip(f"{UID} 的派工單沒有 pdf_pages")
    return n


# 2026-08-22：⑤ 從「只比頁數」升級成「比每頁文字指紋」。
# 合成的空白 PDF 頁數對得上，但文字對不上 —— **新門本來就該擋**，
# 那正是升級要抓的東西（L0072 兩份都 9 頁、第 3 頁不同）。
# 所以正向對照換一課：`L0028` 有派工單但還沒存指紋，走的是「舊資料只比頁數」
# 那條路 —— ⛔ 這條不可以拿掉：沒有它，下面每一個「擋住」都可能只是腳本壞了。
UID_NO_PRINTS = "L0028"

# 指紋那兩條真的需要 poppler。沒裝時門會回 2「算不出這份 PDF 的指紋」——
# 那是正確的 fail-closed，但測不到東西。
# ⚠️ 所以 `.github/workflows/pytest.yml` 必須裝 poppler-utils，
#    否則它們會在 CI 靜默 skip —— 而**被 skip 的對照等於沒有對照**。
#    下面 `test_ci_installs_poppler` 鎖住那件事。
needs_poppler = pytest.mark.skipif(
    shutil.which("pdftotext") is None or shutil.which("pdfinfo") is None,
    reason="沒有 poppler（pdftotext / pdfinfo）",
)


def _run_uid(uid: str, pdf: pathlib.Path) -> int:
    return subprocess.run(
        [sys.executable, str(GATE), "--uid", uid, "--pdf", str(pdf)],
        cwd=REPO, capture_output=True, text=True, timeout=120,
    ).returncode


@needs_poppler
def test_matching_fingerprints_pass(tmp_path):
    """正向對照 —— 沒有這條，下面每一個『擋住』都可能只是腳本壞了。

    CI 沒有 private/，生不出「指紋真的對得上」的真 PDF，所以這裡自己造一份：
    合成 PDF → 用同一支 `page_print` 算出它的指紋 → 寫進臨時 DB → 門必須放行。
    ⛔ 這條被 skip 掉就等於沒有正向對照。
    """
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "bsp", REPO / "scripts" / "build_section_pages.py")
    bsp = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bsp)

    pdf = tmp_path / "ok.pdf"
    _make_pdf(pdf, 3)
    prints = [bsp.page_print(t) for t in bsp.page_texts(pdf)]
    db = tmp_path / "section-pages.yml"
    db.write_text(yaml.safe_dump(
        {"lessons": {UID: {"pdf_pages": 3, "page_prints": prints}}},
        allow_unicode=True), encoding="utf-8")

    mf = REPO / "backend" / "data" / "lessons" / UID / "v3" / "_manifest.yml"
    if not mf.is_file():
        pytest.skip(f"{UID} 沒有派工單")
    orig = yaml.safe_load(mf.read_text(encoding="utf-8")) or {}
    if orig.get("pdf_pages") != 3:
        # 派工單記的頁數不是 3 → 頁數那一關就會擋，測不到指紋這一關。
        # 改用派工單自己的頁數重造。
        n = orig.get("pdf_pages")
        if not isinstance(n, int) or n <= 0:
            pytest.skip(f"{UID} 的派工單沒有 pdf_pages")
        _make_pdf(pdf, n)
        prints = [bsp.page_print(t) for t in bsp.page_texts(pdf)]
        db.write_text(yaml.safe_dump(
            {"lessons": {UID: {"pdf_pages": n, "page_prints": prints}}},
            allow_unicode=True), encoding="utf-8")

    rc = subprocess.run(
        [sys.executable, str(GATE), "--uid", UID, "--pdf", str(pdf), "--db", str(db)],
        cwd=REPO, capture_output=True, text=True, timeout=120)
    assert rc.returncode == 0, f"指紋對得上卻被擋：\n{rc.stdout}\n{rc.stderr}"

    # 負向對照：只改一頁的指紋就要擋
    bad = dict(yaml.safe_load(db.read_text(encoding="utf-8")))
    bad["lessons"][UID]["page_prints"][0] = "dead-beef-0000"
    db.write_text(yaml.safe_dump(bad, allow_unicode=True), encoding="utf-8")
    rc2 = subprocess.run(
        [sys.executable, str(GATE), "--uid", UID, "--pdf", str(pdf), "--db", str(db)],
        cwd=REPO, capture_output=True, text=True, timeout=120)
    assert rc2.returncode == 1, "改了一頁指紋卻放行 —— 這道門沒有在看"


@needs_poppler
def test_same_page_count_but_different_content_is_blocked(tmp_path, expected_pages):
    """頁數一樣、內容不同 → 擋。這是 ⑤ 升級的全部意義。

    舊版只比頁數，這種情況整批放行 —— 而那正是 ② 最常見的失敗形狀：
    同一份 DOCX 轉兩次，頁數可能一樣但版面重排，派工單上的頁碼指向別頁。
    """
    pdf = tmp_path / "same-count.pdf"
    _make_pdf(pdf, expected_pages)     # 頁數對，但是空白頁，文字指紋一定不同
    assert _run(pdf) == 1


def test_one_page_off_is_blocked(tmp_path, expected_pages):
    """差一頁就要擋 —— 實測的漂移正是 ±1，而那足以讓每一節整體位移。"""
    pdf = tmp_path / "off.pdf"
    _make_pdf(pdf, expected_pages + 1)
    assert _run(pdf) == 1


def test_unreadable_pdf_is_not_treated_as_a_match(tmp_path):
    """材料不齊要回 2，⛔ 不可以因為『數不出來』就放行。"""
    assert _run(tmp_path / "nope.pdf") == 2


def test_gate_is_referenced_by_the_skills_that_must_run_it():
    """門建了沒插電 = 比沒有門更糟，因為大家以為它在守。

    這條盯的是「航母與飛機的 SKILL 有沒有真的叫它」——
    #2843 盤點時 16 道門只有 1 道從 CI 到得了，就是這個病。
    """
    for rel in (
        ".claude/skills/extract-lesson-multimodal/SKILL.md",
        ".claude/skills/extract-module/SKILL.md",
    ):
        text = (REPO / rel).read_text(encoding="utf-8")
        assert "assert_pdf_matches_manifest.py" in text, f"{rel} 沒有叫這道門"


# ---------------------------------------------------------------------------
# N2：低信心標記要放在飛機讀得到的地方
# ---------------------------------------------------------------------------

def test_bracketed_sections_are_flagged_where_the_plane_reads():
    """`pages_source: bracketed` 寫在 sections[]，但飛機讀的是 dispatch_pages。

    少了這條對照，23 個低信心標記一個都到不了使用端 —— 飛機拿到一段
    可能寬達 54% 的範圍，而它不知道那是夾出來的。

    這裡用**數量相等**斷言：只驗「有一課帶了標記」的話，
    另外 14 課漏掉照樣綠（2026-08-19 五次只修一半的根因）。
    """
    lessons = sorted((REPO / "backend" / "data" / "lessons").glob("L*/v3/_manifest.yml"))
    assert len(lessons) > 100, f"只找到 {len(lessons)} 份派工單，掃描前提不成立"

    expected, flagged = set(), set()
    for f in lessons:
        m = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        uid = f.parts[-3]
        for s in m.get("sections") or []:
            if s.get("module") and s.get("pages") and s.get("pages_source") == "bracketed":
                expected.add((uid, s["module"]))
        for mod in m.get("low_confidence_pages") or []:
            flagged.add((uid, mod))

    assert expected, "一個 bracketed 都沒有 —— 這條鎖失去意義（資料是不是被重產成全定位了？）"
    assert flagged == expected, (
        f"sections[] 標了 {len(expected)} 個 bracketed，"
        f"dispatch 層只標了 {len(flagged)} 個。差額：{sorted(expected ^ flagged)[:5]}"
    )


def test_the_module_skill_tells_the_plane_to_check_it():
    """標記放進派工單但沒人叫飛機看 = 又一道沒插電的門。"""
    text = (REPO / ".claude" / "skills" / "extract-module" / "SKILL.md").read_text(encoding="utf-8")
    assert "low_confidence_pages" in text, "飛機的契約沒提到這個欄位"


def test_ci_installs_poppler():
    """CI 必須裝 poppler，⛔ 否則指紋那兩條會靜默 skip。

    被 skip 的正向對照等於沒有正向對照 —— 而指紋是擋「版面重排」的唯一一道門，
    它在 CI 裡零覆蓋的話，這整個升級只在我的機器上成立。
    """
    wf = (REPO / ".github" / "workflows" / "pytest.yml").read_text(encoding="utf-8")
    assert "poppler-utils" in wf, "pytest workflow 沒裝 poppler-utils"
