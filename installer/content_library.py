"""Per-user Stagecue content library. catalog.json is the atomic commit point."""
import hashlib
import json
import os
import re
import shutil
import tempfile
import threading
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

ROOT = Path.cwd() / "Library"
LOCK = threading.Lock()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, indent=2).encode("utf-8")


def digest(value):
    return hashlib.sha256(value).hexdigest()


def key(value):
    # Fixed safe path components for arbitrary legacy script and collection IDs.
    return value if re.fullmatch(r"[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}", value) else digest(value.encode("utf-8"))


def write_file(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def catalog():
    path = ROOT / "catalog.json"
    if not path.exists():
        return None
    value = json.loads(path.read_bytes())
    if value["version"] != 1:
        raise ValueError("Unsupported library version")
    return value


def snapshot(current):
    if current is None:
        return None
    scripts = []
    for row in current["scenes"]:
        path = scene_file(row)
        scripts.extend(json.loads(path.read_bytes())["scripts"])
    return {k: current[k] for k in ("revision", "removed", "deletedDefaults")} | {"scripts": scripts}


def scene_file(row):
    revision = row["file"]
    if not re.fullmatch(r"[a-f0-9]{64}", revision):
        raise ValueError("Invalid scene revision")
    return ROOT / "Scenes" / key(row["id"]) / (revision + ".json")


def save(state, current):
    if state["revision"] != (current["revision"] if current else 0):
        raise ValueError("The library changed in another window. Reopen Studio before saving.")
    groups = {}
    for script in state["scripts"]:
        scene = script.get("collection") or {"id": script["showId"], "title": script["title"]}
        groups.setdefault(scene["id"], {"scene": scene, "scripts": []})["scripts"].append(script)
    rows = []
    for scene_id, group in groups.items():
        data = encoded(group)
        row = {"id": scene_id, "title": group["scene"]["title"], "file": digest(data)}
        path = scene_file(row)
        if not path.exists():
            write_file(path, data)
        rows.append(row)
    new = {"version": 1, "revision": state["revision"] + 1, "scenes": rows,
           "removed": state["removed"], "deletedDefaults": state["deletedDefaults"]}
    write_file(ROOT / "catalog.json", encoded(new))
    # Only discard content after the replacement catalog is durable.
    live = {scene_file(row) for row in rows}
    for row in (current or {}).get("scenes", []):
        path = scene_file(row)
        if path not in live:
            path.unlink(missing_ok=True)
            if path.parent.exists() and not any(path.parent.iterdir()):
                path.parent.rmdir()
    return new["revision"]


def media_path(owner, uri):
    if not uri.startswith("assets/"):
        raise ValueError("Invalid media URI")
    # Imported paths can differ by case or contain characters Windows reserves.
    # Keep ordinary names readable while giving each original segment a unique path.
    parts = uri.split("/")
    if any(not part or part in (".", "..") for part in parts):
        raise ValueError("Invalid media path")
    def component(part):
        name = "".join(chr(c) if c in b"abcdefghijklmnopqrstuvwxyz0123456789-_." else
                       "%{:02x}".format(c) for c in part.encode("utf-8"))
        if name.endswith(".") or Path(name).is_reserved() or len(name) > 120:
            return "~" + key(part) + (Path(name).suffix[:12].rstrip("."))
        return name
    return ROOT / "Media" / key(owner) / Path(*(component(p) for p in parts))


def package_path(owner):
    if not re.fullmatch(r"[a-f0-9]{64}", owner):
        raise ValueError("Invalid SceneMax identifier")
    return ROOT / "SceneMax" / (owner + ".zip")


def handle(handler):
    query = parse_qs(urlsplit(handler.path).query)
    op = query["op"][0]
    length = int(handler.headers.get("Content-Length", 0))
    if not 0 <= length <= 1024**3 + 1024**2:
        raise ValueError("Invalid request length")
    data = handler.rfile.read(length)
    if len(data) != length:
        raise ValueError("Incomplete request")
    with LOCK:
        if op == "read":
            result = snapshot(catalog())
        elif op == "save":
            result = save(json.loads(data), catalog())
        elif op in ("getMedia", "putMedia", "getPackage", "putPackage"):
            owner = query["id"][0]
            path = media_path(owner, query["uri"][0]) if op.endswith("Media") else package_path(owner)
            if op.startswith("get"):
                if not path.is_file():
                    handler.reply(404, "text/plain", b"Missing library file")
                else:
                    kind = "application/octet-stream"
                    if op == "getMedia":
                        mime = ROOT / "Media" / key(owner) / "types" / (key(query["uri"][0]) + ".txt")
                        if mime.exists():
                            kind = mime.read_text("ascii")
                    handler.reply(200, kind, path.read_bytes())
                return
            if op == "putMedia":
                kind = query.get("type", ["application/octet-stream"])[0]
                if not re.fullmatch(r"[a-zA-Z0-9!#$&^_.+/-]+", kind):
                    kind = "application/octet-stream"
                write_file(ROOT / "Media" / key(owner) / "types" / (key(query["uri"][0]) + ".txt"), kind.encode("ascii"))
            write_file(path, data)
            result = True
        elif op == "clean":
            targets = json.loads(data)
            saved = snapshot(catalog())["scripts"]
            owners = {s["showId"] for s in saved}
            packages = {s["scenePackage"]["id"] for s in saved if s.get("scenePackage")}
            for owner in set(targets["scripts"]) - owners:
                folder = ROOT / "Media" / key(owner)
                if folder.exists():
                    shutil.rmtree(folder)
            for owner in set(targets["packages"]) - packages:
                package_path(owner).unlink(missing_ok=True)
            result = True
        else:
            raise ValueError("Unknown library operation")
    handler.reply(200, "application/json", encoded(result))
