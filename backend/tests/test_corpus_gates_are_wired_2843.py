"""把既有的門接上 CI（#2843）。

## 為什麼需要這支

盤點全流程時發現：16 道門裡只有 6 道有 CI 路徑，其中 4 道還是同一天剛加的。
既有的門**存在但沒人跑** —— 那跟不存在的差別只在「有人以為它在守著」，
而那個誤會比沒有門更危險。

不過原因分兩種，混在一起看就會誤判成「都是疏忽」：

| 原因 | 門 | 能不能接 |
|---|---|---|
| **輸入在 CI 裡不存在** | `coverage_gate` / `traditional_only_gate` | ⛔ 接不了 |
| 純粹沒接 | `render_coverage_gate` / `orphan_key_gate` / `keypoints_shape_gate` / `module_migration_gate` / `verbatim_gate` | ✅ 這支接 |

前者讀 `private/curriculum-source/`（`.gitignore:2` 排除），CI checkout 裡沒有那個目錄，
硬接只會得到一道恆紅的門 —— 那是最糟的形狀，紅久了大家學會忽略它。
它們留在本地跑，並在 PRD 記明原因。

## 這支不重寫門的邏輯

只負責「叫它們跑一次、確認 exit 0」。門自己的正確性由門自己的測試管，
這裡管的是**它有沒有被執行**。
"""
from __future__ import annotations

import pathlib
import subprocess
import sys

import pytest

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPTS = REPO_ROOT / "scripts"

#: 輸入只需要 repo 內資料、且實測 exit 0 的門。
#: ⚠️ 加新的進來之前先在本地跑一次確認是綠的 —— 接一道紅的門進 CI
#: 等於擋住所有人，而且大家會學會忽略它。
WIRED = [
    "render_coverage_gate",   # 抽出來的東西前端畫不畫得出來
    "orphan_key_gate",        # 有沒有整節被靜默丟掉
    "keypoints_shape_gate",   # 重點表形狀
    "module_migration_gate",  # 還有幾課停在 v2
]

#: 接不了的，連原因一起寫在這裡 —— 不寫的話下一個人會以為是漏了。
CANNOT_WIRE = {
    "coverage_gate": "讀 private/curriculum-source/（.gitignore:2），CI checkout 沒有那個目錄",
    "traditional_only_gate": "同樣讀 private/curriculum-source/ 比對原稿用字，CI 裡沒有那個目錄",
    "verbatim_gate": "要逐課帶 --uid 參數與原稿，不是全庫掃描型",
}


@pytest.mark.parametrize("gate", WIRED)
def test_gate_still_passes(gate: str):
    script = SCRIPTS / f"{gate}.py"
    assert script.is_file(), f"門不見了：{script}"
    proc = subprocess.run(
        [sys.executable, str(script)],
        cwd=REPO_ROOT, capture_output=True, text=True, timeout=300,
    )
    tail = "\n".join((proc.stdout + proc.stderr).strip().split("\n")[-12:])
    assert proc.returncode == 0, f"{gate} 紅了（exit {proc.returncode}）：\n{tail}"


def test_the_unwirable_ones_are_documented():
    """接不了的門必須留下原因。

    沒有這條的話，下一個盤點的人會把「接不了」當成「漏接」，
    然後接上去得到一道恆紅的門 —— 我今天差點就這麼做。
    """
    for gate, reason in CANNOT_WIRE.items():
        assert (SCRIPTS / f"{gate}.py").is_file(), f"{gate} 已不存在，請從 CANNOT_WIRE 移除"
        assert len(reason) > 10, f"{gate} 的原因寫得太短"


def test_wired_list_is_not_silently_empty():
    """掃描前提 —— 空清單會讓上面的參數化測試一條都不跑，而 CI 仍然綠。"""
    assert len(WIRED) >= 4, f"WIRED 只剩 {len(WIRED)} 道，有人拿掉了門？"
