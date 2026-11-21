import type { SQLiteDatabase } from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { queueCloudSync } from '@/services/cloud-sync';

export type TripRecord = {
  id: string;
  vehiculo_id: string;
  started_at: string;
  ended_at: string;
  distancia_metros: number;
  velocidad_max_kmh: number;
  duracion_segundos: number;
  metodo: 'gps' | 'manual';
  km_inicio: number | null;
  km_fin: number | null;
};

export async function listTrips(db: SQLiteDatabase, vehicleId: string) {
  return db.getAllAsync<TripRecord>(
    `SELECT id, vehiculo_id, started_at, ended_at, distancia_metros, velocidad_max_kmh,
            duracion_segundos, metodo, km_inicio, km_fin
     FROM viaje WHERE vehiculo_id = ? AND deleted = 0 ORDER BY started_at DESC LIMIT 20`,
    vehicleId,
  );
}

export async function saveTrip(
  db: SQLiteDatabase,
  trip: Omit<TripRecord, 'id' | 'vehiculo_id'> & { vehicleId: string },
) {
  if (!Number.isFinite(trip.distancia_metros) || trip.distancia_metros < 0) throw new Error('La distancia del viaje no es válida.');
  if (!Number.isSafeInteger(trip.duracion_segundos) || trip.duracion_segundos < 0) throw new Error('La duración del viaje no es válida.');
  if (!Number.isFinite(trip.velocidad_max_kmh) || trip.velocidad_max_kmh < 0 || trip.velocidad_max_kmh > 200) {
    throw new Error('La velocidad máxima no es válida.');
  }
  const id = Crypto.randomUUID();
  const updatedAt = new Date().toISOString();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO viaje (id, vehiculo_id, started_at, ended_at, distancia_metros,
        velocidad_max_kmh, duracion_segundos, metodo, km_inicio, km_fin, updated_at, deleted, pending)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
      id, trip.vehicleId, trip.started_at, trip.ended_at, Math.round(trip.distancia_metros),
      trip.velocidad_max_kmh, trip.duracion_segundos, trip.metodo, trip.km_inicio, trip.km_fin, updatedAt,
    );
    if (trip.metodo === 'manual' && trip.km_fin !== null) {
      await db.runAsync(
        `UPDATE vehiculo SET km_actual = CASE WHEN km_actual < ? THEN ? ELSE km_actual END,
          updated_at = ?, pending = 1 WHERE id = ? AND deleted = 0`,
        trip.km_fin, trip.km_fin, updatedAt, trip.vehicleId,
      );
    }
  });
  queueCloudSync(db);
  return id;
}
