"""OMO crop and GCS upload — extracts per-question answer strips from images.

Extracted from omo_grader.py (issue #1879).

Responsibilities:
  - _crop_and_upload: crops a generous strip around the question position
    (relative y-coord) and uploads to GCS as JPEG q85.
    Fail-open: returns None on any error so crop failure never blocks grading.
  - _crop_and_upload_answer_image: alias for backward compatibility.
"""

import io
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)


def _crop_and_upload(
    image_bytes_list: list[bytes],
    question: dict,
    upload_id: int,
    question_id: str,
    gcs_bucket: Optional[str] = None,
) -> Optional[str]:
    """Crop a generous strip around the question position and upload to GCS.

    Position comes from the grader's position_x / position_y fields (relative 0-1 coords).
    For fill_blank (fb_*): full-width strip (0, y-200, W, y+200), clipped to bounds.
    For multiple_choice (mc_*): full-width strip (0, y-300, W, y+400), clipped to bounds.

    Falls back to page 0 if no position or position_y=0.
    Uploads as JPEG q85 to gs://{gcs_bucket}/crops/{upload_id}/{question_id}.jpg
    Returns gs:// URI on success, None on any failure (fail-open: crop failure must not block grading).
    """
    try:
        from PIL import Image
    except ImportError:
        return None

    position = question.get('position') or {}
    pos_y = float(position.get('y', 0.0))

    # Use first image as source (page 0 fallback)
    source_bytes = image_bytes_list[0] if image_bytes_list else None
    if not source_bytes or source_bytes == b'placeholder':
        return None

    try:
        img = Image.open(io.BytesIO(source_bytes))
        if img.mode != 'RGB':
            img = img.convert('RGB')
        W, H = img.size

        # Convert relative y to pixel coordinate
        py = int(pos_y * H)

        qtype = question.get('type', 'fill_blank')
        if qtype == 'multiple_choice':
            top = max(0, py - 300)
            bottom = min(H, py + 400)
        else:
            top = max(0, py - 200)
            bottom = min(H, py + 200)

        # Full-width strip
        cropped = img.crop((0, top, W, bottom))
        buf = io.BytesIO()
        cropped.save(buf, format='JPEG', quality=85)
        crop_bytes = buf.getvalue()
    except Exception as exc:
        logger.warning('omo_grader crop failed for %s q=%s: %s', upload_id, question_id, exc)
        return None

    # Upload to GCS
    bucket_name = gcs_bucket or os.environ.get("GCS_OMO_BUCKET", "lingoleap-omo-uploads")
    object_path = f'crops/{upload_id}/{question_id}.jpg'
    try:
        from google.cloud import storage  # type: ignore[import]
        client = storage.Client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(object_path)
        blob.upload_from_string(crop_bytes, content_type='image/jpeg')
        gs_uri = f'gs://{bucket_name}/{object_path}'
        logger.info('omo_grader: uploaded crop %s', gs_uri)
        return gs_uri
    except ImportError:
        logger.debug('google-cloud-storage not available — skipping crop upload (local dev)')
        return None
    except Exception as exc:
        logger.warning('omo_grader: GCS crop upload failed for %s: %s', object_path, exc)
        return None


# Backward-compatibility alias
_crop_and_upload_answer_image = _crop_and_upload
