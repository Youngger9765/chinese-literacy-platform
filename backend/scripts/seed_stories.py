"""Seed stories from frontend JSON files into the database."""
import json
import sys
from pathlib import Path

# Add backend to path so we can import app modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from app.database import SessionLocal
from app.models.story import Story


def genre_to_category(genre: str) -> str:
    mapping = {
        "記敘文": "Fable",
        "說明文": "Science",
        "説明文": "Science",
        "議論文": "History",
        "文言文": "History",
        "應用文": "Daily",
    }
    return mapping.get(genre, "Daily")


def seed():
    lessons_dir = Path(__file__).parent.parent.parent / "frontend" / "src" / "data" / "lessons"
    json_files = sorted(lessons_dir.glob("*.json"))

    if not json_files:
        print(f"No JSON files found in {lessons_dir}")
        return

    db = SessionLocal()
    count = 0
    try:
        for jf in json_files:
            data = json.loads(jf.read_text(encoding="utf-8"))
            ln = data["lesson_number"]

            existing = db.query(Story).filter(Story.lesson_number == ln).first()
            if existing:
                print(f"  Skip lesson {ln} (already exists)")
                continue

            story = Story(
                lesson_number=ln,
                title=data["title"],
                grade=data["grade"],
                grade_code=data["grade_code"],
                paragraphs=data["paragraphs"],
                story_text=data.get("story_text"),
                char_count=data["char_count"],
                genre=data["genre"],
                text_type=data.get("text_type", "單"),
                category=genre_to_category(data["genre"]),
                reading_strategy=data.get("reading_strategy") if data.get("reading_strategy") != "無" else None,
                thumbnail_path=f"stories/thumbnails/lesson-{ln}.webp",
                vocabulary=data.get("vocabulary"),
                fill_in_blank=data.get("fill_in_blank"),
                multiple_choice=data.get("multiple_choice"),
                reading_benchmark=data.get("reading_benchmark"),
                source_file=data.get("source_file"),
                is_published=True,
            )
            db.add(story)
            count += 1

        db.commit()
        print(f"Seeded {count} stories (total JSON files: {len(json_files)})")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    seed()
