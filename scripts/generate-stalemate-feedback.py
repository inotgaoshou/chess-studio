#!/usr/bin/env python3
"""Render 困毙 from a prepared voice matched to the existing 绝杀 cue.

Default rendering is offline. Optional source regeneration requires mlx-audio
and a local Qwen3-TTS Base model; no model ships with the application.
"""
import argparse
import hashlib
import json
import subprocess
import tempfile
import wave
from pathlib import Path

import numpy as np

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT / "apps/endgame-training/public/audio"
SOURCES = PROJECT / "scripts/assets/stalemate-reference-v5"
RATE = 44100
REFERENCE = ROOT / "v109-checkmate.wav"
OUTPUT = ROOT / "v109-stalemate-reference-v5.wav"
REFERENCE_SHA256 = "986863dde158521b263cefa4d4f163ce00f8757246c52f3f41e4106feaaaf8a3"


def regenerate_source(model_path):
    import mlx.core as mx
    from mlx_audio.audio_io import write
    from mlx_audio.tts.utils import load_model

    with tempfile.TemporaryDirectory(prefix="qixi-reference-voice-") as directory:
        reference = Path(directory) / "reference.wav"
        with wave.open(str(REFERENCE)) as source:
            params = source.getparams()
            raw = source.readframes(source.getnframes())
        with wave.open(str(reference), "wb") as output:
            output.setparams(params)
            output.writeframes((raw + b"\x00\x00" * int(params.framerate * .12)) * 3)
        model = load_model(Path(model_path))
        mx.random.seed(42)
        results = list(model.generate(
            text="困毙！", lang_code="chinese", ref_audio=str(reference),
            ref_text="绝杀！绝杀！绝杀！", temperature=.65, top_p=.9,
            max_tokens=64,
        ))
        if len(results) != 1:
            raise RuntimeError("Expected one complete 困毙 call")
        SOURCES.mkdir(parents=True, exist_ok=True)
        write(SOURCES / "source.wav", np.asarray(results[0].audio), results[0].sample_rate)


def read_audio(path):
    raw = subprocess.check_output([
        "ffmpeg", "-v", "error", "-i", str(path), "-ar", str(RATE),
        "-ac", "1", "-f", "f32le", "-",
    ])
    return np.frombuffer(raw, np.float32).astype(float)


def render():
    reference = read_audio(REFERENCE)
    voice = read_audio(SOURCES / "source.wav")
    voice = np.pad(voice, (0, max(0, len(reference) - len(voice))))[:len(reference)]

    def envelope(signal):
        return np.sqrt(np.convolve(signal * signal, np.ones(1764) / 1764, mode="same") + 1e-8)

    # Transfer the reference's accented timing without shifting the speaker's
    # pitch/formants or adding a separate bass hit over the spoken consonants.
    gain = np.clip(envelope(reference) / np.maximum(envelope(voice), .012), .55, 4.)
    gain = np.convolve(np.pad(gain, (220, 220), mode="edge"), np.ones(441) / 441, mode="valid")
    samples = .98 * np.tanh(voice * gain / .98)
    samples[:132] *= np.linspace(0, 1, 132)
    samples[-882:] *= np.linspace(1, 0, 882)
    with wave.open(str(OUTPUT), "wb") as output:
        output.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
        output.writeframes((samples * 32767).astype("<i2").tobytes())

    provenance = ROOT / "v109-reference-provenance.json"
    data = json.loads(provenance.read_text())
    data["samples"]["stalemate"].update({
        "file": OUTPUT.name,
        "source": "Reference-conditioned Mandarin 困毙 voice generated locally with Qwen3-TTS Base from the existing 绝杀 sample; reference-aligned accent envelope, no pitch shifting or extra synthesized impact",
        "generator": "scripts/generate-stalemate-feedback.py",
        "revision": "reference-v5",
        "referenceSample": False,
        "voiceReference": REFERENCE.name,
        "voiceReferenceSha256": REFERENCE_SHA256,
    })
    provenance.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(OUTPUT.name, hashlib.sha256(OUTPUT.read_bytes()).hexdigest())


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--regenerate-source", metavar="MODEL_DIRECTORY")
    args = parser.parse_args()
    if hashlib.sha256(REFERENCE.read_bytes()).hexdigest() != REFERENCE_SHA256:
        raise RuntimeError("The reference voice changed; review before regenerating")
    if args.regenerate_source:
        regenerate_source(args.regenerate_source)
    render()
