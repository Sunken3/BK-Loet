"""
One-shot image optimizer for BK Loet site.

- Player portraits (images/spelare/*.png|jpg)  -> WebP, max 600x600, q=82
- Team photos      (images/lagfoton/*.jpg|jpeg) -> WebP, max 1400x1400, q=82
- Bowling balls    (images/bowlingklot/*.png|jpg) -> WebP, max 320x320, q=82

Originals are moved to images/_original/<subdir>/ before conversion.
Already-converted .webp files are left alone (idempotent).
"""

import shutil
import sys
from pathlib import Path
from PIL import Image, ImageOps

ROOT = Path(__file__).resolve().parent.parent
IMG_ROOT = ROOT / "images"
BACKUP_ROOT = IMG_ROOT / "_original"

JOBS = [
    {"subdir": "spelare",     "max_size": 600,  "quality": 82},
    {"subdir": "lagfoton",    "max_size": 1400, "quality": 82},
    {"subdir": "bowlingklot", "max_size": 320,  "quality": 82},
]
EXTS = {".png", ".jpg", ".jpeg"}


def process_folder(subdir: str, max_size: int, quality: int) -> None:
    src_dir = IMG_ROOT / subdir
    backup_dir = BACKUP_ROOT / subdir
    backup_dir.mkdir(parents=True, exist_ok=True)

    files = [p for p in src_dir.iterdir() if p.is_file() and p.suffix.lower() in EXTS]
    if not files:
        print(f"  (no images in {subdir})")
        return

    for path in files:
        webp_path = path.with_suffix(".webp")
        if webp_path.exists():
            print(f"  skip (already converted): {path.name}")
            continue

        try:
            with Image.open(path) as im:
                im = ImageOps.exif_transpose(im)
                im.thumbnail((max_size, max_size), Image.LANCZOS)
                if im.mode in ("RGBA", "LA"):
                    save_kwargs = {"quality": quality, "method": 6}
                else:
                    im = im.convert("RGB")
                    save_kwargs = {"quality": quality, "method": 6}
                im.save(webp_path, "WEBP", **save_kwargs)
        except Exception as e:
            print(f"  ERROR processing {path.name}: {e}")
            continue

        orig_size = path.stat().st_size
        new_size = webp_path.stat().st_size
        pct = 100.0 * new_size / orig_size if orig_size else 0
        print(
            f"  {path.name:40s} {orig_size/1024:7.0f} KB"
            f"  ->  {webp_path.name:40s} {new_size/1024:7.0f} KB  ({pct:5.1f}%)"
        )

        shutil.move(str(path), str(backup_dir / path.name))


def main() -> int:
    if not IMG_ROOT.exists():
        print(f"images/ not found at {IMG_ROOT}", file=sys.stderr)
        return 1
    for job in JOBS:
        print(f"\n== {job['subdir']} (max {job['max_size']}px, q={job['quality']}) ==")
        process_folder(**job)
    print("\nDone. Originals backed up to images/_original/")
    return 0


if __name__ == "__main__":
    sys.exit(main())
