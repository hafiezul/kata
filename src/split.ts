// Text splitting: Marian models handle ~512 tokens, and translate best one
// sentence (or a few short ones) at a time. We keep line breaks intact.

const MAX_CHUNK_CHARS = 400;

export interface Piece {
  /** Text to translate (empty for pure whitespace). */
  text: string;
  /** Whitespace that followed it in the original. */
  after: string;
}

export function splitText(text: string, lang: string): Piece[] {
  const pieces: Piece[] = [];
  const segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' });
  // Keep newline runs as separators.
  const lines = text.split(/(\n+)/);
  for (let i = 0; i < lines.length; i += 2) {
    const line = lines[i];
    const newline = lines[i + 1] ?? '';
    const startCount = pieces.length;
    const lead = line.match(/^\s*/)![0];
    if (lead) pieces.push({ text: '', after: lead });

    let chunk = '';
    const flush = () => {
      if (chunk.trim()) pieces.push({ text: chunk.trim(), after: ' ' });
      chunk = '';
    };
    for (const { segment } of segmenter.segment(line.trim())) {
      if (chunk && chunk.length + segment.length > MAX_CHUNK_CHARS) flush();
      chunk += segment;
    }
    flush();
    // Replace the trailing space of the last piece on this line with the newline run.
    const last = pieces.length > startCount ? pieces[pieces.length - 1] : undefined;
    if (last) last.after = last.text ? newline : last.after + newline;
    else if (newline) pieces.push({ text: '', after: newline });
  }
  return pieces;
}
