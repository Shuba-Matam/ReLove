export function validateWav(bytes: Uint8Array): { durationSeconds: number; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (offset: number) => String.fromCharCode(...bytes.slice(offset, offset + 4));
  if (bytes.length < 44 || tag(0) !== "RIFF" || tag(8) !== "WAVE") throw new Error("Record a WAV clip.");
  let sampleRate = 0; let dataBytes = 0; let formatFound = false;
  for (let offset = 12; offset + 8 <= bytes.length;) {
    const length = view.getUint32(offset + 4, true); const start = offset + 8;
    if (start + length > bytes.length) throw new Error("The audio file is incomplete.");
    if (tag(offset) === "fmt ") {
      if (length < 16 || view.getUint16(start, true) !== 1 || view.getUint16(start + 2, true) !== 1 || view.getUint16(start + 14, true) !== 16) throw new Error("Use mono 16-bit PCM audio.");
      sampleRate = view.getUint32(start + 4, true);
      if (![16000, 24000].includes(sampleRate)) throw new Error("Use 16 kHz or 24 kHz audio.");
      formatFound = true;
    }
    if (tag(offset) === "data") dataBytes += length;
    offset = start + length + (length % 2);
  }
  const durationSeconds = dataBytes / (sampleRate * 2);
  if (!formatFound || !dataBytes || dataBytes % 2 || !Number.isFinite(durationSeconds) || durationSeconds > 60) throw new Error("Record a clip of up to 60 seconds.");
  return { durationSeconds, sampleRate };
}
