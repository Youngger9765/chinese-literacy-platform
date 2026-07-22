import importlib.util
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parents[1] / "scripts" / "convert_docx_to_pdf.py"
SPEC = importlib.util.spec_from_file_location("convert_docx_to_pdf", SCRIPT_PATH)
assert SPEC and SPEC.loader
convert_docx_to_pdf = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(convert_docx_to_pdf)

detect_bad_pdf_fonts_from_output = convert_docx_to_pdf.detect_bad_pdf_fonts_from_output
is_critical_font = convert_docx_to_pdf.is_critical_font


def test_critical_fonts_are_the_design_fonts() -> None:
    # Distinctive design fonts whose absence visibly breaks the worksheet →
    # preflight hard-blocks on these.
    for family in ["芫荽", "Iansui", "源泉圓體 B", "標楷體",
                   "jf open 粉圓 2.0", "ㄅ源樣注音黑體 R", "BpmfIansui"]:
        assert is_critical_font(family) is True, family


def test_incidental_office_fonts_do_not_block() -> None:
    # Office/system fonts are warn-only (LibreOffice substitutes acceptably) —
    # they must NOT hard-block preflight, else every lesson fails forever.
    for family in ["Calibri", "Aptos", "Cambria", "Segoe UI",
                   "新細明體", "MS Mincho", "Arial"]:
        assert is_critical_font(family) is False, family


def test_detect_bad_pdf_fonts_catches_known_substitutions() -> None:
    pdffonts_output = """
name                                 type              encoding         emb sub uni object ID
------------------------------------ ----------------- ---------------- --- --- --- ---------
DFHaiBaoStd-W9                       CID TrueType      Identity-H       yes no  yes     10  0
STSongti-TC-Bold                     CID TrueType      Identity-H       yes no  yes     11  0
HiraMinProN-W3                       CID TrueType      Identity-H       yes no  yes     12  0
ArialUnicodeMS                       CID TrueType      Identity-H       yes no  yes     13  0
LiberationSans                       TrueType          WinAnsi          yes no  yes     14  0
GenSenRoundedTW-Bold                 CID TrueType      Identity-H       yes no  yes     15  0
"""

    fonts, bad_fonts = detect_bad_pdf_fonts_from_output(pdffonts_output)

    assert "GenSenRoundedTW-Bold" in fonts
    assert bad_fonts == [
        "DFHaiBaoStd-W9",
        "STSongti-TC-Bold",
        "HiraMinProN-W3",
        "ArialUnicodeMS",
        "LiberationSans",
    ]


def test_detect_bad_pdf_fonts_allows_clean_traditional_fonts() -> None:
    pdffonts_output = """
name                                 type              encoding         emb sub uni object ID
------------------------------------ ----------------- ---------------- --- --- --- ---------
Iansui-Regular                       CID TrueType      Identity-H       yes no  yes     10  0
GenSenRoundedTW-Bold                 CID TrueType      Identity-H       yes no  yes     11  0
BpmfIansui-Regular                   CID TrueType      Identity-H       yes no  yes     12  0
NotoSansTC-Regular                   CID TrueType      Identity-H       yes no  yes     13  0
"""

    fonts, bad_fonts = detect_bad_pdf_fonts_from_output(pdffonts_output)

    assert fonts == [
        "Iansui-Regular",
        "GenSenRoundedTW-Bold",
        "BpmfIansui-Regular",
        "NotoSansTC-Regular",
    ]
    assert bad_fonts == []
