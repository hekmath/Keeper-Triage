// src/utils/chunk.ts
export function splitIntoChunks(
  text: string,
  maxChars = 2200, // ~800–1000 tokens for English text
  overlap = 300
): { content: string; index: number }[] {
  const clean = text
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  if (clean.length <= maxChars) return [{ content: clean, index: 0 }];

  const chunks: { content: string; index: number }[] = [];
  let start = 0;
  let i = 0;

  while (start < clean.length) {
    const end = Math.min(start + maxChars, clean.length);
    const slice = clean.slice(start, end);

    // prefer breaking at a boundary near the end
    let splitAt = Math.max(
      slice.lastIndexOf('\n\n'),
      slice.lastIndexOf('. '),
      slice.lastIndexOf('! '),
      slice.lastIndexOf('? ')
    );
    if (splitAt < Math.floor(maxChars * 0.5)) splitAt = slice.length;

    const piece = slice.slice(0, splitAt).trim();
    if (piece) chunks.push({ content: piece, index: i++ });

    if (end === clean.length) break;

    // overlap from the end of the piece
    const nextStart = start + piece.length - overlap;
    start = Math.max(nextStart, start + 1);
  }

  return chunks;
}
