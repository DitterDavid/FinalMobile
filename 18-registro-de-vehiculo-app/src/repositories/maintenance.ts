import type { SQLiteDatabase } from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { removeInvoiceImage } from '@/services/invoice-images';
import { queueCloudSync } from '@/services/cloud-sync';

export type MaintenanceRecord = {
  id: string;
  vehiculo_id: string;
  tipo: string;
  fecha: string;
  km: number;
  proximo_km: number | null;
  proxima_fecha: string | null;
  foto_uri: string | null;
  updated_at: string;
};

const now = () => new Date().toISOString();

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export async function listMaintenance(db: SQLiteDatabase, vehicleId: string) {
  return db.getAllAsync<MaintenanceRecord>(
    `SELECT id, vehiculo_id, tipo, fecha, km, proximo_km, proxima_fecha, foto_uri, updated_at
     FROM mantenimiento WHERE vehiculo_id = ? AND deleted = 0
     ORDER BY fecha DESC, km DESC, updated_at DESC`,
    vehicleId,
  );
}

export async function saveMaintenance(
  db: SQLiteDatabase,
  input: { id?: string; vehicleId: string; tipo: string; fecha: string; km: number; proximo_km: number | null; proxima_fecha: string | null; foto_uri: string | null },
) {
  const tipo = input.tipo.trim();
  if (!tipo) throw new Error('Escribe el tipo de mantenimiento.');
  if (tipo.length > 80) throw new Error('El tipo de mantenimiento debe tener máximo 80 caracteres.');
  if (!validDate(input.fecha)) throw new Error('Ingresa una fecha válida.');
  if (input.proxima_fecha !== null && !validDate(input.proxima_fecha)) throw new Error('Ingresa una fecha válida para la próxima revisión.');
  if (!Number.isSafeInteger(input.km) || input.km < 0) throw new Error('El odómetro debe ser un número entero igual o mayor que cero.');
  if (input.proximo_km !== null && (!Number.isSafeInteger(input.proximo_km) || input.proximo_km < input.km)) {
    throw new Error('El próximo kilometraje debe ser igual o mayor que el del mantenimiento.');
  }

  const vehicle = await db.getFirstAsync<{ km_actual: number }>(
    'SELECT km_actual FROM vehiculo WHERE id = ? AND deleted = 0', input.vehicleId,
  );
  if (!vehicle) throw new Error('No hay un vehículo activo. Registra o selecciona uno primero.');
  const current = input.id
    ? await db.getFirstAsync<{ id: string; foto_uri: string | null }>(
        'SELECT id, foto_uri FROM mantenimiento WHERE id = ? AND vehiculo_id = ? AND deleted = 0', input.id, input.vehicleId,
      )
    : null;
  if (input.id && !current) throw new Error('No encontramos ese mantenimiento. Actualiza la lista e inténtalo otra vez.');

  const neighbors = await db.getAllAsync<{ fecha: string; km: number }>(
    'SELECT fecha, km FROM mantenimiento WHERE vehiculo_id = ? AND deleted = 0 AND id != ?', input.vehicleId, input.id ?? '',
  );
  if (neighbors.some(item => item.fecha < input.fecha && item.km > input.km)) {
    throw new Error('El odómetro es menor que el de un mantenimiento anterior.');
  }
  if (neighbors.some(item => item.fecha > input.fecha && item.km < input.km)) {
    throw new Error('El odómetro supera el de un mantenimiento posterior.');
  }

  const timestamp = now();
  if (input.id) {
    await db.runAsync(
      `UPDATE mantenimiento SET tipo = ?, fecha = ?, km = ?, proximo_km = ?, proxima_fecha = ?, foto_uri = ?, updated_at = ?, pending = 1
       WHERE id = ? AND vehiculo_id = ?`,
      tipo, input.fecha, input.km, input.proximo_km, input.proxima_fecha, input.foto_uri, timestamp, input.id, input.vehicleId,
    );
    if (current?.foto_uri && current.foto_uri !== input.foto_uri) removeInvoiceImage(current.foto_uri);
    if (input.km > vehicle.km_actual) {
      await db.runAsync('UPDATE vehiculo SET km_actual = ?, updated_at = ?, pending = 1 WHERE id = ?', input.km, timestamp, input.vehicleId);
    }
    queueCloudSync(db);
    return input.id;
  }

  const id = Crypto.randomUUID();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO mantenimiento (id, vehiculo_id, tipo, fecha, km, proximo_km, proxima_fecha, foto_uri, updated_at, deleted, pending)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 1)`,
      id, input.vehicleId, tipo, input.fecha, input.km, input.proximo_km, input.proxima_fecha, input.foto_uri, timestamp,
    );
    if (input.km > vehicle.km_actual) {
      await db.runAsync('UPDATE vehiculo SET km_actual = ?, updated_at = ?, pending = 1 WHERE id = ?', input.km, timestamp, input.vehicleId);
    }
  });
  queueCloudSync(db);
  return id;
}

export async function removeMaintenance(db: SQLiteDatabase, id: string, vehicleId: string) {
  const row = await db.getFirstAsync<{ foto_uri: string | null }>(
    'SELECT foto_uri FROM mantenimiento WHERE id = ? AND vehiculo_id = ? AND deleted = 0', id, vehicleId,
  );
  await db.runAsync(
    'UPDATE mantenimiento SET deleted = 1, pending = 1, updated_at = ? WHERE id = ? AND vehiculo_id = ? AND deleted = 0',
    now(), id, vehicleId,
  );
  if (row?.foto_uri) removeInvoiceImage(row.foto_uri);
  queueCloudSync(db);
}

export function kmUntilService(item: Pick<MaintenanceRecord, 'proximo_km'>, currentKm: number) {
  return item.proximo_km === null ? null : item.proximo_km - currentKm;
}
