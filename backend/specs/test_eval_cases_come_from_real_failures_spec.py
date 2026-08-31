"""eval case 要來自真的壞過的東西，而且每一條都要有對照組（#2856）。

票上的理由：**eval-first（先寫一堆 evaluator 再開發）業界實證會製造更多問題。**
case 要從真實壞過的東西長出來。

驗收兩條，這支把它們變成擋：

  ① 每個 case 附 provenance —— 它來自哪一次真實失敗
  ② 配負向對照（正常的課要通過），否則「全部判紅」也會看起來像通過

⛔ 第二條不是形式。今晚實際發生過：
   `space_drift_scan` 的誤報濾網關掉之後會多抓 4 個抽取器自組的字串，
   那 4 個看起來也像「找到問題了」—— 沒有對照組就分不出來。

## 這份 case 的來源

`backend/data/curriculum_qa/eval/cases_from_real_failures.yml` 六條，
全部來自 2026-08-29 ~ 08-31 這一輪**真的壞過**的東西：
現場老師回報 1 條、對帳撈出 2 條、真瀏覽器走查 1 條、孤兒門普查 1 條、
skill 端到端實跑 1 條。**沒有一條是憑空設計的。**
"""
import pathlib

import pytest
import yaml

REPO = pathlib.Path(__file__).resolve().parents[2]
CASES = REPO / "backend/data/curriculum_qa/eval/cases_from_real_failures.yml"


def _cases() -> list:
    return (yaml.safe_load(CASES.read_text(encoding="utf-8")) or {}).get("cases") or []


def test_there_are_cases_at_all():
    """正向對照：檔案空的話下面每一條都恆真。"""
    assert len(_cases()) >= 5, f"只有 {len(_cases())} 條 case"


@pytest.mark.parametrize("c", _cases(), ids=lambda c: c.get("id", "?"))
def test_every_case_says_where_it_came_from(c):
    """⛔ 驗收條件①：沒有 provenance 的 case 就是憑空設計的。"""
    p = c.get("provenance") or {}
    assert p.get("issue"), f"{c.get('id')} 沒說是哪一張票"
    for field in ("found", "symptom"):
        v = str(p.get(field) or "").strip()
        assert len(v) >= 10, f"{c.get('id')} 的 provenance.{field} 太短（{v!r}）"


@pytest.mark.parametrize("c", _cases(), ids=lambda c: c.get("id", "?"))
def test_every_case_has_a_negative_control_with_a_reason(c):
    """⛔ 驗收條件②：少了對照組，「全部判紅」也像通過。

    理由也要寫 —— 「配一課正常的」寫得出來，但寫不出**為什麼是那一課**
    的時候，多半是隨便挑的。
    """
    nc = c.get("negative_control") or {}
    assert nc.get("lesson"), f"{c.get('id')} 沒有負向對照"
    why = str(nc.get("why") or "").strip()
    assert len(why) >= 12, f"{c.get('id')} 的對照組沒寫為什麼是那一課（{why!r}）"


@pytest.mark.parametrize("c", _cases(), ids=lambda c: c.get("id", "?"))
def test_every_case_points_at_a_lock_that_exists(c):
    """case 要對得到一支**真的存在**的鎖，否則它只是一段感想。"""
    lk = str(c.get("locked_by") or "")
    assert lk, f"{c.get('id')} 沒有 locked_by"
    assert (REPO / lk).is_file(), f"{c.get('id')} 指向的鎖不存在：{lk}"


def test_no_two_cases_share_an_id():
    ids = [c.get("id") for c in _cases()]
    assert len(ids) == len(set(ids)), f"id 重複：{ids}"


def test_the_cases_are_not_all_from_one_way_of_finding_things():
    """⛔ 六條都來自同一種發現方式 = 我們只看得到一種失敗。

    今晚這批：現場回報 / 對帳 / 真瀏覽器走查 / 孤兒門普查 / skill 端到端實跑。
    """
    founds = [str((c.get("provenance") or {}).get("found") or "") for c in _cases()]
    kinds = set()
    for f in founds:
        for k in ("回報", "對帳", "走查", "普查", "實跑", "mutation", "門"):
            if k in f:
                kinds.add(k)
    assert len(kinds) >= 3, f"發現方式只有 {sorted(kinds)} —— 太單一，會漏掉別種失敗"
