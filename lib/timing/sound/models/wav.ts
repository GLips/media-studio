// wav.ts: 16-bit mono PCM in and out of WAV files, for the voice scripts. Node only.

/** Headerless 16-bit mono PCM (what Gemini returns) as a WAV, which ffmpeg and browsers both need. */
export function wavFromPcm(pcm: Buffer, rate: number) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export const wavFromSamples = (samples: Int16Array, rate: number) =>
  wavFromPcm(Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength), rate);

/** A 16-bit mono WAV's samples. Walks the chunks, since ffmpeg and recorders can put metadata before the samples. */
export function samplesFromWav(wav: Buffer): { samples: Int16Array; rate: number } {
  let rate = 0;
  for (let at = 12; at + 8 <= wav.length;) {
    const id = wav.toString('ascii', at, at + 4), size = wav.readUInt32LE(at + 4);
    if (id === 'fmt ') {
      if (wav.readUInt16LE(at + 8) !== 1 || wav.readUInt16LE(at + 10) !== 1 || wav.readUInt16LE(at + 22) !== 16) throw new Error('expected a 16-bit mono PCM WAV');
      rate = wav.readUInt32LE(at + 12);
    }
    if (id === 'data') {
      const bytes = wav.subarray(at + 8, at + 8 + size);
      return { samples: new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)), rate };
    }
    at += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}
