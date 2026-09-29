// render-voice.ts: whose voice a render speaks in, recorded in its snapshot when it's made, so a review of it can say
// so later whatever the project's voice has become since.

/** `draft` is macOS say (`studio voice --read=draft`), for timing only; `final` a real take; null no voice at all. */
export type RenderVoice = 'draft' | 'final' | null;
