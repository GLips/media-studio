// paid-media.ts: what every provider's client hands back, so paid-generation.ts caches and records them alike.

/**
 * What one paid generation returned: the media's bytes, what it cost in USD (null where the provider doesn't say),
 * the provider's id for the request, and the account plan where the licence depends on it.
 */
export type PaidMedia = { outputs: Buffer[]; cost: number | null; requestId: string | null; plan?: string };
