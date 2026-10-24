/**
 * "Where is this fire?" in words.
 *
 * A FIRMS hotspot is a pair of coordinates — `-2.1234, 113.5678` tells a
 * responder nothing. This module resolves a coordinate to the nearest known
 * town and reports the distance and the compass bearing to it, so the UI can
 * say **"≈58 km NE of Palangka Raya"**.
 *
 * It is a lookup table, not a geocoder. The list is small and deliberate:
 * provincial capitals plus the towns that sit next to Indonesia's peat and
 * forest-fire corridors. The answer always carries a distance, so the reader
 * can see how approximate it is — no polygon boundaries are claimed.
 */

export interface Place {
  name: string;
  province: string;
  lat: number;
  lon: number;
}

export interface PlaceMatch {
  name: string;
  province: string;
  /** Great-circle distance to the place, in whole kilometres. */
  km: number;
  /** 8-point compass bearing from the place to the point, e.g. `NE`. */
  bearing: string;
}

/**
 * Reference towns, grouped by island. Coordinates are city centres to two
 * decimals (~1 km), which is far finer than the "≈" in the copy implies.
 */
export const PLACES: readonly Place[] = [
  /* ── Sumatra ─────────────────────────────────────────────────────────── */
  { name: 'Banda Aceh', province: 'Aceh', lat: 5.55, lon: 95.32 },
  { name: 'Lhokseumawe', province: 'Aceh', lat: 5.18, lon: 97.15 },
  { name: 'Langsa', province: 'Aceh', lat: 4.47, lon: 97.97 },
  { name: 'Meulaboh', province: 'Aceh', lat: 4.14, lon: 96.13 },
  { name: 'Medan', province: 'North Sumatra', lat: 3.6, lon: 98.67 },
  { name: 'Pematang Siantar', province: 'North Sumatra', lat: 2.96, lon: 99.07 },
  { name: 'Rantau Prapat', province: 'North Sumatra', lat: 2.33, lon: 99.83 },
  { name: 'Sibolga', province: 'North Sumatra', lat: 1.74, lon: 98.78 },
  { name: 'Padang', province: 'West Sumatra', lat: -0.95, lon: 100.42 },
  { name: 'Bukittinggi', province: 'West Sumatra', lat: -0.31, lon: 100.37 },
  { name: 'Pekanbaru', province: 'Riau', lat: 0.51, lon: 101.45 },
  { name: 'Dumai', province: 'Riau', lat: 1.67, lon: 101.45 },
  { name: 'Bengkalis', province: 'Riau', lat: 1.47, lon: 102.12 },
  { name: 'Rengat', province: 'Riau', lat: -0.37, lon: 102.55 },
  { name: 'Batam', province: 'Riau Islands', lat: 1.13, lon: 104.05 },
  { name: 'Tanjung Pinang', province: 'Riau Islands', lat: 0.92, lon: 104.47 },
  { name: 'Jambi', province: 'Jambi', lat: -1.61, lon: 103.61 },
  { name: 'Muara Bungo', province: 'Jambi', lat: -1.47, lon: 102.09 },
  { name: 'Palembang', province: 'South Sumatra', lat: -2.98, lon: 104.78 },
  { name: 'Lubuklinggau', province: 'South Sumatra', lat: -3.3, lon: 102.86 },
  { name: 'Lahat', province: 'South Sumatra', lat: -3.79, lon: 103.54 },
  { name: 'Pangkal Pinang', province: 'Bangka Belitung', lat: -2.13, lon: 106.12 },
  { name: 'Tanjung Pandan', province: 'Bangka Belitung', lat: -2.75, lon: 107.64 },
  { name: 'Bengkulu', province: 'Bengkulu', lat: -3.8, lon: 102.27 },
  { name: 'Bandar Lampung', province: 'Lampung', lat: -5.4, lon: 105.27 },

  /* ── Java ────────────────────────────────────────────────────────────── */
  { name: 'Serang', province: 'Banten', lat: -6.12, lon: 106.15 },
  { name: 'Jakarta', province: 'Jakarta', lat: -6.21, lon: 106.85 },
  { name: 'Bogor', province: 'West Java', lat: -6.6, lon: 106.82 },
  { name: 'Bandung', province: 'West Java', lat: -6.92, lon: 107.62 },
  { name: 'Cirebon', province: 'West Java', lat: -6.71, lon: 108.56 },
  { name: 'Tasikmalaya', province: 'West Java', lat: -7.33, lon: 108.22 },
  { name: 'Tegal', province: 'Central Java', lat: -6.87, lon: 109.14 },
  { name: 'Purwokerto', province: 'Central Java', lat: -7.42, lon: 109.24 },
  { name: 'Cilacap', province: 'Central Java', lat: -7.73, lon: 109.01 },
  { name: 'Semarang', province: 'Central Java', lat: -6.97, lon: 110.42 },
  { name: 'Surakarta', province: 'Central Java', lat: -7.58, lon: 110.82 },
  { name: 'Yogyakarta', province: 'Yogyakarta', lat: -7.8, lon: 110.37 },
  { name: 'Madiun', province: 'East Java', lat: -7.63, lon: 111.52 },
  { name: 'Surabaya', province: 'East Java', lat: -7.26, lon: 112.75 },
  { name: 'Malang', province: 'East Java', lat: -7.97, lon: 112.63 },
  { name: 'Jember', province: 'East Java', lat: -8.17, lon: 113.7 },
  { name: 'Banyuwangi', province: 'East Java', lat: -8.22, lon: 114.37 },
  { name: 'Sumenep', province: 'East Java', lat: -7.0, lon: 113.86 },

  /* ── Bali & Nusa Tenggara ────────────────────────────────────────────── */
  { name: 'Singaraja', province: 'Bali', lat: -8.11, lon: 115.09 },
  { name: 'Denpasar', province: 'Bali', lat: -8.67, lon: 115.21 },
  { name: 'Mataram', province: 'West Nusa Tenggara', lat: -8.58, lon: 116.12 },
  { name: 'Bima', province: 'West Nusa Tenggara', lat: -8.46, lon: 118.73 },
  { name: 'Labuan Bajo', province: 'East Nusa Tenggara', lat: -8.5, lon: 119.89 },
  { name: 'Ende', province: 'East Nusa Tenggara', lat: -8.84, lon: 121.66 },
  { name: 'Maumere', province: 'East Nusa Tenggara', lat: -8.62, lon: 122.21 },
  { name: 'Kupang', province: 'East Nusa Tenggara', lat: -10.18, lon: 123.61 },

  /* ── Kalimantan — the peat corridor ──────────────────────────────────── */
  { name: 'Singkawang', province: 'West Kalimantan', lat: 0.9, lon: 108.98 },
  { name: 'Pontianak', province: 'West Kalimantan', lat: -0.03, lon: 109.34 },
  { name: 'Ketapang', province: 'West Kalimantan', lat: -1.85, lon: 109.98 },
  { name: 'Sintang', province: 'West Kalimantan', lat: 0.07, lon: 111.5 },
  { name: 'Putussibau', province: 'West Kalimantan', lat: 0.83, lon: 112.93 },
  { name: 'Pangkalan Bun', province: 'Central Kalimantan', lat: -2.68, lon: 111.62 },
  { name: 'Sampit', province: 'Central Kalimantan', lat: -2.53, lon: 112.95 },
  { name: 'Palangka Raya', province: 'Central Kalimantan', lat: -2.21, lon: 113.92 },
  { name: 'Muara Teweh', province: 'Central Kalimantan', lat: -0.95, lon: 114.88 },
  { name: 'Kuala Kapuas', province: 'Central Kalimantan', lat: -3.0, lon: 114.38 },
  { name: 'Banjarmasin', province: 'South Kalimantan', lat: -3.32, lon: 114.59 },
  { name: 'Banjarbaru', province: 'South Kalimantan', lat: -3.46, lon: 114.81 },
  { name: 'Kotabaru', province: 'South Kalimantan', lat: -3.24, lon: 116.22 },
  { name: 'Samarinda', province: 'East Kalimantan', lat: -0.5, lon: 117.15 },
  { name: 'Balikpapan', province: 'East Kalimantan', lat: -1.24, lon: 116.85 },
  { name: 'Bontang', province: 'East Kalimantan', lat: 0.13, lon: 117.5 },
  { name: 'Tanjung Redeb', province: 'East Kalimantan', lat: 2.15, lon: 117.5 },
  { name: 'Tanjung Selor', province: 'North Kalimantan', lat: 2.84, lon: 117.37 },
  { name: 'Tarakan', province: 'North Kalimantan', lat: 3.33, lon: 117.58 },
  { name: 'Nunukan', province: 'North Kalimantan', lat: 4.13, lon: 117.67 },

  /* ── Sulawesi ────────────────────────────────────────────────────────── */
  { name: 'Manado', province: 'North Sulawesi', lat: 1.47, lon: 124.84 },
  { name: 'Kotamobagu', province: 'North Sulawesi', lat: 0.73, lon: 124.32 },
  { name: 'Gorontalo', province: 'Gorontalo', lat: 0.54, lon: 123.06 },
  { name: 'Luwuk', province: 'Central Sulawesi', lat: -0.94, lon: 122.79 },
  { name: 'Poso', province: 'Central Sulawesi', lat: -1.4, lon: 120.75 },
  { name: 'Palu', province: 'Central Sulawesi', lat: -0.89, lon: 119.87 },
  { name: 'Mamuju', province: 'West Sulawesi', lat: -2.68, lon: 118.89 },
  { name: 'Palopo', province: 'South Sulawesi', lat: -3.0, lon: 120.2 },
  { name: 'Watampone', province: 'South Sulawesi', lat: -4.54, lon: 120.33 },
  { name: 'Makassar', province: 'South Sulawesi', lat: -5.15, lon: 119.43 },
  { name: 'Kolaka', province: 'Southeast Sulawesi', lat: -4.06, lon: 121.59 },
  { name: 'Kendari', province: 'Southeast Sulawesi', lat: -3.95, lon: 122.5 },
  { name: 'Bau-Bau', province: 'Southeast Sulawesi', lat: -5.47, lon: 122.63 },

  /* ── Maluku & Papua ──────────────────────────────────────────────────── */
  { name: 'Ternate', province: 'North Maluku', lat: 0.79, lon: 127.38 },
  { name: 'Sofifi', province: 'North Maluku', lat: 0.73, lon: 127.57 },
  { name: 'Ambon', province: 'Maluku', lat: -3.7, lon: 128.18 },
  { name: 'Sorong', province: 'Southwest Papua', lat: -0.88, lon: 131.26 },
  { name: 'Fakfak', province: 'West Papua', lat: -2.93, lon: 132.3 },
  { name: 'Manokwari', province: 'West Papua', lat: -0.86, lon: 134.06 },
  { name: 'Nabire', province: 'Central Papua', lat: -3.36, lon: 135.49 },
  { name: 'Timika', province: 'Central Papua', lat: -4.55, lon: 136.89 },
  { name: 'Wamena', province: 'Papua', lat: -4.1, lon: 138.95 },
  { name: 'Jayapura', province: 'Papua', lat: -2.59, lon: 140.67 },
  { name: 'Merauke', province: 'South Papua', lat: -8.49, lon: 140.4 },
];

const EARTH_RADIUS_KM = 6371;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Great-circle distance in kilometres. */
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** 8-point compass bearing from point 1 to point 2, e.g. `NE`. */
export function bearingWord(lat1: number, lon1: number, lat2: number, lon2: number): string {
  const dLon = toRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRadians(lat2));
  const x =
    Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
    Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLon);
  const degrees = (Math.atan2(y, x) * 180) / Math.PI;
  return COMPASS[Math.round(((degrees + 360) % 360) / 45) % 8] ?? 'N';
}

/** Coordinates repeat across the map; resolve each rounded position once. */
const cache = new Map<string, PlaceMatch>();

/** Nearest reference town to a coordinate, with distance and bearing. */
export function nearestPlace(lat: number, lon: number): PlaceMatch {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const hit = cache.get(key);
  if (hit) return hit;

  let best: Place = PLACES[0] as Place;
  let bestKm = Number.POSITIVE_INFINITY;

  for (const place of PLACES) {
    const km = distanceKm(lat, lon, place.lat, place.lon);
    if (km < bestKm) {
      bestKm = km;
      best = place;
    }
  }

  const match: PlaceMatch = {
    name: best.name,
    province: best.province,
    km: Math.round(bestKm),
    // Bearing is *from the town to the fire*: "58 km NE of Palangka Raya"
    // means you drive north-east to reach it.
    bearing: bearingWord(best.lat, best.lon, lat, lon),
  };

  if (cache.size > 500) cache.clear();
  cache.set(key, match);
  return match;
}

/** Panel title: `≈58 km NE of Palangka Raya`, or `Near Palangka Raya` up close. */
export function formatPlaceTitle(match: PlaceMatch): string {
  if (match.km < 10) return `Near ${match.name}`;
  return `≈${match.km} km ${match.bearing} of ${match.name}`;
}

/** Rail row label: `Palangka Raya · 58 km NE`, kept short for a 320 px column. */
export function formatPlaceRail(match: PlaceMatch): string {
  if (match.km < 10) return match.name;
  return `${match.name} · ${match.km} km ${match.bearing}`;
}
