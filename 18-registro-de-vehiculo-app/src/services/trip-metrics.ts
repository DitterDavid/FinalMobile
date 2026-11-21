export type GpsPoint = {
  latitude: number;
  longitude: number;
  timestamp: number;
  speedMps: number | null;
  accuracy: number | null;
};

export type GpsSegment = { accepted: boolean; distanceMeters: number; speedKmh: number };

function distanceBetween(a: GpsPoint, b: GpsPoint) {
  const radians = (value: number) => value * Math.PI / 180;
  const dLat = radians(b.latitude - a.latitude);
  const dLon = radians(b.longitude - a.longitude);
  const startLat = radians(a.latitude);
  const endLat = radians(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(startLat) * Math.cos(endLat) * Math.sin(dLon / 2) ** 2;
  const boundedH = Math.min(1, Math.max(0, h));
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(boundedH), Math.sqrt(1 - boundedH));
}

/** Rejects location jumps above 200 km/h before they affect trip distance or top speed. */
export function calculateGpsSegment(previous: GpsPoint | null, current: GpsPoint): GpsSegment {
  if (current.accuracy !== null && current.accuracy > 60) return { accepted: false, distanceMeters: 0, speedKmh: 0 };
  if (!previous) return { accepted: true, distanceMeters: 0, speedKmh: 0 };

  const distanceMeters = distanceBetween(previous, current);
  const elapsedSeconds = (current.timestamp - previous.timestamp) / 1000;
  const segmentSpeedKmh = elapsedSeconds > 0 ? distanceMeters / elapsedSeconds * 3.6 : (distanceMeters === 0 ? 0 : Infinity);
  const sensorSpeedKmh = current.speedMps !== null && Number.isFinite(current.speedMps) && current.speedMps >= 0
    ? current.speedMps * 3.6 : null;
  const speedKmh = sensorSpeedKmh ?? segmentSpeedKmh;

  if (!Number.isFinite(speedKmh) || speedKmh > 200 || (distanceMeters > 0 && segmentSpeedKmh > 200)) {
    return { accepted: false, distanceMeters: 0, speedKmh: 0 };
  }
  return { accepted: true, distanceMeters, speedKmh };
}

export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainder = total % 60;
  return hours > 0
    ? `${hours} h ${String(minutes).padStart(2, '0')} min`
    : `${minutes} min ${String(remainder).padStart(2, '0')} s`;
}
