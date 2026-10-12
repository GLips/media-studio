import { ScrollArea } from '@mantine/core';
import { useMergedRef } from '@mantine/hooks';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

const FADE = '16px';

const styles = stylex.create({
  area: { minHeight: 0, height: '100%' },
  // Masks, not overlays: the fade shows whatever ground the panel sits on.
  fadeTop: { maskImage: `linear-gradient(to bottom, transparent, black ${FADE})` },
  fadeBottom: { maskImage: `linear-gradient(to top, transparent, black ${FADE})` },
  fadeBoth: { maskImage: `linear-gradient(to bottom, transparent, black ${FADE}, black calc(100% - ${FADE}), transparent)` },
});

type FadeScrollProps = {
  readonly children: ReactNode;
  /** The scrolled viewport, for a panel that scrolls a row into view or watches the reader scroll. */
  readonly viewportRef?: RefObject<HTMLDivElement | null>;
  readonly onScroll?: () => void;
};

type FadeEdges = { above: boolean; below: boolean };

const edgesOf = (v: HTMLDivElement): FadeEdges => ({ above: v.scrollTop > 0, below: v.scrollTop + v.clientHeight < v.scrollHeight - 1 });

/** A panel's own scroll, the one kind the app allows: its edges fade where more lies beyond them. */
export function FadeScroll({ children, viewportRef, onScroll }: FadeScrollProps) {
  const own = useRef<HTMLDivElement>(null);
  const merged = useMergedRef(own, viewportRef);
  const [edges, setEdges] = useState<FadeEdges>({ above: false, below: false });
  // Content grows and the panel resizes without a scroll event, so both are watched for a new bottom edge.
  useEffect(() => {
    const v = own.current;
    if (!v) return undefined;
    const measure = () => setEdges(edgesOf(v));
    const observer = new ResizeObserver(measure);
    observer.observe(v);
    if (v.firstElementChild) observer.observe(v.firstElementChild);
    return () => observer.disconnect();
  }, []);
  const fade = (edges.above && edges.below && styles.fadeBoth) || (edges.above && styles.fadeTop) || (edges.below && styles.fadeBottom);
  return (
    <ScrollArea
      type="never"
      viewportRef={merged}
      viewportProps={{ onScroll: (event) => { setEdges(edgesOf(event.currentTarget)); onScroll?.(); } }}
      {...stylex.props(styles.area, fade)}
    >
      {children}
    </ScrollArea>
  );
}
