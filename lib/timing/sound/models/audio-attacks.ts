// audio-attacks.ts: where a sound's level jumps, read from its samples. Pure: output/sound-check times a video's
// sounds against its music by it, and the sound library's tests check a recipe lands where it says.

// Level in 8 ms windows every 2 ms. A window's jump is over the loudest of those starting 8, 12 and 16 ms before it.
const HOP_SECONDS = 0.002, WINDOW_SECONDS = 0.008;
const LOOKBACK_HOPS = [4, 6, 8];
export const ATTACK_LOOKBACK_SECONDS = Math.max(...LOOKBACK_HOPS) * HOP_SECONDS;
// Under the music, a level 40 dB below a file's loudest goes unheard, and from digital silence any first sample of a
// swell would read as a jump; so the envelope goes no lower.
const ENVELOPE_RANGE_DB = 40;

/** A jump in level: when it starts, in seconds, and how far it rose over the level 8–16 ms before, in dB. */
export type AudioAttack = { t: number; riseDb: number };

export type AudioLevelEnvelope = { db: Float32Array; floorDb: number };

/** Level in dB, one value a hop, floored ENVELOPE_RANGE_DB under the loudest. */
export function audioLevelEnvelope(samples: Float32Array, rate: number): AudioLevelEnvelope {
  const hop = Math.round(rate * HOP_SECONDS), win = Math.round(rate * WINDOW_SECONDS);
  const db = new Float32Array(Math.max(0, Math.floor((samples.length - win) / hop) + 1));
  let loudest = -Infinity;
  for (let i = 0; i < db.length; i++) {
    let sum = 0;
    for (let j = i * hop; j < i * hop + win; j++) sum += samples[j] * samples[j];
    db[i] = 10 * Math.log10(sum / win + 1e-12);
    loudest = Math.max(loudest, db[i]);
  }
  const floorDb = loudest - ENVELOPE_RANGE_DB;
  for (let i = 0; i < db.length; i++) db[i] = Math.max(db[i], floorDb);
  return { db, floorDb };
}

// Before the file starts is as quiet as its envelope goes, so an attack on its first sample counts.
function riseDb({ db, floorDb }: AudioLevelEnvelope, i: number): number {
  if (i < 0 || i >= db.length) return -Infinity;
  return db[i] - Math.max(...LOOKBACK_HOPS.map((k) => (i >= k ? db[i - k] : floorDb)));
}

/** Each attack's time is the start of the window that jumps most, which is where a sharp attack begins. */
export function attacksInEnvelope(env: AudioLevelEnvelope, minRiseDb: number): AudioAttack[] {
  const attacks: AudioAttack[] = [];
  for (let i = 0; i < env.db.length; i++) {
    const rise = riseDb(env, i);
    if (rise < minRiseDb || rise < riseDb(env, i - 1) || rise <= riseDb(env, i + 1)) continue;
    const t = i * HOP_SECONDS, last = attacks.at(-1);
    // A jump can crest twice as the window slides through it; within the lookback it's one attack, the bigger crest.
    if (last && t - last.t < ATTACK_LOOKBACK_SECONDS) {
      if (rise > last.riseDb) attacks[attacks.length - 1] = { t, riseDb: rise };
    } else attacks.push({ t, riseDb: rise });
  }
  return attacks;
}

/** Every jump of at least `minRiseDb` over the level 8–16 ms before, in mono `samples` at `rate`. */
export function detectAudioAttacks(samples: Float32Array, rate: number, minRiseDb: number): AudioAttack[] {
  return attacksInEnvelope(audioLevelEnvelope(samples, rate), minRiseDb);
}

/** The middle of the loudest window starting between `from` and `to` seconds. */
export function loudestWindowIn({ db }: AudioLevelEnvelope, from: number, to: number): number {
  let best = Math.max(0, Math.round(from / HOP_SECONDS));
  for (let i = best; i <= Math.min(db.length - 1, Math.round(to / HOP_SECONDS)); i++) if (db[i] > db[best]) best = i;
  return best * HOP_SECONDS + WINDOW_SECONDS / 2;
}
