import { describe, expect, it, vi } from "vitest";
import { VoiceRecorderController, formatVoiceElapsed, selectVoiceMimeType, type VoicePhase, type VoiceRecorderEnvironment } from "@/lib/client/voice-recorder";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function fakeStream() {
  const stop = vi.fn();
  return { stream: { getTracks: () => [{ stop }] } as unknown as MediaStream, stop };
}

class FakeRecorder {
  state: RecordingState = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  start() { this.state = "recording"; }
  stop() {
    if (this.state !== "recording") return;
    this.ondataavailable?.({ data: new Blob(["voice"]) } as BlobEvent);
    this.state = "inactive";
    this.onstop?.();
  }
}

function environment(getUserMedia: () => Promise<MediaStream>, recorder: FakeRecorder, advanceNow = () => 0): VoiceRecorderEnvironment {
  return {
    getUserMedia,
    isTypeSupported: (type) => type === "audio/webm;codecs=opus",
    createMediaRecorder: (_stream, options) => {
      recorder.mimeType = options?.mimeType ?? "";
      return recorder as unknown as MediaRecorder;
    },
    createAudioContext: () => { throw new Error("No analyser"); },
    now: advanceNow,
    setInterval: () => 1 as unknown as ReturnType<typeof setTimeout>,
    clearInterval: vi.fn(),
    setTimeout: () => 2 as unknown as ReturnType<typeof setTimeout>,
    clearTimeout: vi.fn(),
    requestAnimationFrame: () => 3,
    cancelAnimationFrame: vi.fn(),
  };
}

describe("voice recorder lifecycle", () => {
  it("keeps MIME preference order and formats the bounded timer", () => {
    expect(selectVoiceMimeType((type) => type === "audio/mp4" || type === "audio/webm")).toBe("audio/mp4");
    expect(formatVoiceElapsed(0)).toBe("0:00");
    expect(formatVoiceElapsed(9)).toBe("0:09");
    expect(formatVoiceElapsed(90)).toBe("0:59");
  });

  it("moves through requesting, recording, and transcribing while preventing a double start", async () => {
    const permission = deferred<MediaStream>();
    const { stream, stop } = fakeStream();
    const recorder = new FakeRecorder();
    const phases: VoicePhase[] = [];
    const onRecording = vi.fn(async () => undefined);
    const controller = new VoiceRecorderController({
      onPhaseChange: (phase) => phases.push(phase), onElapsedChange: vi.fn(), onLevelChange: vi.fn(), onAnalyserChange: vi.fn(), onRecording, onError: vi.fn(),
    }, environment(() => permission.promise, recorder));

    const firstStart = controller.start();
    expect(controller.currentPhase).toBe("requesting");
    await expect(controller.start()).resolves.toBe(false);
    permission.resolve(stream);
    await expect(firstStart).resolves.toBe(true);
    expect(controller.currentPhase).toBe("recording");

    controller.stop();
    await vi.waitFor(() => expect(controller.currentPhase).toBe("idle"));
    expect(phases).toEqual(["requesting", "recording", "transcribing", "idle"]);
    expect(onRecording).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("stops a late permission stream after disposal without recording or callbacks", async () => {
    const permission = deferred<MediaStream>();
    const { stream, stop } = fakeStream();
    const recorder = new FakeRecorder();
    const onRecording = vi.fn(async () => undefined);
    const onError = vi.fn();
    const controller = new VoiceRecorderController({
      onPhaseChange: vi.fn(), onElapsedChange: vi.fn(), onLevelChange: vi.fn(), onAnalyserChange: vi.fn(), onRecording, onError,
    }, environment(() => permission.promise, recorder));

    const starting = controller.start();
    controller.dispose();
    permission.resolve(stream);
    await expect(starting).resolves.toBe(false);
    expect(stop).toHaveBeenCalledOnce();
    expect(onRecording).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("releases an active recording immediately on disposal", async () => {
    const { stream, stop } = fakeStream();
    const recorder = new FakeRecorder();
    const onRecording = vi.fn(async () => undefined);
    const controller = new VoiceRecorderController({
      onPhaseChange: vi.fn(), onElapsedChange: vi.fn(), onLevelChange: vi.fn(), onAnalyserChange: vi.fn(), onRecording, onError: vi.fn(),
    }, environment(() => Promise.resolve(stream), recorder));

    await controller.start();
    controller.dispose();
    expect(recorder.state).toBe("inactive");
    expect(stop).toHaveBeenCalledOnce();
    expect(onRecording).not.toHaveBeenCalled();
  });

  it("reports permission denial and returns to idle", async () => {
    const recorder = new FakeRecorder();
    const phases: VoicePhase[] = [];
    const onError = vi.fn();
    const controller = new VoiceRecorderController({
      onPhaseChange: (phase) => phases.push(phase), onElapsedChange: vi.fn(), onLevelChange: vi.fn(), onAnalyserChange: vi.fn(), onRecording: vi.fn(async () => undefined), onError,
    }, environment(() => Promise.reject(new Error("denied")), recorder));

    await expect(controller.start()).resolves.toBe(false);
    expect(phases).toEqual(["requesting", "idle"]);
    expect(onError).toHaveBeenCalledWith("Microphone access denied or unavailable. Type your description instead.");
  });
});
