export type VoicePhase = "idle" | "requesting" | "recording" | "transcribing";

export const VOICE_RECORDING_LIMIT_MS = 59_000;
export const VOICE_MIME_TYPES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"] as const;

type TimerHandle = ReturnType<typeof setTimeout>;

export type VoiceRecorderEnvironment = {
  getUserMedia: () => Promise<MediaStream>;
  isTypeSupported: (type: string) => boolean;
  createMediaRecorder: (stream: MediaStream, options?: MediaRecorderOptions) => MediaRecorder;
  createAudioContext: () => AudioContext;
  now: () => number;
  setInterval: (callback: () => void, delay: number) => TimerHandle;
  clearInterval: (handle: TimerHandle) => void;
  setTimeout: (callback: () => void, delay: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
};

type VoiceRecorderCallbacks = {
  onPhaseChange: (phase: VoicePhase) => void;
  onElapsedChange: (seconds: number) => void;
  onLevelChange: (level: number) => void;
  onAnalyserChange: (available: boolean) => void;
  onRecording: (blob: Blob) => Promise<void>;
  onError: (message: string) => void;
};

function browserEnvironment(): VoiceRecorderEnvironment {
  return {
    getUserMedia: () => navigator.mediaDevices.getUserMedia({ audio: true }),
    isTypeSupported: (type) => MediaRecorder.isTypeSupported(type),
    createMediaRecorder: (stream, options) => new MediaRecorder(stream, options),
    createAudioContext: () => new AudioContext(),
    now: () => performance.now(),
    setInterval: (callback, delay) => globalThis.setInterval(callback, delay),
    clearInterval: (handle) => globalThis.clearInterval(handle),
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  };
}

export function selectVoiceMimeType(isTypeSupported: (type: string) => boolean): string | undefined {
  return VOICE_MIME_TYPES.find((type) => isTypeSupported(type));
}

export function formatVoiceElapsed(seconds: number): string {
  const bounded = Math.max(0, Math.min(59, Math.floor(seconds)));
  return `0:${String(bounded).padStart(2, "0")}`;
}

export class VoiceRecorderController {
  private phase: VoicePhase = "idle";
  private requestToken = 0;
  private disposed = false;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private elapsedTimer: TimerHandle | null = null;
  private limitTimer: TimerHandle | null = null;
  private animationFrame: number | null = null;
  private audioContext: AudioContext | null = null;
  private recordingStartedAt = 0;
  private stopHandled = false;

  constructor(
    private readonly callbacks: VoiceRecorderCallbacks,
    private readonly environment: VoiceRecorderEnvironment = browserEnvironment(),
  ) {}

  get currentPhase(): VoicePhase {
    return this.phase;
  }

  async start(): Promise<boolean> {
    if (this.disposed || this.phase !== "idle") return false;
    const token = ++this.requestToken;
    this.setPhase("requesting");
    this.callbacks.onElapsedChange(0);
    if (!this.disposed) this.callbacks.onLevelChange(0);
    this.callbacks.onAnalyserChange(false);

    let stream: MediaStream;
    try {
      stream = await this.environment.getUserMedia();
    } catch {
      if (this.disposed || token !== this.requestToken) return false;
      this.setPhase("idle");
      this.callbacks.onError("Microphone access denied or unavailable. Type your description instead.");
      return false;
    }

    if (this.disposed || token !== this.requestToken || this.currentPhase !== "requesting") {
      stopStream(stream);
      return false;
    }

    try {
      const mimeType = selectVoiceMimeType(this.environment.isTypeSupported);
      const recorder = this.environment.createMediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.stream = stream;
      this.recorder = recorder;
      this.chunks = [];
      this.stopHandled = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) this.chunks.push(event.data);
      };
      recorder.onstop = () => { void this.handleRecorderStopped(recorder); };
      recorder.onerror = () => {
        this.callbacks.onError("Microphone recording stopped unexpectedly. Type your description instead.");
        this.stop();
      };

      this.startAnalyser(stream);
      this.recordingStartedAt = this.environment.now();
      recorder.start();
      this.setPhase("recording");
      this.elapsedTimer = this.environment.setInterval(() => {
        const seconds = Math.min(59, Math.floor((this.environment.now() - this.recordingStartedAt) / 1000));
        this.callbacks.onElapsedChange(seconds);
      }, 250);
      this.limitTimer = this.environment.setTimeout(() => this.stop(), VOICE_RECORDING_LIMIT_MS);
      return true;
    } catch {
      stopStream(stream);
      this.cleanupRecordingResources();
      if (!this.disposed && token === this.requestToken) {
        this.setPhase("idle");
        this.callbacks.onError("Microphone recording is unavailable. Type your description instead.");
      }
      return false;
    }
  }

  stop(): void {
    if (this.disposed) return;
    if (this.phase === "requesting") {
      this.requestToken++;
      this.setPhase("idle");
      return;
    }
    if (this.phase !== "recording") return;
    this.callbacks.onElapsedChange(Math.min(59, Math.floor((this.environment.now() - this.recordingStartedAt) / 1000)));
    this.setPhase("transcribing");
    if (this.recorder?.state === "recording") this.recorder.stop();
    else if (this.recorder) void this.handleRecorderStopped(this.recorder);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.requestToken++;
    const recorder = this.recorder;
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
      if (recorder.state === "recording") recorder.stop();
    }
    this.cleanupRecordingResources();
    this.phase = "idle";
  }

  private setPhase(phase: VoicePhase): void {
    this.phase = phase;
    if (!this.disposed) this.callbacks.onPhaseChange(phase);
  }

  private async handleRecorderStopped(recorder: MediaRecorder): Promise<void> {
    if (this.stopHandled) return;
    this.stopHandled = true;
    const blob = new Blob(this.chunks, { type: recorder.mimeType });
    this.cleanupRecordingResources();
    if (this.disposed) return;
    if (this.phase !== "transcribing") this.setPhase("transcribing");
    try {
      await this.callbacks.onRecording(blob);
    } catch (error) {
      if (!this.disposed) this.callbacks.onError(error instanceof Error ? error.message : "Microphone transcription unavailable. Type your description instead.");
    } finally {
      if (!this.disposed) this.setPhase("idle");
    }
  }

  private startAnalyser(stream: MediaStream): void {
    try {
      const context = this.environment.createAudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 64;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Uint8Array(analyser.fftSize);
      this.audioContext = context;
      this.callbacks.onAnalyserChange(true);
      const sample = () => {
        if (this.disposed || this.phase !== "recording") return;
        analyser.getByteTimeDomainData(samples);
        let total = 0;
        for (const value of samples) total += Math.abs(value - 128);
        this.callbacks.onLevelChange(Math.min(1, total / samples.length / 32));
        this.animationFrame = this.environment.requestAnimationFrame(sample);
      };
      this.animationFrame = this.environment.requestAnimationFrame(sample);
    } catch {
      this.callbacks.onAnalyserChange(false);
    }
  }

  private cleanupRecordingResources(): void {
    if (this.elapsedTimer !== null) this.environment.clearInterval(this.elapsedTimer);
    if (this.limitTimer !== null) this.environment.clearTimeout(this.limitTimer);
    if (this.animationFrame !== null) this.environment.cancelAnimationFrame(this.animationFrame);
    this.elapsedTimer = null;
    this.limitTimer = null;
    this.animationFrame = null;
    stopStream(this.stream);
    this.stream = null;
    this.recorder = null;
    this.chunks = [];
    this.callbacks.onLevelChange(0);
    if (this.audioContext) void this.audioContext.close().catch(() => undefined);
    this.audioContext = null;
  }
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}
