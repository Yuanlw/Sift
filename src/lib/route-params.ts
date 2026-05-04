export function safeDecodeRouteParam(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
