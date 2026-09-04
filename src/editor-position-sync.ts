export const SOURCE_START_ATTRIBUTE = 'data-source-start';
export const SOURCE_END_ATTRIBUTE = 'data-source-end';

/**
 * Converts a textarea offset, whose line endings are normalized to LF, back
 * to an offset in the original Markdown string.
 */
export function sourceOffsetForEditorOffset(source: string, editorOffset: number) {
  let normalizedOffset = 0;
  for (let sourceOffset = 0; sourceOffset < source.length; sourceOffset += 1) {
    if (normalizedOffset >= editorOffset) return sourceOffset;
    if (source[sourceOffset] === '\r' && source[sourceOffset + 1] === '\n') sourceOffset += 1;
    normalizedOffset += 1;
  }
  return source.length;
}

type SourceRange = {
  element: HTMLElement;
  start: number;
  end: number;
};

function sourceRange(element: HTMLElement): SourceRange | null {
  const start = Number.parseInt(element.getAttribute(SOURCE_START_ATTRIBUTE) ?? '', 10);
  const end = Number.parseInt(element.getAttribute(SOURCE_END_ATTRIBUTE) ?? '', 10);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) return null;
  return { element, start, end };
}

function distanceToRange(offset: number, range: SourceRange) {
  if (offset < range.start) return range.start - offset;
  if (offset > range.end) return offset - range.end;
  return 0;
}

/**
 * Finds the smallest rendered block that covers a source offset. When the
 * caret is in a blank line, the nearest rendered block wins.
 */
export function findSourceBlockAtOffset(container: HTMLElement, offset: number) {
  const ranges = [...container.querySelectorAll<HTMLElement>(`[${SOURCE_START_ATTRIBUTE}][${SOURCE_END_ATTRIBUTE}]`)]
    .map(sourceRange)
    .filter((range): range is SourceRange => Boolean(range));
  if (!ranges.length) return null;

  const containing = ranges.filter((range) => range.start <= offset && offset < range.end);
  const candidates = containing.length ? containing : ranges;
  candidates.sort((left, right) => {
    const distance = distanceToRange(offset, left) - distanceToRange(offset, right);
    if (distance) return distance;
    return (left.end - left.start) - (right.end - right.start);
  });
  return candidates[0]?.element ?? null;
}

/**
 * Reads the source start attached to the rendered block under a preview click.
 */
export function sourceOffsetFromPreviewTarget(preview: HTMLElement, target: EventTarget | null) {
  if (!(target instanceof Element)) return null;
  const block = target.closest<HTMLElement>(`[${SOURCE_START_ATTRIBUTE}][${SOURCE_END_ATTRIBUTE}]`);
  if (!block || !preview.contains(block)) return null;
  return sourceRange(block)?.start ?? null;
}

export function scrollSourceBlockIntoView(element: HTMLElement | null) {
  if (!element || typeof element.scrollIntoView !== 'function') return;
  element.scrollIntoView({ block: 'center', inline: 'nearest' });
}
