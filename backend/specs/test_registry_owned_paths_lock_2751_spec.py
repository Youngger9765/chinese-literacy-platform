"""registry 的 `owns_code` / `owns_data` 指到的東西必須真的存在 (#2751 症狀 3)。

Lock 2 只看 `legacy_tests`。所以一次元件改名（2026-08-10）留下 3 條爛指標、
一修封存 `_parsed_2026-05-01/` 又留下 4 條，而 `specs/run-ci.sh` 從頭到尾全綠 ——
registry 看起來有人管，其實那 7 條誰也沒在看。

⚠️ 這兩個欄位混著 glob 與字面路徑。對 glob 用 `exists()` 會把
`backend/data/lessons/*/v3/*.yml`（2019 個檔）判成不存在。
**把健康條目報成壞掉的 gate 比沒有 gate 更糟**，因為它會被關掉。
"""
import glob as _glob
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / "specs"))

from build_registry import MODULES_DIR, REPO_ROOT, _read_frontmatter, _check_owned_paths

FIELDS = ("owns_code", "owns_data")


def _entries():
    for intent in sorted(MODULES_DIR.glob("*/INTENT.md")):
        fm = _read_frontmatter(intent)
        sid = fm.get("spec_id", intent.parent.name)
        for field in FIELDS:
            for p in (fm.get(field) or []):
                yield sid, field, p


def test_no_owned_path_is_dangling():
    """數量斷言：條目要夠多（否則在測空氣），壞掉的要是 0。"""
    entries = list(_entries())
    assert len(entries) >= 80, f"只掃到 {len(entries)} 條 owns_* —— 這條在測空氣"

    errors: list[str] = []
    _check_owned_paths(errors)
    assert not errors, "registry 指向不存在的路徑：\n" + "\n".join(f"  {e}" for e in errors)


def test_the_check_does_not_flag_a_healthy_glob():
    """負向對照：會把健康 glob 誤報的 gate 會被關掉，等於沒有。

    真的存在 2019 個檔的那個 glob 不可以被判成壞掉。
    """
    healthy = "backend/data/lessons/*/v3/*.yml"
    matched = _glob.glob(str(REPO_ROOT / healthy))
    assert len(matched) >= 500, f"{healthy} 只對到 {len(matched)} 個檔 —— 這條對照本身失效了"

    errors: list[str] = []
    _check_owned_paths(errors)
    assert not any(healthy in e for e in errors), (
        f"健康的 glob 被誤報成壞掉：{[e for e in errors if healthy in e]}"
    )


def test_the_check_still_catches_a_glob_that_matches_nothing(tmp_path, monkeypatch):
    """正向對照：對不到任何檔的 glob 一定要被抓到。

    沒有這條的話，把 `_check_owned_paths` 改成「glob 一律放行」，
    上面兩條照樣全綠。

    ⚠️ 這裡呼叫的是**生產函式本身**，不是在測試裡重排一次它的邏輯。
    用 tmp_path 造一份假的 module，不碰真的 specs/modules（共享目錄不是沙箱）。
    """
    import build_registry as br

    mod = tmp_path / "fake-module"
    mod.mkdir()
    (mod / "INTENT.md").write_text(
        "---\n"
        "spec_id: fake.module\n"
        "owns_code:\n"
        "  - backend/data/lessons/*/v99-does-not-exist/*.yml\n"
        "owns_data:\n"
        "  - backend/app/services/definitely_not_a_real_file.py\n"
        "---\n\n# fake\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(br, "MODULES_DIR", tmp_path)

    errors: list[str] = []
    br._check_owned_paths(errors)

    assert len(errors) == 2, f"應該抓到 2 條（一 glob 一 literal），實際 {len(errors)}: {errors}"
    assert any("v99-does-not-exist" in e for e in errors), f"沒抓到壞 glob: {errors}"
    assert any("definitely_not_a_real_file" in e for e in errors), f"沒抓到壞 literal: {errors}"


def test_main_check_actually_runs_lock_3(tmp_path, monkeypatch, capsys):
    """`--check` 真的有呼叫 Lock 3 —— 驗接線，不只驗行為。

    上面三條都直接呼叫 `_check_owned_paths`。把 `main()` 裡那一行呼叫刪掉，
    三條照樣全綠 —— gate 就這樣被拆掉而沒人知道。這條把接線也鎖住。
    """
    import build_registry as br

    mod = tmp_path / "wired-check"
    mod.mkdir()
    (mod / "INTENT.md").write_text(
        "---\n"
        "spec_id: wired.check\n"
        "owns_code:\n"
        "  - backend/app/services/definitely_not_a_real_file.py\n"
        "---\n\n# fake\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(br, "MODULES_DIR", tmp_path)
    # registry 新鮮度檢查會先擋下來，讓它以為是最新的，好走到 Lock 3
    monkeypatch.setattr(br, "build", lambda: br.REGISTRY.read_text(encoding="utf-8"))

    rc = br.main(["--check"])
    err = capsys.readouterr().err

    assert rc == 1, f"owns_code 指向不存在的檔，--check 應該回 1，實際 {rc}"
    assert "definitely_not_a_real_file" in err, (
        f"--check 沒有跑 Lock 3 —— 錯誤輸出裡看不到那條爛指標：\n{err}"
    )
