import type { SQLiteDatabase } from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { queueCloudSync } from '@/services/cloud-sync';

export type Vehicle = {
  id: string;
  placa: string;
  alias: string;
  km_actual: number;
  updated_at: string;
};

const now = () => new Date().toISOString();
const normalizePlate = (plate: string) => plate.replace(/\s/g, '').toUpperCase();
const isValidPlate = (plate: string) => /^(?:[A-Z]{3}\d{3}|[A-Z]{3}\d{2}[A-Z])$/.test(plate);

export async function listVehicles(db: SQLiteDatabase) {
  return db.getAllAsync<Vehicle>(
    'SELECT id, placa, alias, km_actual, updated_at FROM vehiculo WHERE deleted = 0 ORDER BY alias COLLATE NOCASE',
  );
}

export async function getActiveVehicleId(db: SQLiteDatabase) {
  const row = await db.getFirstAsync<{ valor: string }>(
    "SELECT valor FROM configuracion WHERE clave = 'vehiculo_activo'",
  );
  return row?.valor ?? null;
}

export async function setActiveVehicle(db: SQLiteDatabase, id: string) {
  await db.runAsync(
    `INSERT INTO configuracion (clave, valor) VALUES ('vehiculo_activo', ?)
     ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor`,
    id,
  );
}

export async function saveVehicle(
  db: SQLiteDatabase,
  input: { id?: string; placa: string; alias: string; km_actual: number },
) {
  const placa = normalizePlate(input.placa);
  const alias = input.alias.trim();
  if (!isValidPlate(placa)) throw new Error('Escribe una placa válida, por ejemplo ABC123 o ABC12D.');
  if (!alias) throw new Error('Escribe un nombre para identificar el vehículo.');
  if (!Number.isSafeInteger(input.km_actual) || input.km_actual < 0) {
    throw new Error('El odómetro debe ser un número entero igual o mayor que cero.');
  }

  const existing = input.id
    ? await db.getFirstAsync<Pick<Vehicle, 'km_actual'>>(
        'SELECT km_actual FROM vehiculo WHERE id = ? AND deleted = 0', input.id,
      )
    : null;
  if (input.id && !existing) throw new Error('No encontramos ese vehículo. Actualiza la lista e inténtalo otra vez.');
  if (existing && input.km_actual < existing.km_actual) {
    throw new Error('El kilometraje no puede ser menor al último registrado.');
  }

  const duplicate = await db.getFirstAsync<{ id: string; deleted: number }>(
    'SELECT id, deleted FROM vehiculo WHERE placa = ? AND id != ?', placa, input.id ?? '',
  );
  if (duplicate && duplicate.deleted === 0) throw new Error('Ya tienes un vehículo registrado con esa placa.');
  if (duplicate?.deleted === 1 && input.id) {
    throw new Error('Esa placa pertenece a un vehículo eliminado. Agrégalo de nuevo desde el formulario de alta.');
  }

  const updatedAt = now();
  if (duplicate?.deleted === 1 && !input.id) {
    await db.runAsync(
      'UPDATE vehiculo SET alias = ?, km_actual = ?, deleted = 0, pending = 1, updated_at = ? WHERE id = ?',
      alias, input.km_actual, updatedAt, duplicate.id,
    );
    if (!(await getActiveVehicleId(db))) await setActiveVehicle(db, duplicate.id);
    queueCloudSync(db);
    return duplicate.id;
  }
  if (input.id) {
    await db.runAsync(
      'UPDATE vehiculo SET placa = ?, alias = ?, km_actual = ?, updated_at = ?, pending = 1 WHERE id = ?',
      placa, alias, input.km_actual, updatedAt, input.id,
    );
    queueCloudSync(db);
    return input.id;
  }

  const id = Crypto.randomUUID();
  await db.runAsync(
    `INSERT INTO vehiculo (id, placa, alias, km_actual, updated_at, deleted, pending)
     VALUES (?, ?, ?, ?, ?, 0, 1)`, id, placa, alias, input.km_actual, updatedAt,
  );
  if (!(await getActiveVehicleId(db))) await setActiveVehicle(db, id);
  queueCloudSync(db);
  return id;
}

export async function removeVehicle(db: SQLiteDatabase, id: string) {
  await db.runAsync('UPDATE vehiculo SET deleted = 1, pending = 1, updated_at = ? WHERE id = ?', now(), id);
  if ((await getActiveVehicleId(db)) === id) {
    await db.runAsync("DELETE FROM configuracion WHERE clave = 'vehiculo_activo'");
    const next = await db.getFirstAsync<{ id: string }>(
      'SELECT id FROM vehiculo WHERE deleted = 0 ORDER BY alias COLLATE NOCASE LIMIT 1',
    );
    if (next) await setActiveVehicle(db, next.id);
  }
  queueCloudSync(db);
}
