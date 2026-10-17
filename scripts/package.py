"""Create the unpacked extension ZIP used for GitHub releases."""

import json
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / "manifest.json").read_text())
output_dir = root / "dist"
output_dir.mkdir(exist_ok=True)
archive = output_dir / f"railway-curved-connections-{manifest['version']}.zip"

files = [
    "manifest.json",
    "content-bundle.js",
    "popup.html",
    "popup.js",
    "README.md",
    "LICENSE",
    "THIRD_PARTY_LICENSE.txt",
    *[f"icons/icon-{size}.png" for size in (16, 32, 48, 128)],
]
with ZipFile(archive, "w", ZIP_DEFLATED, compresslevel=9) as output:
    for filename in files:
        output.write(root / filename, arcname=filename)

with ZipFile(archive) as packaged:
    assert packaged.testzip() is None
    assert set(packaged.namelist()) == set(files)
print(archive)
