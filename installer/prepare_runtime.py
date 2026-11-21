"""Prepare a relocatable Windows ASR runtime from the tested studio environment."""
from pathlib import Path
import hashlib, os, shutil, sys, zipfile
from huggingface_hub import snapshot_download

root = Path(__file__).resolve().parents[1]
build = root / "packaging"
out = build / "payload"
runtime = out / "python"
runtime.mkdir(parents=True, exist_ok=True)
archive = build / "cache/python.zip"
if hashlib.sha256(archive.read_bytes()).hexdigest() != "608619f8619075629c9c69f361352a0da6ed7e62f83a0e19c63e0ea32eb7629d":
    raise ValueError("Unexpected embedded Python archive")
if sys.version_info[:2] != (3, 10):
    raise RuntimeError("Build with the studio's 64-bit Python 3.10 environment")
with zipfile.ZipFile(archive) as z:
    z.extractall(runtime)
(runtime/"python310._pth").write_text("python310.zip\n.\nsite-packages\nimport site\n")
site = Path(sys.prefix)/"Lib/site-packages"
shutil.copytree(site, runtime/"site-packages", dirs_exist_ok=True,
                ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "pip", "pip-*.dist-info", "piper", "piper_tts-*.dist-info"))
crt = os.getenv("STAGECUE_VC_REDIST")
if not crt:
    default = Path(os.environ["ProgramFiles"])/"Microsoft Visual Studio"
    matches = sorted(default.glob("*/*/VC/Redist/MSVC/*/x64/Microsoft.VC*.CRT"))
    if not matches:
        raise RuntimeError("Set STAGECUE_VC_REDIST to the Visual C++ x64 app-local CRT directory")
    crt = matches[-1]
for dll in Path(crt).glob("*.dll"):
    shutil.copy2(dll,runtime/dll.name)
for repo,rev,sub,selection,target in [
    ("thewh1teagle/zipformer2-66m-streaming-he","6c07526ebfdfc71d12ed4ce6aaebe32774a2613a","sherpa-onnx",
     ["encoder.int8.onnx","decoder.int8.onnx","joiner.int8.onnx","tokens.txt"],"hebrew"),
    ("Systran/faster-whisper-small","536b0662742c02347bc0e980a01041f333bce120","",
     ["config.json","model.bin","tokenizer.json","vocabulary.txt"],"whisper")]:
    path=Path(snapshot_download(repo,revision=rev,allow_patterns=[(sub+"/" if sub else "")+n for n in selection]+["README.md","LICENSE*"]))
    folder=out/"models"/target
    folder.mkdir(parents=True,exist_ok=True)
    for name in selection:
        shutil.copyfile(path/sub/name,folder/name)
    for name in ["LICENSE","README.md"]:
        if (path/name).is_file(): shutil.copyfile(path/name,folder/name)
shutil.copy2(root/"service/asr.py",out/"asr.py")
