"""Deterministic PDF stress corpus; test tooling only, never a product dependency."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from pypdf.generic import ArrayObject, ByteStringObject
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

PASSWORD = "review-secret"
VARIANTS = ("base", "changed", "inserted", "moved", "duplicated", "deleted-text", "chart-replacement", "scan-change", "encrypted", "corrupt", "oversized", "page-limit")
font_candidates = [os.environ.get("PDF_FIXTURE_CJK_FONT"), "/System/Library/Fonts/STHeiti Light.ttc", "/usr/share/fonts/truetype/arphic/uming.ttc", "C:/Windows/Fonts/simsun.ttc"]
font_path = next((path for path in font_candidates if path and Path(path).is_file()), None)
if not font_path:
    raise RuntimeError("Set PDF_FIXTURE_CJK_FONT to a Chinese TrueType font (TTF or TTC). The fixture embeds its glyphs.")
pdfmetrics.registerFont(TTFont("FixtureCJK", font_path, subfontIndex=0))


def scan_image(changed=False):
    image = Image.new("RGB", (1000, 650), "#faf8f0")
    draw = ImageDraw.Draw(image)
    draw.rectangle((35, 35, 965, 615), outline="#222222", width=3)
    draw.text((75, 90), "SCANNED PAGE - no selectable text", fill="#222222", font_size=32)
    draw.text((75, 160), "Invoice 2026 / IMAGE ONLY", fill="#222222", font_size=28)
    draw.text((75, 240), "Total: " + ("246.00" if changed else "123.00"), fill="#222222", font_size=36)
    for y in (340, 400, 460, 520):
        draw.line((75, y, 850, y), fill="#9b9b9b", width=2)
    draw.ellipse((740, 230, 885, 375), outline="#b52b35" if changed else "#236a87", width=9)
    return image


def original(variant):
    stream = io.BytesIO()
    c = canvas.Canvas(stream, pagesize=(612, 792), invariant=1, pageCompression=1)
    c.setTitle("PDF review stress fixture")
    c.setAuthor("html-review deterministic test suite")
    c.bookmarkPage("intro")
    c.setFont("FixtureCJK", 22)
    c.drawString(44, 746, "PDF 审阅测试 Chinese and English")
    c.setFont("Helvetica", 13)
    c.drawString(44, 711, "Body text and persistent text anchors")
    c.setFont("FixtureCJK", 13)
    c.drawString(44, 684, "中英混排：审阅定位 Chinese text anchors")
    x = 44
    for font, word, color in (("Helvetica-Bold", "Bold", "#111111"), ("Helvetica-Oblique", " Italic", "#111111"), ("Helvetica", " Purple", "#8c23aa")):
        c.setFont(font, 14)
        c.setFillColor(color)
        c.drawString(x, 653, word)
        x += pdfmetrics.stringWidth(word, font, 14)
    c.setFillColor("#111111")
    c.setFont("Helvetica", 12)
    c.drawString(44, 619, "Repeated sentence for locator disambiguation.")
    c.drawString(44, 591, "Repeated sentence for locator disambiguation.")
    if variant != "deleted-text":
        c.drawString(44, 558, "Delete this sentence in the deleted-text revision.")
    c.drawString(44, 529, "Stable value: " + ("UPDATED 2027" if variant == "changed" else "ORIGINAL 2026"))
    c.line(44, 510, 550, 510)
    c.drawString(44, 485, "Underline and strike-through samples")
    c.line(44, 482, 144, 482)
    c.line(173, 489, 294, 489)
    c.drawString(44, 444, "External HTTPS link")
    c.linkURL("https://example.com/review?fixture=pdf", (44, 438, 220, 460), relative=0)
    c.drawString(44, 409, "Internal jump to table/chart")
    c.linkRect("Go to chart", "chart", (44, 402, 235, 425), relative=0)
    c.drawString(44, 374, "Unsafe URI test (must never execute)")
    c.linkURL("javascript:alert('pdf-fixture')", (44, 367, 270, 390), relative=0)
    c.drawString(44, 339, "Local file URI test (must never open)")
    c.linkURL("file:///tmp/pdf-fixture-secret", (44, 332, 270, 355), relative=0)
    c.drawString(44, 284, "Native form field:")
    c.acroForm.textfield(name="reviewer", tooltip="Fixture native form", x=44, y=242, width=260, height=28, value="Fixture reviewer")
    c.textAnnotation("Native PDF note for annotation isolation", Rect=(460, 620, 480, 640))
    c.showPage()

    c.setPageSize((612, 792))
    c.setFont("Helvetica-Bold", 19)
    c.drawString(44, 746, "Two-column text layout")
    c.setFont("Helvetica", 11)
    for column, x in (("LEFT", 44), ("RIGHT", 327)):
        for line in range(15):
            c.drawString(x, 702 - line * 24, f"{column} column line {line + 1:02}: stable reading order.")
    c.setFont("FixtureCJK", 13)
    c.drawString(44, 291, "左栏结束 Left column ends")
    c.drawString(327, 291, "右栏结束 Right column ends")
    c.showPage()

    c.setPageSize((792, 612))
    c.bookmarkPage("chart")
    c.setFont("Helvetica-Bold", 19)
    c.drawString(44, 569, "Landscape table and vector chart")
    c.setFont("Helvetica", 13)
    for row in range(5):
        y = 526 - row * 35
        c.line(44, y, 360, y)
        for col in range(4):
            c.line(44 + col * 105, 386, 44 + col * 105, 526)
        if row < 4:
            for col, text in enumerate(("Quarter", "Revenue", "Margin") if row == 0 else (f"Q{row}", str(row * 125), f"{row * 11}%")):
                c.drawString(52 + col * 105, y - 23, text)
    values = [70, 150, 110] if variant != "chart-replacement" else [140, 60, 180]
    c.line(427, 385, 730, 385)
    c.line(427, 385, 427, 550)
    for i, value in enumerate(values):
        c.setFillColor(["#307ca6", "#4b9760", "#bc7844"][i])
        c.rect(455 + i * 85, 386, 45, value, stroke=0, fill=1)
    c.setFillColor("#111111")
    c.drawString(440, 352, "Vector chart (no raster image)")
    c.drawImage(ImageReader(scan_image(False)), 44, 65, width=300, height=195)
    c.drawString(365, 195, "Embedded PNG preview")
    c.showPage()

    c.setPageSize((540, 720))
    c.drawImage(ImageReader(scan_image(variant == "scan-change")), 20, 185, width=500, height=325)
    c.showPage()

    c.setPageSize((640, 820))
    c.setFont("Helvetica-Bold", 19)
    c.drawString(74, 730, "Rotated page with offset crop box")
    c.setFont("FixtureCJK", 16)
    c.drawString(74, 687, "旋转及裁剪定位 Rotated crop coordinates")
    c.setFont("Helvetica", 12)
    c.drawString(100, 580, "Target inside crop at original x=100, y=580")
    c.rect(95, 570, 330, 30)
    c.showPage()
    c.save()
    return PdfReader(stream)


def build(variant, target):
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    if variant == "corrupt":
        target.write_bytes(b"%PDF-1.7\n1 0 obj << /Type /Catalog >>\ntruncated corrupt fixture")
        return
    if variant == "oversized":
        with target.open("wb") as f:
            f.write(b"%PDF-1.7\n% oversize sparse test\n")
            f.truncate(64 * 1024 * 1024)
        return
    writer = PdfWriter()
    writer._ID = ArrayObject([ByteStringObject(b"html-review-pdf"), ByteStringObject(b"html-review-pdf")])
    if variant == "page-limit":
        for _ in range(1001):
            writer.add_blank_page(72, 72)
    else:
        reader = original(variant)
        writer.clone_document_from_reader(reader)
        writer.pages[4].cropbox.lower_left = (40, 60)
        writer.pages[4].cropbox.upper_right = (600, 780)
        writer.pages[4].rotate(90)
        writer._ID = ArrayObject([ByteStringObject(b"html-review-pdf"), ByteStringObject(b"html-review-pdf")])
        # Manipulate the page tree only after cloning, preserving native forms and link objects.
        if variant == "inserted":
            writer.insert_blank_page(width=400, height=500, index=1)
        elif variant == "moved":
            page = writer.pages[2]
            writer.remove_page(2)
            writer.insert_page(page, 1)
        elif variant == "duplicated":
            writer.insert_page(writer.pages[1].clone(writer, force_duplicate=True, ignore_fields=("/Parent",)), 2)
        if variant == "encrypted":
            writer.encrypt(PASSWORD, "fixture-owner-secret", algorithm="RC4-128")
    with target.open("wb") as f:
        writer.write(f)


def inspect(target):
    reader = PdfReader(target)
    encrypted = reader.is_encrypted
    if encrypted:
        assert reader.decrypt(PASSWORD), "Expected fixture password failed"
    pages = []
    for page in reader.pages:
        annotations = []
        for ref in page.get("/Annots", []):
            annotation = ref.get_object()
            action = annotation.get("/A", {})
            annotations.append({"subtype": str(annotation.get("/Subtype")), "rect": [float(v) for v in annotation.get("/Rect", [])], "uri": str(action.get("/URI", "")), "destination": "/Dest" in annotation})
        pages.append({"objectId": page.indirect_reference.idnum, "mediaBox": [float(v) for v in page.mediabox], "cropBox": [float(v) for v in page.cropbox], "rotation": page.rotation, "text": page.extract_text(), "images": len(page.images), "annotations": annotations})
    return {"encrypted": encrypted, "pageCount": len(pages), "pages": pages, "fields": list((reader.get_fields() or {}).keys())}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("output")
    parser.add_argument("--variant", choices=VARIANTS, default="base")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args()
    if args.inspect:
        print(json.dumps(inspect(args.output), ensure_ascii=False))
        return
    targets = [(variant, Path(args.output) / f"{variant}.pdf") for variant in VARIANTS] if args.all else [(args.variant, Path(args.output))]
    manifest = {}
    for variant, target in targets:
        build(variant, target)
        # Stream hashing keeps the sparse rejection fixture cheap in memory.
        with target.open("rb") as f:
            digest = hashlib.file_digest(f, "sha256").hexdigest()
        manifest[variant] = {"path": str(target), "bytes": target.stat().st_size, "sha256": digest}
    if args.all:
        (Path(args.output) / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps(manifest))


if __name__ == "__main__":
    main()
