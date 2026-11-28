"""離線批次校準題目難度（#4164）。

用法（在 backend 目錄）：
    python scripts/calibrate_ability_items.py --out data/ability_calibration.json

只讀資料庫（每人每課每題第一次作答），只寫輸出檔；輸出檔提交進 repo 後，
GET /api/learning/ability/me 就不再每次請求掃全表。用哪個資料庫的資料校準由執行者決定，
用正式資料前要先取得同意。
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal  # noqa: E402
from app.services.ability.service import build_calibration_payload  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    db = SessionLocal()
    try:
        payload = build_calibration_payload(db)
    finally:
        db.close()
    Path(args.out).write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"校準 {len(payload['items'])} 題 -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
