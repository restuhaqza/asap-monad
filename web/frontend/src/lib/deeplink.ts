/** Deep links: `#h=12` opens hotspot 12 as soon as it is on screen. */

export function parseHotspotHash(hash: string): number | null {
  const match = /h=(\d+)/.exec(hash);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isInteger(id) && id > 0 ? id : null;
}

export function hotspotHash(id: number): string {
  return `#h=${id}`;
}
