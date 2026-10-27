"""Inline icons/trash.svg into content.js as CAT_ICON.

Run after editing the SVG:  python3 tools/embed-icon.py
Strips editor metadata and fixed fill colors so the icon is filled with currentColor
and follows the button's color (sidebar switch, panel delete button).
"""
import pathlib
import re

root = pathlib.Path(__file__).resolve().parent.parent
svg = (root / "icons" / "trash.svg").read_text(encoding="utf-8")
body = svg[svg.index("<svg"):]
body = re.sub(r'\s+xmlns:(?:xlink|affinity)="[^"]*"', "", body)
body = re.sub(r'\s+(?:affinity:id|id|version|xml:space)="[^"]*"', "", body)
body = re.sub(r'<rect[^>]*style="fill:none;"\s*/>', "", body)  # empty artboard
body = re.sub(r'\s*fill:\s*(?:rgb\([^)]*\)|#[0-9a-fA-F]{3,8}|black);?', "", body)
body = re.sub(r'\s+style=""', "", body)
body = body.replace('width="100%" height="100%"', 'aria-hidden="true" width="20" height="20" fill="currentColor"', 1)
body = re.sub(r">\s+<", "><", body).strip()
assert "'" not in body and "\\" not in body, "SVG must not contain quotes or backslashes"
assert not re.search(r"<(?:text|image)\b", body), "Convert text to outlines and avoid embedded images"

content = root / "content.js"
source = content.read_text(encoding="utf-8")
updated, count = re.subn(r"^  const CAT_ICON = '.*';$", lambda _: f"  const CAT_ICON = '{body}';", source, flags=re.M)
assert count == 1, "CAT_ICON line not found in content.js"
content.write_text(updated, encoding="utf-8")
print(f"CAT_ICON updated ({len(body)} bytes)")
