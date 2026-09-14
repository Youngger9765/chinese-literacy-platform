"""換 YAML loader 不可以悄悄改變任何一個檔的解析結果。(#3205)

## 為什麼需要這一道

冷啟動有 38.7 秒花在 import 階段解課程 YAML（真環境實測，見下），修法是把
`yaml.safe_load` 換成 libyaml 的 C 實作 `CSafeLoader`。

**C 版跟純 Python 版不是完全等價的實作** —— C 版對少數邊角語法比較嚴。
而 `_read_yaml` 會把任何例外吞成 `None`，所以「C 版解不出來的檔」的症狀是
**那一課靜靜地沒有內容**，不是一個錯誤訊息。那種缺陷會活很久。

這條逐檔比對兩個 loader 的輸出。實測（2026-09-14）2447 個檔**全部相同**、
C 版沒有任何一個解不出來。

## 真環境的數字（staging，不是本機）

```
15:53:30.205  Starting new instance
15:53:31.780  Migrations complete              1.5s
15:53:32.797  Schema check passed              1.0s
15:54:11.530  ← 38.7 秒的沉默（import app，模組層 build_all_lessons 在這裡）
15:54:11.566  Started server process
15:54:12.375  Application startup complete     0.8s
```
使用者實測到的第一個請求：**42.9 秒**（第二次 0.27s、第三次 0.09s）。
`deploy.yml` 是 `--min-instances=0` 且沒有 `--cpu-boost`，所以每次閒置後真的有人在等。

⛔ 不要把這支改成「抽樣幾個檔」—— 邊角語法就住在那些沒人看的檔裡。
"""

from __future__ import annotations

import glob
import pathlib

import pytest
import yaml

BACKEND = pathlib.Path(__file__).resolve().parents[1]


def _corpus() -> list[pathlib.Path]:
    return sorted(
        pathlib.Path(f)
        for f in glob.glob(str(BACKEND / "data" / "lessons" / "**" / "*.yml"), recursive=True)
    )


def test_the_corpus_was_actually_found() -> None:
    """前提：真的掃到檔。

    glob 打錯或資料搬家時，下面那條會變成「零個檔全部一致」而全綠 ——
    跟「兩個 loader 完全等價」長得一模一樣。
    """
    assert len(_corpus()) > 2000, f"只掃到 {len(_corpus())} 個 .yml —— 路徑錯了，下面那條會空轉"


@pytest.mark.skipif(not hasattr(yaml, "CSafeLoader"), reason="這個環境沒有 libyaml")
def test_c_loader_and_python_loader_agree_on_every_file() -> None:
    """兩個 loader 對每一個課程 YAML 的解析結果必須完全相同。"""
    differ: list[str] = []
    c_only_fails: list[str] = []
    for path in _corpus():
        text = path.read_text(encoding="utf-8")
        try:
            py = yaml.load(text, Loader=yaml.SafeLoader)
        except Exception:
            py = ("__error__",)
        try:
            c = yaml.load(text, Loader=yaml.CSafeLoader)
        except Exception as exc:
            c = ("__error__",)
            c_only_fails.append(f"{path.relative_to(BACKEND)}: {exc}"[:160])
        if py != c:
            differ.append(str(path.relative_to(BACKEND)))

    assert not c_only_fails, (
        f"{len(c_only_fails)} 個檔只有 C 版解不出來 —— 它們會靜靜變成沒有內容：\n  "
        + "\n  ".join(c_only_fails[:5])
    )
    assert not differ, (
        f"{len(differ)} 個檔兩個 loader 解出不同結果：\n  " + "\n  ".join(differ[:5])
    )


def test_the_loader_actually_in_use_is_the_fast_one_when_available() -> None:
    """有 libyaml 時就要真的用它 —— 否則這次改動只留下風險沒留下好處。"""
    from app.services.lesson_uid_loader import _YAML_LOADER

    if hasattr(yaml, "CSafeLoader"):
        assert _YAML_LOADER is yaml.CSafeLoader, f"libyaml 在，卻用了 {_YAML_LOADER}"
    else:  # pragma: no cover - 本機與 CI 都有 libyaml
        assert _YAML_LOADER is yaml.SafeLoader
