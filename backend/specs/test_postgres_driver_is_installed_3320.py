"""SQLAlchemy 替 `postgresql` scheme 挑的那個 driver，必須真的裝在 image 裡。

為什麼
------
2026-09-25 所有新建的 preview 後端都起不來：

    File "/app/alembic/env.py", line 35, in run_migrations_online
        import psycopg
    ModuleNotFoundError: No module named 'psycopg'
    Container called exit(1).

沒有人改過任何 code。`requirements.txt` 寫 `sqlalchemy>=2.0`（沒有上限），
而 **SQLAlchemy 2.1.0 在 2026-09-24T20:36 發佈**，把 `postgresql` scheme 的預設
DBAPI 從 psycopg2 換成 psycopg(v3)。這個 image 只裝 `psycopg2-binary`。

所以：
  · 09-24 20:36 之前 build 的 image → 2.0.x → psycopg2 → 活著
  · 之後 build 的                  → 2.1.0 → psycopg  → 啟動就死

⚠️ 舊的 preview 服務還活著，只因為它們跑的是舊 image。prod 與 staging 同理 ——
**下一次部署 build 新 image 就會用同一種方式死掉**，這不是 preview 專屬的問題。

這條鎖怎麼設計
--------------
不鎖版本號。鎖**行為**：URL 的 scheme 解析出來的 driver，要 import 得起來。
這樣任何未來的驅動漂移（換 DBAPI、改預設、少裝套件）都會在 CI 被抓到，
而不是只擋住這一個版本。

⚠️ 本機重現不了：image 是 Python 3.11，而 SQLAlchemy 2.1 需要 >=3.11；
專案 venv 是 3.10，`pip install sqlalchemy==2.1.0` 直接 no matching distribution。
「我這台跑得過」對這一類問題完全沒有保證力。
"""
from __future__ import annotations

import importlib
import re
from pathlib import Path

import pytest
from sqlalchemy.engine.url import make_url

REPO = Path(__file__).resolve().parents[1]
REQUIREMENTS = REPO / "requirements.txt"

#: 應用實際在用的 URL 形狀（prod / staging 的 DATABASE_URL 都是這個 scheme）
#: 只寫 scheme，不帶任何帳密/主機 —— 解析 dialect 不需要它們，
#: 而寫了會被 repo 的 secret 掃描器當成真的連線字串。
SCHEMES = ("postgresql", "postgresql+psycopg2")


@pytest.mark.parametrize("scheme", SCHEMES)
def test_the_driver_sqlalchemy_picks_is_importable(scheme: str) -> None:
    """解析出來的 DBAPI 一定要裝得起來 —— 這正是容器啟動時會做的事。"""
    driver = make_url(scheme + "://").get_dialect().driver
    try:
        importlib.import_module(driver)
    except ImportError as exc:  # pragma: no cover - 只有漂移時才會走到
        pytest.fail(
            f"SQLAlchemy 幫 {scheme} scheme 選了 {driver!r}，但這個 image 沒有裝它：{exc}\n"
            f"容器啟動跑 alembic 時會以 exit(1) 死掉，錯誤訊息只會說 "
            f"「container failed to start and listen on PORT」。見 #3320。"
        )


def test_sqlalchemy_has_an_upper_bound() -> None:
    """沒有上限 = 每次 build 都可能裝到當天剛發佈的新 major。

    這不是保守，是必要：2.1.0 發佈 8 小時後，所有新 image 就都壞了，
    而 repo 裡一行 code 都沒改。
    """
    line = next(
        (l for l in REQUIREMENTS.read_text(encoding="utf-8").splitlines()
         if re.match(r"^\s*sqlalchemy\b", l, re.I)),
        None,
    )
    assert line, "requirements.txt 裡找不到 sqlalchemy —— 這條鎖在對空集合斷言"
    assert "<" in line, (
        f"sqlalchemy 沒有版本上限（{line.strip()!r}）。2026-09-24 就是這樣讓 2.1.0 "
        f"自己裝進來、把 postgresql scheme 改成 psycopg3、所有新容器起不來。"
        f"要升 2.1 得連 psycopg3 一起換並驗過，不是隨 build 漂移。"
    )


def test_psycopg2_is_the_declared_driver() -> None:
    """裝的是 psycopg2 就要說清楚；哪天改成 psycopg3，上面那條會一起要求改。"""
    txt = REQUIREMENTS.read_text(encoding="utf-8")
    assert re.search(r"^\s*psycopg2-binary\b", txt, re.M), (
        "requirements.txt 沒有 psycopg2-binary —— 但 sqlalchemy 的上限是為了留在 "
        "psycopg2 才設的，兩者要一起看"
    )
