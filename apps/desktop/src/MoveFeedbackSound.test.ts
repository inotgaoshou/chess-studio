import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { playMoveFeedbackSound } from "./MainBoardMoveFeedback";
import { DEFAULT_MOVE_FEEDBACK_PACK } from "./MoveFeedbackPack";

const oscillatorStarts: number[] = [];

class FakeAudioParam {
  constructor(private readonly onSet?: (value: number) => void) {}
  setValueAtTime(value: number) { this.onSet?.(value); }
  exponentialRampToValueAtTime() {}
}

class FakeAudioNode {
  connect<T>(target: T) { return target; }
}

class FakeOscillator extends FakeAudioNode {
  type: OscillatorType = "sine";
  frequency = new FakeAudioParam((value) => oscillatorStarts.push(value));
  start() {}
  stop() {}
}

class FakeGain extends FakeAudioNode {
  gain = new FakeAudioParam();
}

class FakeFilter extends FakeAudioNode {
  type: BiquadFilterType = "lowpass";
  frequency = new FakeAudioParam();
  Q = new FakeAudioParam();
}

class FakeBufferSource extends FakeAudioNode {
  buffer: unknown;
  start() {}
  stop() {}
}

class FakeAudioContext {
  currentTime = .1;
  sampleRate = 8_000;
  destination = new FakeAudioNode();
  createOscillator() { return new FakeOscillator(); }
  createGain() { return new FakeGain(); }
  createBiquadFilter() { return new FakeFilter(); }
  createBuffer(_channels: number, length: number) {
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
  createBufferSource() { return new FakeBufferSource(); }
  resume() { return Promise.resolve(); }
}

beforeAll(() => {
  Object.defineProperty(window, "Audio", {
    configurable: true,
    value: undefined,
  });
  Object.defineProperty(window, "AudioContext", {
    configurable: true,
    value: FakeAudioContext as unknown as typeof AudioContext,
  });
});

beforeEach(() => { oscillatorStarts.length = 0; });

describe("move feedback sound palette", () => {
  it("uses the normalized crisp move sample in the active pack", () => {
    expect(DEFAULT_MOVE_FEEDBACK_PACK.voice.move).toBe("/audio/move-crisp.wav");
  });

  it("uses a short wooden click for a normal move", () => {
    playMoveFeedbackSound("move", true, 70);
    expect(oscillatorStarts).toEqual([2400, 5200, 620]);
  });

  it("uses wood and wind for captures without the former drum frequencies", () => {
    playMoveFeedbackSound("capture", true, 70);
    expect(oscillatorStarts).toEqual([2400, 5200, 620]);
    expect(oscillatorStarts).not.toContain(122);
  });

  it("uses a bright metal accent for check", () => {
    playMoveFeedbackSound("check", true, 70);
    expect(oscillatorStarts).toEqual([930, 1395, 2010]);
  });

  it("uses inharmonic gong partials for checkmate", () => {
    playMoveFeedbackSound("checkmate", true, 70);
    expect(oscillatorStarts).toEqual([196, 287, 421]);
  });

  it("does not schedule sound while disabled", () => {
    playMoveFeedbackSound("capture", false, 70);
    expect(oscillatorStarts).toEqual([]);
  });
});
