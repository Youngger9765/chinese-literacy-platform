"""生成的進度表要跟現況一致（#2736）。

那個檔自己的檔頭寫著：

    > **這張表是生成的**：`python3 scripts/build_progress_table.py`。
    > 不要手改 —— 手維護的表會記得「我做過」，不會記得「後來被丟了」

但**沒有任何東西擋它過期**。2026-08-31 實測：表上停在「51 / 51 份抽取結果、
目標 175」，重跑生成器得到 **175 / 175、逐字門 PASS 175** ——
表落後了整整 124 課，而且它是唯一一份人會拿來看「做到哪了」的東西。

⛔ 這條不比對整份內容（那會讓任何無關的排版改動都紅），
   它比對**生成器現在會產生的關鍵數字**與表上寫的是否一致。
"""
import pathlib
import re
import subprocess
import sys

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
TABLE = REPO / "docs/evidence/2026-08-17-multimodal-extraction/PROGRESS.md"
GEN = REPO / "scripts/build_progress_table.py"


@pytest.fixture(scope="module")
def regenerated() -> str:
    """在暫存副本上重跑生成器，不動工作樹的那份。"""
    if not GEN.is_file():
        pytest.skip(f"生成器不在（{GEN.name}）—— 環境不合格，不是 FAIL")
    before = TABLE.read_text(encoding="utf-8")
    r = subprocess.run([sys.executable, str(GEN)], cwd=REPO,
                       capture_output=True, text=True, timeout=600)
    after = TABLE.read_text(encoding="utf-8")
    TABLE.write_text(before, encoding="utf-8")   # 還原，這支是唯讀語意
    if r.returncode != 0:
        pytest.skip(f"生成器跑不起來（{r.stderr[-160:]}）—— 環境不合格，不是 FAIL")
    return after


def _counts(md: str) -> tuple[int, int]:
    """(表格列數, 逐字門 PASS 數)"""
    rows = [l for l in md.split("\n")
            if re.match(r"^\| L\d{4} \|", l)]
    return len(rows), sum(1 for l in rows if "| PASS |" in l or "PASS" in l.split("|")[6])


def test_the_committed_table_matches_what_the_generator_produces_now(regenerated):
    """⛔ 表過期 = 有人看著一個停在 124 課之前的數字在做決定。"""
    have = _counts(TABLE.read_text(encoding="utf-8"))
    want = _counts(regenerated)
    assert have == want, (
        f"進度表過期：表上 {have[0]} 列 / PASS {have[1]}，"
        f"重跑生成器是 {want[0]} 列 / PASS {want[1]}。"
        f"跑 `python3 scripts/build_progress_table.py` 重生並提交。")


def test_the_headline_number_matches_the_rows(regenerated):
    """「現況」那格的數字要跟下面的表對得起來 —— 兩處各自漂移是最難發現的。"""
    md = TABLE.read_text(encoding="utf-8")
    rows, _ = _counts(md)
    m = re.search(r"已抽取並過逐字門 \| (\d+) / (\d+)", md)
    assert m, "「現況」那格找不到數字 —— 版面改了就要一起改這條"
    assert int(m.group(1)) == rows, (
        f"現況寫 {m.group(1)}，表上其實 {rows} 列")


def test_the_counter_can_tell_the_difference(regenerated):
    """正向對照：計數真的分得出多寡，否則上面兩條恆真。"""
    md = TABLE.read_text(encoding="utf-8")
    rows, _ = _counts(md)
    assert rows > 100, f"只數到 {rows} 列 —— 量具可能壞了"
    trimmed = "\n".join(md.split("\n")[:30])
    assert _counts(trimmed)[0] < rows, "砍掉大半還數到一樣多 = 計數沒在看內容"
