"""Loopback ASR. Hebrew uses an incremental Zipformer; other languages use Whisper."""
import asyncio
import json
import os
import re
import time
from pathlib import Path

import numpy as np
import sherpa_onnx
from websockets.asyncio.server import serve

RATE = 16000
MAX_BYTES = RATE * 2 * 32
MODEL = "thewh1teagle/zipformer2-66m-streaming-he"
REVISION = "6c07526ebfdfc71d12ed4ce6aaebe32774a2613a"
TAIL = np.zeros(24000, dtype=np.float32)


def load_hebrew():
    configured = os.getenv("CUE_HEBREW_MODEL")
    if configured:
        path = Path(configured)
    else:
        from huggingface_hub import snapshot_download
        try:
            folder = snapshot_download(MODEL, revision=REVISION, local_files_only=True)
            if not (Path(folder) / "sherpa-onnx/encoder.int8.onnx").is_file():
                raise FileNotFoundError()
        except FileNotFoundError:
            folder = snapshot_download(MODEL, revision=REVISION, allow_patterns=["sherpa-onnx/*"])
        path = Path(folder) / "sherpa-onnx"
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=str(path / "tokens.txt"), encoder=str(path / "encoder.int8.onnx"),
        decoder=str(path / "decoder.int8.onnx"), joiner=str(path / "joiner.int8.onnx"),
        model_type="zipformer2", num_threads=2)


class Utterance:
    def __init__(self, model):
        self.model = model
        self.stream = model.create_stream() if model else None
        self.data = bytearray()
        self.last_update_size = 0
        self.last_update_text = ""
        self.preview = None

    def feed(self, pcm):
        features = np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768
        self.stream.accept_waveform(RATE, features)
        self.decode()

    def decode(self):
        while self.model.is_ready(self.stream):
            self.model.decode_stream(self.stream)

    def append(self, pcm, updates=False):
        self.data.extend(pcm)
        if self.stream is not None and self.preview is None:
            self.feed(pcm)
            if updates and len(self.data) - self.last_update_size >= RATE * 2 // 4:
                self.last_update_size = len(self.data)
                text = self.model.get_result(self.stream)
                if text and text != self.last_update_text:
                    self.last_update_text = text
                    return text

    def resume(self):
        # Speech continued across a short pause. Restore the original audio
        # without the synthetic tail used for the provisional decode.
        if self.preview is not None:
            self.preview = None
            self.stream = self.model.create_stream()
            self.feed(self.data)

    def finish(self):
        if self.preview is None:
            self.stream.accept_waveform(RATE, TAIL)
            self.stream.input_finished()
            self.decode()
            self.preview = self.model.get_result(self.stream)
        return self.preview


async def main():
    hebrew = load_hebrew()
    hebrew_only = Path(__file__).with_name("hebrew-only.marker").is_file()
    whisper = None
    lock = asyncio.Lock()

    def offline(data, language):
        nonlocal whisper
        if whisper is None:
            from faster_whisper import WhisperModel
            whisper = WhisperModel(os.getenv("CUE_MODEL", "small"), device="cpu", compute_type="int8")
        audio = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768
        segments, _ = whisper.transcribe(audio, language=language, beam_size=3,
                                         condition_on_previous_text=False)
        return " ".join(s.text.strip() for s in segments).strip()

    async def handle(ws):
        updates = False
        language = None
        model = None
        utterance = None
        uid = None
        async for message in ws:
            if isinstance(message, bytes):
                if utterance is None or len(message) % 2 or len(utterance.data) + len(message) > MAX_BYTES:
                    await ws.close(1003, "Invalid audio frame")
                    return
                async with lock:
                    progress = await asyncio.to_thread(utterance.append, message, updates)
                if progress:
                    await ws.send(json.dumps({"type": "progress", "text": progress, "utteranceId": uid}))
                continue
            event = json.loads(message)
            kind = event["type"]
            if kind == "start":
                if event.get("sampleRate") != RATE:
                    await ws.close(1003, "Expected mono 16 kHz PCM")
                    return
                updates = event.get("wordFeedback") is True
                language = event.get("language", "he-IL").split("-")[0]
                if hebrew_only and language != "he":
                    await ws.send(json.dumps({"type": "error", "message": "This edition recognizes Hebrew speech only."}))
                    return
                model = hebrew if hebrew_only or language == "he" and os.getenv("CUE_ASR") != "whisper" else None
                utterance = Utterance(model)
                uid = None
                await ws.send(json.dumps({"type": "ready", "streaming": model is not None}))
            elif kind == "stop":
                return
            elif language and kind == "begin":
                uid = event["utteranceId"]
                utterance = Utterance(model)
            elif utterance and kind == "resume" and uid == event.get("utteranceId"):
                async with lock:
                    await asyncio.to_thread(utterance.resume)
            elif utterance and kind in ("probe", "endpoint") and utterance.data:
                if uid is not None and uid != event["utteranceId"]:
                    continue
                if kind == "probe" and model is None:
                    continue
                async with lock:
                    start = time.perf_counter()
                    if model is not None:
                        text = await asyncio.to_thread(utterance.finish)
                    else:
                        text = await asyncio.to_thread(offline, utterance.data, language)
                    decode_ms = (time.perf_counter() - start) * 1000
                await ws.send(json.dumps({"type": "partial" if kind == "probe" else "final",
                    "text": text, "utteranceId": event["utteranceId"], "probe": event.get("probe"),
                    "decodeMs": round(decode_ms), "timestampMs": round(time.time()*1000)}))
                if kind == "endpoint":
                    uid = None
                    utterance = Utterance(model)

    async with serve(handle, "127.0.0.1", int(os.getenv("CUE_PORT", "8765")),
                     origins=[None,re.compile(r"http://(localhost|127\.0\.0\.1)(:\d+)?")]):
        print("Local Hebrew streaming ASR ready", flush=True)
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())

