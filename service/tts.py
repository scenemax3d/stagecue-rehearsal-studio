"""Offline Hebrew speech rendering for the cue editor."""
import functools
import io
import math
import os
import re
import subprocess
import tempfile
import textwrap
import wave
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models/tts" if (HERE / "models").is_dir() else HERE.parent / "packaging/payload/models/tts"

@functools.lru_cache(maxsize=1)
def pronunciation():
    from renikud_impl import G2P
    return G2P(MODELS / "model.onnx")

@functools.lru_cache(maxsize=1)
def male_voice():
    from pocket_tts_onnx import PocketTTS
    return PocketTTS(MODELS / "pocket-tts-english-ipa.onnx")

@functools.lru_cache(maxsize=1)
def noa_voice():
    from piper import PiperVoice
    voice = PiperVoice.load(MODELS / "he_IL-noa-medium.onnx")
    g2p = pronunciation()
    voice.phonemize = lambda sentence: [list(g2p.phonemize(sentence))]
    return voice

def tune_audio(data, speed, pitch):
    if speed == 1 and pitch == 0:
        return data
    import av
    from av.error import BlockingIOError, EOFError
    output = io.BytesIO()
    with av.open(io.BytesIO(data)) as source, wave.open(output, "wb") as wav:
        rate = source.streams.audio[0].rate
        wav.setparams((1, 2, rate, 0, "NONE", ""))
        graph = av.filter.Graph()
        src = graph.add_abuffer(sample_rate=rate, format="s16", layout="mono")
        ratio = 2 ** (pitch / 12)
        # Restore the sample rate after transposition, then adjust tempo independently.
        graph.link_nodes(src, graph.add("asetrate", str(round(rate * ratio))),
                         graph.add("aresample", str(rate)), graph.add("atempo", str(speed / ratio)),
                         graph.add("aformat", "sample_fmts=s16:channel_layouts=mono"), graph.add("abuffersink"))
        graph.configure()
        def drain():
            while True:
                try:
                    frame = graph.pull()
                except (BlockingIOError, EOFError):
                    return
                wav.writeframes(frame.to_ndarray().tobytes())
        for frame in source.decode(audio=0):
            src.push(frame)
            drain()
        src.push(None)
        drain()
    return output.getvalue()

def render(voice_id, text, speed=1, pitch=0):
    for value, low, high in [(speed, 0.75, 1.5), (pitch, -6, 6)]:
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError("Voice setting outside supported range.")
    return tune_audio(synthesize(voice_id, text), speed, pitch)

def synthesize(voice_id, text):
    if not isinstance(text, str) or not text.strip() or len(text) > 2000:
        raise ValueError("Enter between 1 and 2000 characters.")
    if voice_id == "asaf":
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "speech.wav"
            shell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
            result = subprocess.run([str(shell), "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
                                     "-File", str(HERE / "asaf.ps1"), str(output)],
                                    input=text.encode("utf-8"), capture_output=True, timeout=90,
                                    creationflags=subprocess.CREATE_NO_WINDOW)
            if result.returncode or not output.exists() or output.stat().st_size < 46:
                raise ValueError("Asaf is unavailable. Install Hebrew speech in Windows or choose Noa.")
            return output.read_bytes()
    if voice_id == "omer":
        import numpy as np
        engine = male_voice()
        audio = io.BytesIO()
        with wave.open(audio, "wb") as wav:
            wav.setparams((1, 2, engine.sample_rate, 0, "NONE", ""))
            for sentence in re.split(r"(?<=[.!?])\s+|\n+", text.strip()):
                for segment in textwrap.wrap(sentence, width=140):
                    phonemes = pronunciation().phonemize(segment)
                    samples, _ = engine.create(phonemes, voice="omer", phonemes=True, temperature=0.3, decode_steps=2)
                    if wav.getnframes():
                        wav.writeframes(bytes(2 * int(0.17 * engine.sample_rate)))
                    wav.writeframes((np.clip(samples, -1, 1) * 32767).astype("<i2").tobytes())
            if not wav.getnframes():
                raise ValueError("No speech could be generated for this text.")
        return audio.getvalue()
    if voice_id != "noa":
        raise ValueError("Unknown voice.")
    from piper import SynthesisConfig
    voice = noa_voice()
    audio = io.BytesIO()
    with wave.open(audio, "wb") as wav:
        rate = voice.config.sample_rate
        wav.setparams((1, 2, rate, 0, "NONE", ""))
        for sentence in re.split(r"(?<=[.!?])\s+|\n+", text.strip()):
            for segment in textwrap.wrap(sentence, width=240):
                if wav.getnframes():
                    wav.writeframes(bytes(2 * int(0.17 * rate)))
                for chunk in voice.synthesize(segment, SynthesisConfig(speaker_id=0)):
                    wav.writeframes(chunk.audio_int16_bytes)
        if not wav.getnframes():
            raise ValueError("No speech could be generated for this text.")
    return audio.getvalue()
