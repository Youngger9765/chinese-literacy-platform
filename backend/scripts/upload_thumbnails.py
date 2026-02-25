"""
Upload lesson thumbnail images from frontend/public/images/lessons/
to gs://lingoleap-assets/stories/thumbnails/

Usage:
    cd backend
    python -m scripts.upload_thumbnails

    # Dry run (list files without uploading):
    python -m scripts.upload_thumbnails --dry-run
"""
import sys
from pathlib import Path

try:
    from google.cloud import storage
except ImportError:
    print("ERROR: google-cloud-storage not installed. Run: pip install google-cloud-storage")
    sys.exit(1)

BUCKET_NAME = "lingoleap-assets"
GCS_PREFIX = "stories/thumbnails"


def upload(dry_run: bool = False):
    images_dir = Path(__file__).parent.parent.parent / "frontend" / "public" / "images" / "lessons"

    if not images_dir.exists():
        print(f"ERROR: Images directory not found: {images_dir}")
        sys.exit(1)

    webp_files = sorted(images_dir.glob("*.webp"))
    print(f"Found {len(webp_files)} .webp files in {images_dir}")

    if dry_run:
        for img in webp_files:
            print(f"  [DRY RUN] Would upload: {GCS_PREFIX}/{img.name}")
        print(f"\nDry run complete. {len(webp_files)} files would be uploaded.")
        return

    client = storage.Client()
    bucket = client.bucket(BUCKET_NAME)
    uploaded = 0

    for img in webp_files:
        blob_name = f"{GCS_PREFIX}/{img.name}"
        blob = bucket.blob(blob_name)

        # Skip if already exists with same size
        if blob.exists():
            blob.reload()
            local_size = img.stat().st_size
            if blob.size == local_size:
                print(f"  Skipped (exists): {blob_name}")
                continue

        blob.upload_from_filename(str(img), content_type="image/webp")
        blob.cache_control = "public, max-age=86400"
        blob.patch()
        uploaded += 1
        print(f"  Uploaded: {blob_name}")

    print(f"\nDone! Uploaded: {uploaded}, Skipped: {len(webp_files) - uploaded}")


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    upload(dry_run=dry_run)
