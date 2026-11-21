import type { SQLiteDatabase } from 'expo-sqlite';
import { File, Paths } from 'expo-file-system';

type VehicleRow = { id: string; alias: string; placa: string };
type CsvRow = Record<string, string | number | null>;

const columns = [
  'tipo_registro', 'vehiculo', 'placa', 'fecha', 'fecha_fin', 'odometro_km',
  'proximo_km', 'proxima_fecha', 'litros', 'total_COP', 'distancia_km',
  'duracion_min', 'velocidad_max_kmh', 'metodo_viaje', 'km_inicio', 'km_fin',
  'detalle', 'factura_adjunta',
];

function csvCell(value: string | number | null, text = false) {
  if (value === null || value === '') return '';
  let content = String(value);
  if (text && /^[=+\-@\t\r]/.test(content)) content = `'${content}`;
  return `"${content.replace(/"/g, '""')}"`;
}

function csvNumber(value: number, decimals = 2) {
  if (decimals === 0) return String(Math.round(value));
  return value.toFixed(decimals).replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1').replace('.', ',');
}

function csvDateTime(value: string) {
  return value.replace('T', ' ').replace(/\.\d{3}Z$/, '').replace(/Z$/, ' UTC');
}

export async function exportVehicleLogCsv(db: SQLiteDatabase) {
  const vehicles = await db.getAllAsync<VehicleRow>(
    'SELECT id, alias, placa FROM vehiculo WHERE deleted = 0 ORDER BY alias COLLATE NOCASE',
  );
  const rows: CsvRow[] = [];

  for (const vehicle of vehicles) {
    const [refuels, maintenance, trips] = await Promise.all([
      db.getAllAsync<{ fecha: string; km: number; litros: number; total_centavos: number }>(
        'SELECT fecha, km, litros, total_centavos FROM tanqueo WHERE vehiculo_id = ? AND deleted = 0 ORDER BY fecha, km', vehicle.id,
      ),
      db.getAllAsync<{ fecha: string; km: number; proximo_km: number | null; proxima_fecha: string | null; tipo: string; foto_uri: string | null }>(
        'SELECT fecha, km, proximo_km, proxima_fecha, tipo, foto_uri FROM mantenimiento WHERE vehiculo_id = ? AND deleted = 0 ORDER BY fecha, km', vehicle.id,
      ),
      db.getAllAsync<{ started_at: string; ended_at: string; distancia_metros: number; duracion_segundos: number; velocidad_max_kmh: number; metodo: string; km_inicio: number | null; km_fin: number | null }>(
        'SELECT started_at, ended_at, distancia_metros, duracion_segundos, velocidad_max_kmh, metodo, km_inicio, km_fin FROM viaje WHERE vehiculo_id = ? AND deleted = 0 ORDER BY started_at', vehicle.id,
      ),
    ]);
    const base = { vehiculo: vehicle.alias, placa: vehicle.placa };
    for (const item of refuels) rows.push({
      ...base, tipo_registro: 'Tanqueo', fecha: item.fecha, odometro_km: item.km,
      litros: csvNumber(item.litros), total_COP: csvNumber(item.total_centavos / 100, 0),
    });
    for (const item of maintenance) rows.push({
      ...base, tipo_registro: 'Mantenimiento', fecha: item.fecha, odometro_km: item.km,
      proximo_km: item.proximo_km, proxima_fecha: item.proxima_fecha,
      detalle: item.tipo, factura_adjunta: item.foto_uri ? 'Sí' : 'No',
    });
    for (const item of trips) rows.push({
      ...base, tipo_registro: 'Viaje', fecha: csvDateTime(item.started_at), fecha_fin: csvDateTime(item.ended_at),
      distancia_km: csvNumber(item.distancia_metros / 1000), duracion_min: csvNumber(item.duracion_segundos / 60),
      velocidad_max_kmh: csvNumber(item.velocidad_max_kmh), metodo_viaje: item.metodo,
      km_inicio: item.km_inicio, km_fin: item.km_fin,
    });
  }

  const content = [columns.join(';'), ...rows.map(row => columns.map(column => csvCell(
    row[column] ?? null,
    ['tipo_registro', 'vehiculo', 'placa', 'fecha', 'fecha_fin', 'proxima_fecha', 'metodo_viaje', 'detalle', 'factura_adjunta'].includes(column),
  )).join(';'))].join('\r\n');
  const file = new File(Paths.cache, 'bitacora-vehiculo.csv');
  await file.write(`\uFEFF${content}`);
  return { uri: file.uri, records: rows.length };
}
