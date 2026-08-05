// Geo helpers: haversine distance and a rough bbox for radius pre-filtering.

const EARTH_RADIUS_MI = 3958.7613;

export function haversineMiles(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Bounding box (in degrees) that safely contains a radius in miles. */
export function radiusBox(lat: number, lng: number, radiusMi: number) {
  const latDelta = radiusMi / 69; // ~69 miles per degree latitude
  const lngDelta = radiusMi / (69 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

export function roundMiles(mi: number): number {
  return Math.round(mi * 10) / 10;
}
