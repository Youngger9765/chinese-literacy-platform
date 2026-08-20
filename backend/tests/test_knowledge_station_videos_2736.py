"""知識補給站說「沒有影片」，其實有 —— 19 課 / 39 支。

Young 在 staging 點開 `/learn/20001/knowledge-station` 看到：

    videocam_off
    這篇課文目前沒有知識補給站影片

而 `L0001/v3/resources.yml` 裡明明躺著兩支：

    【蘋中人】跨越0.001秒的遺憾 最速男楊俊瀚   (5:23) 蘋果新聞網
    田徑為運動之母! 直擊飛毛腿養成班…          (3:53) TVBS NEWS

兩個獨立的斷點，缺一不可
------------------------
1. `_video_links()` 從 `_meta(l)["video_links"]` 拿 URL —— 那是**一修總表**那側的欄位，
   二修的 v3 metadata 沒有它，所以永遠回 `None`。
2. 就算走到下一行，它找 `resources["items"]` 拿標題，而二修的資料叫 **`videos`**。
   名字對不上 ⇒ `titled` 恆為 False，標題全變成「影片 1」「影片 2」。

第 2 點特別值得記：那不是「壞掉」，是**靜靜地降級**。就算 URL 有了，
學生看到的也會是「影片 1」而不是片名 —— 沒有錯誤、沒有紅字，只是變得比較沒用。

URL 是 2026-08-19 從一修搬過來的（`scripts/migrate_legacy_video_urls.py`，
依課名 + 支數雙重比對，每筆帶 `url_source`），14 課接得上，5 課是二修新課接不上。
"""
from __future__ import annotations

import pathlib
import sys

import yaml

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.services.lesson_indexes import _video_links  # noqa: E402
from app.services.lesson_uid_loader import load_lesson  # noqa: E402

LESSONS = pathlib.Path(__file__).resolve().parent.parent / "data" / "lessons"


def _with_videos() -> list[tuple[str, list[dict]]]:
    out = []
    for d in sorted(LESSONS.iterdir()):
        f = d / "v3" / "resources.yml"
        if not (d.is_dir() and d.name.startswith("L") and f.exists()):
            continue
        doc = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
        vids = ((doc.get("resources") or {}).get("videos")) or []
        if vids:
            out.append((d.name, vids))
    return out


def test_the_corpus_still_has_videos_to_serve():
    """前置：沒有這一條，下面每一條都會在空清單上安靜地通過。"""
    lessons = _with_videos()
    assert len(lessons) >= 19, f"只找到 {len(lessons)} 課有影片 —— 資料變了，下面的斷言在測空氣"


def test_every_lesson_with_videos_serves_them():
    """有影片的課，一支都不能在送到前端的路上消失。"""
    missing = []
    for uid, vids in _with_videos():
        served = _video_links(load_lesson(uid))
        if not served or len(served) != len(vids):
            missing.append((uid, len(vids), 0 if not served else len(served)))
    assert not missing, (
        f"{len(missing)} 課的影片沒送出去（學生看到「沒有影片」）：\n"
        + "\n".join(f"  {u}: 資料有 {a} 支，送出 {b} 支" for u, a, b in missing[:8])
    )


def test_titles_are_the_real_ones_where_the_worksheet_printed_them():
    """學習單有印片名的課，就要送真片名，不可以降級成「影片 1」。

    ⚠️ 只針對**學習單真的列過片名**的課。2026-08-19 之後有 120 課是
    「總表有網址、學習單只印 QR code 沒印片名」——那些課我們手上就是沒有片名，
    顯示「影片 1」是誠實的，不是缺陷。把它們一起要求真片名，這條就會變成
    一個永遠紅的門，然後被無視。

    有片名卻送出佔位字串才是缺陷：那是 `resources["items"]` / `["videos"]`
    欄名對不上造成的靜默降級，沒有錯誤訊息，只是變得比較沒用。
    """
    placeholder = []
    for uid, vids in _with_videos():
        titled = [str(v.get("title") or "").strip() for v in vids]
        for i, v in enumerate(_video_links(load_lesson(uid)) or []):
            has_real_title = i < len(titled) and titled[i] and not titled[i].startswith("影片 ")
            if has_real_title and str(v.get("title", "")).strip().startswith("影片 "):
                placeholder.append((uid, v.get("title")))
    assert not placeholder, (
        f"{len({p[0] for p in placeholder})} 課的片名是佔位字串：\n"
        + "\n".join(f"  {u}: {t!r}" for u, t in placeholder[:6])
    )


def test_migrated_urls_are_reachable_shapes():
    """搬過來的 URL 要是真的 YouTube 連結，而且要留下出處。"""
    bad = []
    for uid, vids in _with_videos():
        for v in vids:
            url = v.get("url")
            if not url:
                continue
            # ⚠️ 不是每一支都是 YouTube。總表裡有 Facebook reel 與一個網站
            # （L0012 / L0026 / L0036 / L0094）。第一版這條斷言「一律是 YouTube」，
            # 把真實資料判成缺陷 —— 假設比資料窄，紅的是測試不是產品。
            # 真正要守的是「是個可以打開的連結」。
            if not url.startswith(("http://", "https://")):
                bad.append((uid, url, "不是可以打開的連結"))
            elif not v.get("url_source"):
                bad.append((uid, url, "沒有 url_source，將來查不到憑什麼掛這一課"))
            elif "總表" not in str(v.get("url_source")):
                bad.append((uid, url, f"url_source 不是總表：{v.get('url_source')}"))
    assert not bad, "\n".join(f"  {u}: {x} — {why}" for u, x, why in bad[:8])


def test_migrated_lessons_actually_serve_their_urls():
    """搬過來的 URL 要真的送到前端 —— 不是只留在 yml 裡。

    ⚠️ 這條是 mutation 逼出來的。原本的四條斷言只驗「支數」跟「片名」，
    把 URL 那條路整段拿掉照樣全綠 —— 因為沒有 URL 時還有一條 fallback 分支
    會把片名送出去，支數和片名都對，看起來一切正常。

    「有連結可以點」跟「看得到片名」是兩件事，要各自有各自的斷言。
    """
    expected = {
        uid: [v["url"] for v in vids if v.get("url")]
        for uid, vids in _with_videos()
    }
    expected = {k: v for k, v in expected.items() if v}
    assert len(expected) >= 14, (
        f"只有 {len(expected)} 課的 yml 帶 URL —— 遷移沒跑過，或資料被回捲了"
    )

    broken = []
    for uid, urls in expected.items():
        served = [v.get("url") for v in (_video_links(load_lesson(uid)) or [])]
        if [u for u in served if u] != urls:
            broken.append((uid, urls, served))
    assert not broken, (
        f"{len(broken)} 課的 URL 沒送到前端（學生看得到片名但點不了）：\n"
        + "\n".join(f"  {u}: yml={a} 送出={b}" for u, a, b in broken[:6])
    )


def test_notes_recording_an_older_sheet_do_not_silently_win():
    """`videos_note` 記的是**抽取當時**那一版總表，不是現在這一版。

    這條測試的來歷值得留著：L0123《爸爸的恩人們》的 note 寫著總表列的是
    `bLOHlPOXfR8` / `hqJkg8Be-ik`，而 0816 這份總表列的是
    `B3mgVn-hXRE` / `oszhrLJ-or8`。我一度認為 note 比較貼近來源，
    把它當權威去「修正」——**修反了**。note 是舊快照，總表是現況。

    所以現在斷言的是相反的方向：**網址一律來自總表**（`url_source` 說得出是哪一列），
    note 只是歷史紀錄，不可以蓋過它。
    """
    wrong_source = []
    for uid, vids in _with_videos():
        for v in vids:
            if not v.get("url"):
                continue
            src = str(v.get("url_source") or "")
            if "總表0816" not in src:
                wrong_source.append((uid, v.get("url"), src or "(空)"))
    assert not wrong_source, (
        "有網址不是從 0816 總表來的（可能是舊腳本或 note 殘留）：\n"
        + "\n".join(f"  {u}: {x} ← {s}" for u, x, s in wrong_source[:8])
    )
