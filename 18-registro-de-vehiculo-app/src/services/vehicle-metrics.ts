export type Refuel = { km: number; litros: number; total_centavos: number };

export function calculateMetrics(previous: Refuel | null, current: Refuel) {
  if (current.litros <= 0 || current.total_centavos <= 0) throw new Error('Litros y total deben ser mayores que cero.');
  const distance = previous ? current.km - previous.km : null;
  if (distance !== null && distance < 0) throw new Error('El kilometraje no puede disminuir.');
  return {
    consumoKmL: distance !== null && current.litros > 0 ? distance / current.litros : null,
    costoPorKm: distance !== null && distance > 0 ? current.total_centavos / 100 / distance : null,
  };
}

export function isValidColombianPlate(value: string) { return /^[A-Z]{3}\d{3}$|^[A-Z]{3}\d{2}[A-Z]$/.test(value.trim().toUpperCase()); }

export function accumulateGpsDistance(points: { latitude: number; longitude: number }[]) {
  const rad = (n: number) => n * Math.PI / 180;
  let meters = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
    meters += 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
  }
  return meters;
}
