import { Code } from '@mantine/core';
import { Fragment } from 'react';

/** A recipe's own doc, whose backticked names show as code. */
export function LabSfxDocText({ doc }: { readonly doc: string }) {
  // Keyed by where each part starts in the doc: a name can come up twice, but never at the same place.
  let at = 0;
  return doc.split(/(`[^`]+`)/).map((part) => {
    const key = at;
    at += part.length;
    return part.startsWith('`') ? <Code key={key}>{part.slice(1, -1)}</Code> : <Fragment key={key}>{part}</Fragment>;
  });
}
