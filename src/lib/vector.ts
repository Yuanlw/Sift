export function toSqlVector(embedding: number[]) {
  return `[${embedding.join(",")}]`;
}
