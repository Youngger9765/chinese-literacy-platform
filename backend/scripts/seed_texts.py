"""
Seed script: reads all JSON lesson files from frontend/src/data/lessons/
and inserts them into the texts table as platform-level content.

Usage:
    cd backend
    DATABASE_URL=postgresql://... python -m scripts.seed_texts
"""
import json
import sys
from pathlib import Path

# Add backend to Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.models.text import Text, VisibilityLevel, TextStatus


def genre_to_category(genre: str) -> str:
    """Replicate frontend lessonLoader.ts mapGenreToCategory()."""
    mapping = {
        "記敘文": "Fable",
        "說明文": "Science",
        "説明文": "Science",  # handle both spellings
        "議論文": "History",
        "文言文": "History",
        "應用文": "Daily",
    }
    return mapping.get(genre, "Daily")


def seed():
    lessons_dir = Path(__file__).parent.parent.parent / "frontend" / "src" / "data" / "lessons"

    if not lessons_dir.exists():
        print(f"ERROR: Lessons directory not found: {lessons_dir}")
        sys.exit(1)

    json_files = sorted(lessons_dir.glob("*.json"))
    print(f"Found {len(json_files)} JSON files in {lessons_dir}")

    db = SessionLocal()
    created = 0
    updated = 0

    try:
        for jf in json_files:
            data = json.loads(jf.read_text(encoding="utf-8"))
            lesson_number = data["lesson_number"]

            # Check if already exists (upsert by lesson_number)
            existing = db.query(Text).filter(Text.lesson_number == lesson_number).first()

            reading_strategy = data.get("reading_strategy")
            if reading_strategy == "無":
                reading_strategy = None

            values = dict(
                lesson_number=lesson_number,
                title=data["title"],
                grade=data["grade"],
                grade_code=data["grade_code"],
                paragraphs=data["paragraphs"],
                full_text=data.get("story_text"),
                char_count=data.get("char_count", 0),
                genre=data["genre"],
                text_type=data.get("text_type", "單"),
                category=genre_to_category(data["genre"]),
                reading_strategy=reading_strategy,
                thumbnail_path=f"stories/thumbnails/lesson-{lesson_number}.webp",
                vocabulary=data.get("vocabulary"),
                fill_in_blank=data.get("fill_in_blank"),
                multiple_choice=data.get("multiple_choice"),
                reading_benchmark=data.get("reading_benchmark"),
                source_file=data.get("source_file"),
                visibility=VisibilityLevel.platform,
                status=TextStatus.published,
            )

            if existing:
                for key, val in values.items():
                    setattr(existing, key, val)
                updated += 1
                print(f"  Updated L{lesson_number}: {data['title']}")
            else:
                text = Text(**values)
                db.add(text)
                created += 1
                print(f"  Created L{lesson_number}: {data['title']}")

        db.commit()
        print(f"\nDone! Created: {created}, Updated: {updated}, Total: {created + updated}")

    except Exception as e:
        db.rollback()
        print(f"ERROR: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
