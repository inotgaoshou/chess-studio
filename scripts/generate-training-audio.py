#!/usr/bin/env python3
"""Original deterministic PCM cues; no audio copied from reference videos."""
import math
import random
import struct
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / 'apps/endgame-training/public/audio'
RATE = 22050
CUES = {'move': (.148, [740]), 'capture': (.25, [190, 380]),
        'check': (.68, [660, 880]), 'checkmate': (1., [440, 660, 880]),
        'stalemate': (1., [520, 390, 260])}
for kind, (duration, notes) in CUES.items():
    rng = random.Random('qixi-v107-' + kind)
    samples = []
    for i in range(round(RATE * duration)):
        t = i / RATE
        attack = min(1., t / .003)
        impact = rng.uniform(-1, 1) * math.exp(-t * 100) * .32
        tone = 0.
        for j, frequency in enumerate(notes):
            offset = j * (.12 if len(notes) > 1 else 0)
            age = t - offset
            if age >= 0:
                tone += math.sin(2 * math.pi * frequency * age) * math.exp(-age * 9) * .35
        fade = min(1., (duration - t) / .025)
        samples.append(round(32767 * max(-.95, min(.95, (tone + impact) * attack * fade))))
    with wave.open(str(ROOT / f'v107-{kind}.wav'), 'wb') as output:
        output.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
        output.writeframes(struct.pack('<' + 'h' * len(samples), *samples))
