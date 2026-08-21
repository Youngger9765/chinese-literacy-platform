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


def test_matching_page_count_passes(tmp_path, expected_pages):
    """正向對照 —— 沒有這條，下面的『擋住』可能只是腳本整支壞了。"""
    pdf = tmp_path / "ok.pdf"
    _make_pdf(pdf, expected_pages)
    assert _run(pdf) == 0


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
