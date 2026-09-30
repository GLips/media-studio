// caption-style.tsx: what a caption style is (a paging rule, a band and a renderer over the caption state), the burned-in
// captions a video draws with its style, and the band scenes read to keep clear of them.

import { createContext, useContext, useMemo, type ComponentType } from 'react';
import type { FrameSize } from '#lib/picture/frame/models/frame.ts';
import { pillCaptionBand, type CaptionBand, type CaptionBandRule } from '../models/caption-band.ts';
import { captionStateAt, pageCaptions, type CaptionMeasure, type CaptionPage, type CaptionPagingRule, type CaptionState } from '../models/caption-pages.ts';
import type { CaptionTrack } from '../models/caption-track.ts';
import { useVideoFormat } from '#lib/picture/frame/studio/video-format.ts';

export type CaptionRenderProps = { state: CaptionState; band: CaptionBand; t: number };

export type CaptionStyle = {
  name: string;
  /** How the burned-in captions page. */
  rule: CaptionPagingRule;
  /** How the .srt and .vtt page, when `rule` is too short to read as subtitles (pops); `rule` otherwise. */
  sidecarRule?: CaptionPagingRule;
  band: CaptionBandRule;
  /** How wide a line sets in the style's type at `band`; without it, lines break on `rule.maxChars`. */
  measure?(band: CaptionBand): CaptionMeasure;
  /** Draws the page showing. Its box carries `data-framing="caption"`, so the framing check keeps scenes out from under it. */
  Caption: ComponentType<CaptionRenderProps>;
};

/** The pages a style burns in at a frame size. */
export function burnedCaptionPages(style: CaptionStyle, track: CaptionTrack, size: FrameSize): CaptionPage[] {
  return pageCaptions(track, style.rule, style.measure?.(style.band(size)));
}

/** The pages its .srt and .vtt hold: by its sidecar rule, or exactly the burned-in pages when it has none. */
export const sidecarCaptionPages = (style: CaptionStyle, track: CaptionTrack, size: FrameSize): CaptionPage[] =>
  style.sidecarRule ? pageCaptions(track, style.sidecarRule) : burnedCaptionPages(style, track, size);

/** The caption at `t`, in `style`, from the pages burnedCaptionPages made. */
export function BurnedCaptions({ style, pages, t }: { style: CaptionStyle; pages: readonly CaptionPage[]; t: number }) {
  const size = useVideoFormat();
  const band = useMemo(() => style.band(size), [style, size.width, size.height]);
  const state = captionStateAt(pages, t);
  return state && <style.Caption state={state} band={band} t={t} />;
}

/** The video's caption style's band, which Video.tsx provides; the pill's outside a video (a still). */
export const CaptionBandContext = createContext<CaptionBandRule | null>(null);

/** The video's caption style's band, for camFit's `captionBand`. */
export const useCaptionBandRule = (): CaptionBandRule => useContext(CaptionBandContext) ?? pillCaptionBand;

/** Where the video's captions sit, for a piece that keeps its text above them. */
export function useCaptionSafeArea(): CaptionBand {
  return useCaptionBandRule()(useVideoFormat());
}
