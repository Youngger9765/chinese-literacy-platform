"""TDD tests for the word-baby static content config loader (#3780).

Loads app/data/word_babies/{babies,fragments,encounters,care}.json — the
100-species roster and tuning parameters from the design (docs/design/
word-babies/). Pure read-only, no DB.
"""
from __future__ import annotations


def test_load_babies_returns_100_species_keyed_by_id():
    from app.services.word_baby_config import load_babies

    babies = load_babies()
    assert len(babies) == 100
    assert "wb-001" in babies
    assert babies["wb-001"]["id"] == "wb-001"


def test_get_baby_returns_the_species_dict():
    from app.services.word_baby_config import get_baby

    baby = get_baby("wb-001")
    assert baby is not None
    assert baby["id"] == "wb-001"
    assert "stages" in baby
    assert "diet_flavors" in baby


def test_get_baby_unknown_id_returns_none():
    from app.services.word_baby_config import get_baby

    assert get_baby("wb-999") is None


def test_load_fragments_has_five_flavor_families():
    from app.services.word_baby_config import load_fragments

    fragments = load_fragments()
    assert len(fragments["flavor_families"]) == 5
    assert "文言文" in fragments["flavor_families"]


def test_station_to_flavor_lookup():
    from app.services.word_baby_config import get_station_flavor

    assert get_station_flavor("vocab-definition") == "語文基礎"
    assert get_station_flavor("classical-text") == "文言文"
    assert get_station_flavor("lesson-intro") == "朗讀表達"


def test_station_to_flavor_unknown_station_returns_none():
    from app.services.word_baby_config import get_station_flavor

    assert get_station_flavor("not-a-real-station") is None


def test_drop_probability_lookup():
    from app.services.word_baby_config import get_drop_probability

    assert 0.0 < get_drop_probability("文言文") <= 1.0
    assert 0.0 < get_drop_probability("語文基礎") <= 1.0


def test_load_encounters_has_five_rarity_rates():
    from app.services.word_baby_config import load_encounters

    encounters = load_encounters()
    rarities = {row["rarity"] for row in encounters["rarity_base_rates"]}
    assert rarities == {"common", "uncommon", "rare", "epic", "legendary"}


def test_load_care_has_weaken_and_deep_sleep_thresholds():
    from app.services.word_baby_config import load_care

    care = load_care()
    assert care["weaken_after_days"] > 0
    assert care["deep_sleep_after_days"] > care["weaken_after_days"]
    assert "paused_periods" in care


def test_babies_by_flavor_groups_species_by_diet():
    from app.services.word_baby_config import babies_by_flavor

    grouped = babies_by_flavor()
    # Every flavor family should have at least one eligible species
    for flavor in ("語文基礎", "閱讀理解", "朗讀表達", "書寫紀錄", "文言文"):
        assert len(grouped[flavor]) > 0

    # A species whose diet includes a flavor must appear in that flavor's group
    from app.services.word_baby_config import get_baby
    sample_id = next(iter(grouped["文言文"]))
    assert "文言文" in get_baby(sample_id)["diet_flavors"]


def test_loader_result_is_cached_not_reread_every_call():
    """Loaders should not hit disk on every call (lru_cache or module-level cache)."""
    from app.services import word_baby_config

    first = word_baby_config.load_babies()
    second = word_baby_config.load_babies()
    assert first is second  # same object identity = cached, not re-parsed


def test_babies_json_is_byte_identical_across_its_three_copies():
    """Review finding (2026-10-27, round 3): the 100-species roster exists
    as THREE separate copies that must stay in lockstep —
      1. docs/design/word-babies/babies.json   (design source, source of truth)
      2. backend/app/data/word_babies/babies.json  (actually served by the API)
      3. frontend/src/data/wordBabiesCatalog.json  (actually used by the /lab
         dex grid + feedability logic client-side)
    There is no build step that generates 2/3 from 1 — they were created by
    manual copy. If someone edits one (e.g. tweaking a name in babies.json)
    and forgets the other two, the frontend's dex/feedability logic would
    silently diverge from what the backend actually enforces. This test is
    the only thing that would catch that.
    """
    import json
    from pathlib import Path

    backend_dir = Path(__file__).resolve().parent.parent  # backend/
    repo_root = backend_dir.parent

    design_path = repo_root / "docs" / "design" / "word-babies" / "babies.json"
    backend_path = backend_dir / "app" / "data" / "word_babies" / "babies.json"
    frontend_path = repo_root / "frontend" / "src" / "data" / "wordBabiesCatalog.json"

    design_data = json.loads(design_path.read_text(encoding="utf-8"))
    backend_data = json.loads(backend_path.read_text(encoding="utf-8"))
    frontend_data = json.loads(frontend_path.read_text(encoding="utf-8"))

    assert backend_data == design_data, (
        f"{backend_path} has drifted from {design_path} — re-copy it "
        "(or regenerate via generate_config.py and re-sync both downstream copies)"
    )
    assert frontend_data == design_data, (
        f"{frontend_path} has drifted from {design_path} — re-copy it"
    )
