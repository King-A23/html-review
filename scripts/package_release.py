"""Build a reproducible standalone download and curated offline release bundle."""

import argparse
import hashlib
import json
import re
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = (
    "index.html", "LICENSE", "README.md", "README.en.md", "CHANGELOG.md",
    "AGENT_PROMPT.md", "VERIFICATION.md", "CONTRIBUTING.md", "docs/QUICKSTART.md", "docs/AGENT_RESULTS.md", "docs/WINDOWS.md",
    "docs/preview.png", "docs/agent-feedback.png", "docs/REFERENCE.md",
    "docs/docx-preview.png", "docs/pdf-preview.png", "docs/RELEASE_PROCESS.md", "docs/RELEASE_VALIDATION.md",
    "docs/media/demo.gif", "docs/media/demo.mp4", "docs/media/social-preview.png", "docs/media/README.md",
    "docs/media/documents-demo.mp4", "docs/media/documents-demo.gif",
    "docs/media/licenses/HyperFrames-SFX-CREDITS.md", "docs/media/licenses/OFL-NotoSansSC.txt", "docs/media/licenses/OFL-JetBrainsMono.txt",
    "scripts/inspect_review.py", "scripts/update_review.py",
    "scripts/build.mjs", "scripts/package_release.py", "scripts/capture_docs.mjs", "scripts/build_site.mjs",
    "package.json", "package-lock.json", "bin/html-review.mjs", ".gitattributes",
    "scripts/verify_release.mjs", "scripts/test.mjs", "scripts/test_documents.mjs", "scripts/python.mjs", "tests/pdf-requirements.txt",
    "scripts/capture_documents.mjs", "scripts/create_document_examples.py",
)


def package(output):
    version = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?", version):
        raise ValueError("Invalid release version")
    paths = list(FILES) + [f"docs/releases/v{version}.md"]
    paths += sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "docs").rglob("*.md")
                    if p.is_file())
    paths += sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "examples").rglob("*")
                    if p.is_file() and p.suffix in (".html", ".svg", ".css", ".js", ".md", ".docx", ".pdf", ".json"))
    paths += sorted(p.relative_to(ROOT).as_posix() for folder in ("src", "tests", "site")
                    for p in (ROOT / folder).iterdir()
                    if p.is_file() and p.suffix in (".mjs", ".js", ".css", ".html", ".svg", ".py"))
    paths += sorted(p.relative_to(ROOT).as_posix() for p in (ROOT / "tests/helpers").rglob("*.py")
                    if p.is_file())
    contents = {}
    for relative in paths:
        path = ROOT / relative
        if path.is_symlink() or ROOT not in path.resolve().parents:
            raise ValueError(f"Release input must be a regular repository file: {relative}")
        contents["html-review/" + relative] = path.read_bytes()
    contents["html-review/VERSION"] = (version + "\n").encode()
    output.mkdir(parents=True, exist_ok=True)
    standalone = output / "html-review.html"
    standalone.write_bytes(contents["html-review/index.html"])
    bundle = output / f"html-review-v{version}.zip"
    with zipfile.ZipFile(bundle, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, data in sorted(contents.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.create_system = 3
            info.external_attr = (0o100755 if name == "html-review/bin/html-review.mjs" else 0o100644) << 16
            archive.writestr(info, data, compresslevel=9)
    with zipfile.ZipFile(bundle) as archive:
        if archive.testzip() is not None or any(archive.read(name) != data for name, data in contents.items()):
            raise ValueError("Release archive failed integrity validation")
    sums = output / "SHA256SUMS.txt"
    sums.write_bytes("".join(f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}\n" for path in (standalone, bundle)).encode("utf-8"))
    return standalone, bundle, sums


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "dist")
    args = parser.parse_args()
    for artifact in package(args.output.resolve()):
        print(f"{artifact.name}: {artifact.stat().st_size:,} bytes")
