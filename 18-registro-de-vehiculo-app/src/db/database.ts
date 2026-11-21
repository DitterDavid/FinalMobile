import type { SQLiteDatabase } from 'expo-sqlite';

export async function initializeDatabase(db: SQLiteDatabase) {
  await db.execAsync(`PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS vehiculo (
      id TEXT PRIMARY KEY NOT NULL, placa TEXT NOT NULL UNIQUE, alias TEXT NOT NULL,
      km_actual INTEGER NOT NULL DEFAULT 0 CHECK (km_actual >= 0), remote_id TEXT,
      updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS tanqueo (
      id TEXT PRIMARY KEY NOT NULL, vehiculo_id TEXT NOT NULL REFERENCES vehiculo(id),
      fecha TEXT NOT NULL, km INTEGER NOT NULL CHECK (km >= 0), litros REAL NOT NULL CHECK (litros > 0),
      total_centavos INTEGER NOT NULL CHECK (total_centavos > 0), remote_id TEXT,
      updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS mantenimiento (
      id TEXT PRIMARY KEY NOT NULL, vehiculo_id TEXT NOT NULL REFERENCES vehiculo(id), tipo TEXT NOT NULL,
      fecha TEXT NOT NULL, km INTEGER NOT NULL CHECK (km >= 0), proximo_km INTEGER, foto_uri TEXT,
      remote_id TEXT, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS viaje (
      id TEXT PRIMARY KEY NOT NULL, vehiculo_id TEXT NOT NULL REFERENCES vehiculo(id),
      started_at TEXT NOT NULL, ended_at TEXT NOT NULL, distancia_metros INTEGER NOT NULL CHECK (distancia_metros >= 0),
      velocidad_max_kmh REAL NOT NULL DEFAULT 0, duracion_segundos INTEGER NOT NULL CHECK (duracion_segundos >= 0),
      metodo TEXT NOT NULL CHECK (metodo IN ('gps', 'manual')), km_inicio INTEGER, km_fin INTEGER,
      remote_id TEXT, updated_at TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS configuracion (
      clave TEXT PRIMARY KEY NOT NULL, valor TEXT NOT NULL
    );`);
  const maintenanceColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(mantenimiento)');
  if (!maintenanceColumns.some(column => column.name === 'proxima_fecha')) {
    await db.execAsync('ALTER TABLE mantenimiento ADD COLUMN proxima_fecha TEXT');
  }
}
