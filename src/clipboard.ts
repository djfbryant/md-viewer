/**
 * One place that talks to the clipboard. Call sites decide what to copy and what
 * to say; they never learn which browser API answered, or that it can refuse.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  const clipboard = navigator.clipboard;
  if (typeof clipboard?.writeText !== 'function') return false;

  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
