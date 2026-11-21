import type { SQLiteDatabase } from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { queueCloudSync } from '@/services/cloud-sync';

export type RefuelRecord = {
  id: string;
  vehiculo_id: string;
  fecha: string;
  km: number;
  litros: number;
  total_centavos: number;
  updated_at: string;
};

const now = () => new Date().toISOString();

export async function listRefuels(db: SQLiteDatabase, vehicleId: string) {
  return db.getAllAsync<RefuelRecord>(
    `SELECT id, vehiculo_id, fecha, km, litros, total_centavos, updated_at
     FROM tanqueo WHERE vehiculo_id = ? AND deleted = 0
     ORDER BY fecha, km, updated_at`,
    vehicleId,
  );
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export async function saveRefuel(
  db: SQLiteDatabase,
  input: { id?: string; vehicleId: string; fecha: string; km: number; litros: number; total_centavos: number },
) {
  if (!validDate(input.fecha)) throw new Error('Ingresa una fecha válida.');
  if (!Number.isSafeInteger(input.km) || input.km < 0) throw new Error('El odómetro debe ser un número entero igual o mayor que cero.');
  if (!Number.isFinite(input.litros) || input.litros <= 0) throw new Error('Los litros deben ser mayores que cero.');
  if (!Number.isSafeInteger(input.total_centavos) || input.total_centavos <= 0) throw new Error('El total debe ser mayor que cero.');

  const vehicle = await db.getFirstAsync<{ km_actual: number }>(
    'SELECT km_actual FROM vehiculo WHERE id = ? AND deleted = 0', input.vehicleId,
  );
  if (!vehicle) throw new Error('No hay un vehículo activo. Registra o selecciona uno primero.');

  const current = input.id
    ? await db.getFirstAsync<{ id: string }>(
        'SELECT id FROM tanqueo WHERE id = ? AND vehiculo_id = ? AND deleted = 0', input.id, input.vehicleId,
      )
    : null;
  if (input.id && !current) throw new Error('No encontramos ese tanqueo. Actualiza la lista e inténtalo otra vez.');
  if (!input.id && input.km < vehicle.km_actual) {
    throw new Error(`El odómetro no puede ser menor al último registrado (${vehicle.km_actual.toLocaleString('es-CO')} km).`);
  }

  const otherRefuels = await db.getAllAsync<{ fecha: string; km: number }>(
    'SELECT fecha, km FROM tanqueo WHERE vehiculo_id = ? AND deleted = 0 AND id != ?',
    input.vehicleId, input.id ?? '',
  );
  if (otherRefuels.some(item => item.fecha < input.fecha && item.km > input.km)) {
    throw new Error('El odómetro es menor que el de un tanqueo anterior.');
  }
  if (otherRefuels.some(item => item.fecha > input.fecha && item.km < input.km)) {
    throw new Error('El odómetro supera el de un tanqueo posterior.');
  }

  const timestamp = now();
  if (input.id) {
    await db.runAsync(
      `UPDATE tanqueo SET fecha = ?, km = ?, litros = ?, total_centavos = ?, updated_at = ?, pending = 1
       WHERE id = ? AND vehiculo_id = ?`,
      input.fecha, input.km, input.litros, input.total_centavos, timestamp, input.id, input.vehicleId,
    );
    if (input.km > vehicle.km_actual) {
      await db.runAsync('UPDATE vehiculo SET km_actual = ?, updated_at = ?, pending = 1 WHERE id = ?', input.km, timestamp, input.vehicleId);
    }
    queueCloudSync(db);
    return input.id;
  }

  const id = Crypto.randomUUID();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO tanqueo (id, vehiculo_id, fecha, km, litros, total_centavos, updated_at, deleted, pending)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1)`,
      id, input.vehicleId, input.fecha, input.km, input.litros, input.total_centavos, timestamp,
    );
    if (input.km > vehicle.km_actual) {
      await db.runAsync('UPDATE vehiculo SET km_actual = ?, updated_at = ?, pending = 1 WHERE id = ?', input.km, timestamp, input.vehicleId);
    }
  });
  queueCloudSync(db);
  return id;
}

export async function removeRefuel(db: SQLiteDatabase, id: string, vehicleId: string) {
  await db.runAsync(
    'UPDATE tanqueo SET deleted = 1, pending = 1, updated_at = ? WHERE id = ? AND vehiculo_id = ? AND deleted = 0',
    now(), id, vehicleId,
  );
  queueCloudSync(db);
}
