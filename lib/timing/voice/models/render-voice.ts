// render-voice.ts: whose voice a render speaks in, recorded in its snapshot when it's made, so a review of it can say
// so later whatever the project's voice has become since.

/** `draft` is macOS say (`studio voice sync --draft`), for timing only; `final` a real take; null no generated voice: none at all, or only lines spoken in recordings, which are the speaker's own. */
export type RenderVoice = 'draft' | 'final' | null;
