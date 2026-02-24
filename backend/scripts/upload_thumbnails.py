"""Upload lesson thumbnails from frontend/public to GCS."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from google.cloud import storage


BUCKET_NAME = "lingoleap-assets"
PREFIX = "stories/thumbnails"


def upload():
    client = storage.Client()
    bucket = client.bucket(BUCKET_NAME)

    images_dir = Path(__file__).parent.parent.parent / "frontend" / "public" / "images" / "lessons"
    webp_files = sorted(images_dir.glob("*.webp"))

    if not webp_files:
        print(f"No .webp files found in {images_dir}")
        return

    count = 0
    for img in webp_files:
        blob_name = f"{PREFIX}/{img.name}"
        blob = bucket.blob(blob_name)
        blob.upload_from_filename(str(img), content_type="image/webp")
        blob.cache_control = "public, max-age=86400"
        blob.patch()
        print(f"  Uploaded {blob_name}")
        count += 1

    print(f"Uploaded {count} thumbnails to gs://{BUCKET_NAME}/{PREFIX}/")


if __name__ == "__main__":
    upload()
