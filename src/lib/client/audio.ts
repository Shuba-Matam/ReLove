export async function recordingToWav(blob: Blob): Promise<File> {
  const context = new AudioContext();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    if (decoded.duration > 60) throw new Error("Record up to 60 seconds at a time.");
    const sampleRate = 16000;
    const offline = new OfflineAudioContext(1, Math.ceil(decoded.duration * sampleRate), sampleRate);
    const source = offline.createBufferSource(); source.buffer = decoded; source.connect(offline.destination); source.start();
    const mono = (await offline.startRendering()).getChannelData(0);
    const buffer = new ArrayBuffer(44 + mono.length * 2); const view = new DataView(buffer);
    const text = (at: number, value: string) => [...value].forEach((char, index) => view.setUint8(at + index, char.charCodeAt(0)));
    text(0, "RIFF"); view.setUint32(4, buffer.byteLength - 8, true); text(8, "WAVE"); text(12, "fmt ");
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, "data"); view.setUint32(40, mono.length * 2, true);
    mono.forEach((sample, index) => { const bounded = Math.max(-1, Math.min(1, sample)); view.setInt16(44 + index * 2, bounded < 0 ? bounded * 32768 : bounded * 32767, true); });
    return new File([buffer], "recording.wav", { type: "audio/wav" });
  } finally { await context.close(); }
}
