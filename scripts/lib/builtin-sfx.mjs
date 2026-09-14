// Original low-level interaction sounds. These are never used as teaching speech.
export function builtinSfx() {
  const rate = 24000;
  const definitions = [
    { id: 'pop', duration: 0.055, frequencies: [950], sweep: -400 },
    { id: 'chime_success', duration: 0.24, frequencies: [660, 880], sweep: 0 },
    { id: 'star_coin', duration: 0.19, frequencies: [880, 1174], sweep: 80 },
  ];
  const chunks = []; const sprite = {}; let samples = 0;
  for (const definition of definitions) {
    chunks.push(Buffer.alloc(rate * 0.15 * 2)); samples += rate * 0.15;
    const length = Math.round(definition.duration * rate); const pcm = Buffer.alloc(length * 2);
    for (let index = 0; index < length; index++) {
      const time = index / rate; const fraction = index / length;
      const envelope = Math.min(1, time / 0.003) * (1 - fraction) ** 2;
      const signal = definition.frequencies.reduce((sum, frequency) => sum + Math.sin(2 * Math.PI * (frequency * time + definition.sweep * time * time / 2)), 0) / definition.frequencies.length;
      pcm.writeInt16LE(Math.round(signal * envelope * 0.18 * 32767), index * 2);
    }
    sprite[definition.id] = [samples / rate * 1000, length / rate * 1000];
    chunks.push(pcm, Buffer.alloc(rate * 0.15 * 2)); samples += length + rate * 0.15;
  }
  const body = Buffer.concat(chunks); const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(body.length + 36, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(body.length, 40);
  return { bytes: Buffer.concat([header, body]), sprite: { audioAssetId: 'audio:sfx', durationMs: samples / rate * 1000, sampleRate: rate, channels: 1, sprite } };
}
