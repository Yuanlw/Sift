const MAX_CHUNK_LENGTH = 1400;

export function chunkText(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return [];
  }

  const chunks: string[] = [];
  let cursor = 0;

  while (cursor < normalized.length) {
    chunks.push(normalized.slice(cursor, cursor + MAX_CHUNK_LENGTH));
    cursor += MAX_CHUNK_LENGTH;
  }

  return chunks;
}

export function roughTokenCount(text: string) {
  return Math.ceil(text.length / 4);
}
