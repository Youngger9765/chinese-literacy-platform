"""
Tests for URL rewriting in lesson_layer_loaders.py — issue #2486.

lingoleap-assets is going private. Every URL the backend hands to the frontend
for content in that bucket (thumbnails, worksheet PDFs/DOCX) must point at our
own `/assets/...` proxy instead of the absolute
`https://storage.googleapis.com/lingoleap-assets/...` GCS URL — otherwise those
URLs 403 the moment the bucket ACL flips.

320+ YAML source files still contain literal absolute GCS URLs for
`worksheet_pdf_url` (out of scope to hand-edit every one) — `_to_asset_proxy_url`
is the single point where those get rewritten before reaching an API response.

TDD: written before the lesson_layer_loaders.py rewrite. Red -> Green -> Refactor.
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.lesson_layer_loaders import (
    _to_asset_proxy_url,
    _derive_docx_url,
)
# `load_layer1_lessons` 曾經被這裡 import —— 那支讀一修的扁平檔，
# 檔案封存後它恆回 `[]`（見下方 TestNoAbsoluteGcsUrl 的說明），
# 測試早就改用 `search_lessons()`，只剩 import 沒清。函式已於 #2916 刪除。


class TestToAssetProxyUrl:
    def test_rewrites_absolute_gcs_url_to_relative_proxy_path(self):
        absolute = "https://storage.googleapis.com/lingoleap-assets/worksheets/G5-L23.pdf"
        assert _to_asset_proxy_url(absolute) == "/assets/worksheets/G5-L23.pdf"

    def test_rewrites_lessons_images_url(self):
        absolute = "https://storage.googleapis.com/lingoleap-assets/lessons-images/G4-L1/G4-L1-01.jpg"
        assert _to_asset_proxy_url(absolute) == "/assets/lessons-images/G4-L1/G4-L1-01.jpg"

    def test_passes_through_none(self):
        assert _to_asset_proxy_url(None) is None

    def test_passes_through_empty_string(self):
        assert _to_asset_proxy_url("") == ""

    def test_passes_through_already_relative_url_unchanged(self):
        """Idempotent — a URL already rewritten (or authored relative) is untouched."""
        assert _to_asset_proxy_url("/assets/worksheets/G5-L23.pdf") == "/assets/worksheets/G5-L23.pdf"

    def test_does_not_touch_unrelated_absolute_url(self):
        """A URL pointing somewhere else entirely (not our bucket) must not be mangled."""
        other = "https://example.com/some/other/file.pdf"
        assert _to_asset_proxy_url(other) == other


class TestDeriveDocxUrlIsRelative:
    def test_derived_docx_url_uses_asset_proxy_base(self):
        # Any grade_code from the checked-in manifest works; use a known one
        # if present, else just check the shape via a monkeypatched code set.
        import app.services.lesson_layer_loaders as loaders
        original_codes = loaders._DOCX_CODES
        try:
            loaders._DOCX_CODES = frozenset({"G4-L01"})
            url = _derive_docx_url("G4-L01")
            assert url == "/assets/worksheets/G4-L01.docx"
            assert not url.startswith("https://")
        finally:
            loaders._DOCX_CODES = original_codes

    def test_derive_docx_url_returns_none_for_unknown_code(self):
        assert _derive_docx_url("NOT-A-REAL-CODE") is None

    def test_derive_docx_url_returns_none_for_empty_code(self):
        assert _derive_docx_url("") is None
        assert _derive_docx_url(None) is None


class TestNoAbsoluteGcsUrlReachesTheClient:
    """整條服務路徑上不可以出現絕對 GCS URL —— #2486 的不變量。

    ⚠️ **這一段原本是四條空跑的測試**（2026-08-18 查出）。它們迭代
    `load_layer1_lessons()`，而那支讀的是一修的扁平檔 `data/lessons/L*.yml`，
    那批檔案隨一修封存刪除之後它就恆回 `[]` —— 迭代空集合的 for 迴圈裡
    一條斷言都不會執行，測試永遠綠。

    mutation 證實過：把 `_to_asset_proxy_url` 改成永遠回絕對 GCS URL，
    同檔的 9 條單元測試有 4 條轉紅（突變確實生效），那四條整合測試照樣綠。

    換成掃**現在真的在服務的**語料（uid tree，175 課）。附下限：
    掃不到課要講「沒掃到」，不是靜靜地通過。
    """

    # 掃不到課時 `0 個違規` 也會綠。這個下限讓那種情況講實話。
    MIN_LESSONS = 100

    @staticmethod
    def _served_lessons():
        from app.services.lesson_loader import search_lessons

        lessons = search_lessons()
        assert len(lessons) >= TestNoAbsoluteGcsUrlReachesTheClient.MIN_LESSONS, (
            f"只載到 {len(lessons)} 課，少於下限 —— "
            "這代表這支測試沒掃到語料，不是語料變乾淨了"
        )
        return lessons

    def test_no_absolute_gcs_url_anywhere_in_the_served_payload(self):
        """深掃整個 payload，不只頂層那幾個欄位。

        原本只查 `thumbnail_url` / `worksheet_pdf_url` / `worksheet_docx_url`
        三個頂層鍵。一個絕對 URL 藏在 `spotlight_v2` 或 `keypoints` 裡照樣會 403。
        """
        import json

        bad = []
        for lesson in self._served_lessons():
            blob = json.dumps(lesson, ensure_ascii=False)
            if "storage.googleapis.com" in blob:
                i = blob.index("storage.googleapis.com")
                bad.append((lesson.get("lesson_uid"), blob[max(0, i - 30): i + 60]))
        assert not bad, (
            f"{len(bad)} 課的 payload 帶絕對 GCS URL（bucket 轉 private 之後會 403）：\n"
            + "\n".join(f"  {u} …{c}…" for u, c in bad[:5])
        )

    def test_thumbnail_url_is_relative_when_present(self):
        """有封面時，位址必須是我們自己的代理路徑。

        ⚠️ 現況：**175 課全部沒有封面**（`data/lessons/` 底下 0 個圖檔，
        `_thumbnail_name()` 全回 None）。所以這條目前掃不到任何一筆 ——
        那不是這條測試的錯，是內容缺口，記在下面那條。
        """
        checked = 0
        for lesson in self._served_lessons():
            url = lesson.get("thumbnail_url")
            if not url:
                continue
            checked += 1
            assert not url.startswith("https://"), (
                f"{lesson.get('lesson_uid')} 的封面是絕對 URL：{url}"
            )
            assert url.startswith("/assets/"), (
                f"{lesson.get('lesson_uid')} 的封面不是走代理：{url}"
            )
        # 2026-08-19：封面回來了（175 課，先前全部因為只查 v3/assets/ 而回 None）。
        # 原本這裡掃到 0 筆也算過，旁邊靠一條「目前一張都沒有」的哨兵留痕跡。
        # 哨兵已刪 —— 它自己的訊息就說了封面回來時該這麼做。
        # 現在改成硬要求：掃不到就是這條在測空氣，不是「剛好沒有封面」。
        assert checked >= 150, (
            f"只掃到 {checked} 課有封面 —— 這條在測空氣。"
            "封面應該有 175 課（見 test_lesson_cover_served_2767.py）"
        )

