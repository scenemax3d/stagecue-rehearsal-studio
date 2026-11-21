"""Stage the CPU-only Hebrew synthesis code and pinned model files."""
import hashlib
import shutil
import sys
import urllib.request
import zipfile
from importlib.metadata import version
from pathlib import Path

root = Path(__file__).resolve().parents[1]
payload = root / "packaging/payload"
models = payload / "models/tts"
models.mkdir(parents=True, exist_ok=True)
noa = "https://huggingface.co/thewh1teagle/piper-he-noa/resolve/23f8e06909e9a1e562a50f99df63e3785451379a/"
renikud = "https://huggingface.co/renikud/renikud/resolve/a59c632c8cbac0f8c63f298cad77ef3a3a2547c9/"
for base, name, digest in [
    ("https://huggingface.co/thewh1teagle/pocket-tts-onnx/resolve/110f5251188e9407b4f724acdd8b0dfd0b20692a/", "pocket-tts-english-ipa.onnx", "4c4592b7c5aadab2235ddc1409a0209aa164161a060543bf96a984298dfc6529"),
    (noa, "he_IL-noa-medium.onnx", "83b18c0b8fad6ac00fcea5c5bdf3c1fdbec182f9eadad9f97bc423ab4e22be7d"),
    (noa, "he_IL-noa-medium.onnx.json", "109a7a2a0739061510f318d987e81c27ba81ca57c9303444298f712f71b1082c"),
    (renikud, "model.onnx", "8b881a3a8f00283d86c6d1feea44d37e09c1ea6609a4de7d820d937e7f3dbbca"),
]:
    target = models / name
    if target.exists() and hashlib.sha256(target.read_bytes()).hexdigest() == digest:
        continue
    partial = target.with_suffix(target.suffix + ".part")
    urllib.request.urlretrieve(base + name, partial)
    if hashlib.sha256(partial.read_bytes()).hexdigest() != digest:
        raise RuntimeError("Unexpected checksum for " + name)
    partial.replace(target)

site = Path(sys.prefix) / "Lib/site-packages"
if version("piper-tts") != "1.8.0":
    raise RuntimeError("Install piper-tts==1.8.0 in the build environment")
# Noa uses Renikud. Only these Piper Python sources are required for inference.
for name in ["__init__.py", "voice.py", "config.py", "const.py", "phoneme_ids.py",
             "phonemize_espeak.py", "tashkeel/__init__.py"]:
    dest = payload / "python/site-packages/piper" / name
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(site / "piper" / name, dest)
notices = payload / "notices"
notices.mkdir(exist_ok=True)
shutil.copyfile(next(site.glob("piper_tts-*.dist-info/licenses/COPYING")), notices / "Piper-COPYING.txt")
shutil.copyfile(root / "installer/TTS-notices.txt", notices / "TTS-notices.txt")
for name in ["tts.py", "renikud_impl.py", "asaf.ps1"]:
    shutil.copyfile(root / "service" / name, payload / name)

revision = "9860fc0fe0ee5ffb13a4bae2fb99e9bd913acbe5"
archive = root / "packaging/cache/pocket-tts-src.zip"
if not archive.exists():
    urllib.request.urlretrieve("https://codeload.github.com/thewh1teagle/pocket-tts-onnx/zip/" + revision, archive)
if hashlib.sha256(archive.read_bytes()).hexdigest() != "e506208f129e35c54f4c6f0eaa0f3e5a7b1a2684aeb83243a960c36813ef5a7d":
    raise RuntimeError("Unexpected Pocket TTS source checksum")
package = payload / "python/site-packages/pocket_tts_onnx"
package.mkdir(exist_ok=True)
with zipfile.ZipFile(archive) as sources:
    prefix = "pocket-tts-onnx-" + revision + "/"
    for name in ["__init__.py", "tts.py", "audio.py", "text.py", "hub.py", "g2p.py"]:
        (package / name).write_bytes(sources.read(prefix + "src/pocket_tts_onnx/" + name))
    (notices / "Pocket-TTS-ONNX-LICENSE.txt").write_bytes(sources.read(prefix + "LICENSE"))
if version("sentencepiece") != "0.2.1":
    raise RuntimeError("Install sentencepiece==0.2.1 in the build environment")
shutil.copytree(site / "sentencepiece", payload / "python/site-packages/sentencepiece", dirs_exist_ok=True,
                ignore=shutil.ignore_patterns("__pycache__"))
shutil.copyfile(root / "installer/SentencePiece-LICENSE.txt", notices / "SentencePiece-LICENSE.txt")
