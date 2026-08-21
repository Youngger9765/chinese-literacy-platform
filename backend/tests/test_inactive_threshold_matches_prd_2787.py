"""未練習通知的門檻：PRD 寫 7 天，實作是 14 天（#2787 第 1 條）。

PRD 兩處都寫 7 天：

    docs/PRD.md:71   | **早期介入** | … | 學習預警通知（超過 7 天沒進展） |
    docs/PRD.md:652  - [x] 學習預警通知（學生超過 7 天沒進展）

實作是 14 天，而且**程式裡沒有寫任何理由** —— 沒有註解、沒有 issue 連結、
沒有 commit 說明解釋為什麼偏離。既然沒有依據，就照 PRD。

14 天是半個月，對「早期介入」來說太晚 —— PRD 把這條放在早期介入那一列不是巧合。

⚠️ 門檻散在**兩個檔**（alerts 與 notifications）。只改一個的話，
老師在「警示」看到的名單跟在「通知」收到的會對不起來，而且沒有任何東西會叫。
所以這裡除了值本身，也鎖住兩邊一致。
"""
import re
import sys, os
import pathlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

ROOT = pathlib.Path(__file__).resolve().parents[1]
FILES = [
    ROOT / "app" / "routes" / "teacher" / "teacher_alerts.py",
    ROOT / "app" / "routes" / "teacher" / "teacher_notifications.py",
]

PRD_DAYS = 7


def _thresholds(path: pathlib.Path) -> list[int]:
    """這個檔實際用的未練習天數。

    抓兩種寫法：`INACTIVE_DAYS = N` 的常數，以及殘留的 `timedelta(days=N)` 字面值。
    只抓字面值的話，改成常數之後這條就永遠抓不到東西、變成空跑（實際發生過）。
    """
    src = path.read_text(encoding="utf-8")
    out = [int(m) for m in re.findall(r"^INACTIVE_DAYS\s*=\s*(\d+)", src, re.M)]
    out += [int(m) for m in re.findall(r"timedelta\(days=(\d+)\)", src)]
    return out


class TestInactiveThreshold:
    def test_every_file_that_defines_it_uses_the_prd_value(self):
        wrong = []
        for f in FILES:
            for n in _thresholds(f):
                if n != PRD_DAYS:
                    wrong.append(f"{f.name}: timedelta(days={n})")
        assert not wrong, (
            f"PRD 寫 {PRD_DAYS} 天，這些地方不是：\n" + "\n".join(f"  {w}" for w in wrong)
        )

    def test_both_files_agree(self):
        """兩邊不一致 = 老師在警示看到的名單跟通知收到的對不起來。"""
        vals = {f.name: set(_thresholds(f)) for f in FILES}
        assert len(vals) == 2, vals
        a, b = vals.values()
        assert a == b, f"兩個檔的門檻不一致：{vals}"

    def test_the_threshold_is_actually_present(self):
        """正向對照：抓不到任何 timedelta 的話，上面兩條會空跑變綠。"""
        for f in FILES:
            assert _thresholds(f), f"{f.name} 裡抓不到 timedelta(days=N) —— 這條在測空氣"

    def test_the_variable_name_does_not_lie(self):
        """`fourteen_days_ago` 這個名字改完值之後就是錯的。

        名字說 14、值是 7，下一個人讀 code 會被騙。
        """
        for f in FILES:
            src = f.read_text(encoding="utf-8")
            assert "fourteen_days_ago" not in src, (
                f"{f.name} 還留著 `fourteen_days_ago`，但值已經不是 14 了"
            )
