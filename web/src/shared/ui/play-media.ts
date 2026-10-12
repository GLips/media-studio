/**
 * Starts `media`, letting go of the AbortError a pause raises when it lands while the play is still starting: that
 * pause is what was meant (`K`, a loop's end). Any other refusal still surfaces.
 */
export function playMedia(media: HTMLMediaElement): void {
  // play() rejects only with a DOMException: AbortError, NotAllowedError or NotSupportedError.
  media.play().catch((error: DOMException) => {
    if (error.name !== 'AbortError') throw error;
  });
}
