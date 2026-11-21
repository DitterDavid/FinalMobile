import type { SQLiteDatabase } from 'expo-sqlite';
import { cloudRequest, getCloudSession } from '@/services/cloud-auth';

type SyncBucket = 'vehiculos' | 'tanqueos' | 'mantenimientos' | 'viajes';
type PendingChanges = Record<SyncBucket, Array<Record<string, unknown>>>;
type CloudSnapshot = { registros: Record<SyncBucket, Array<Record<string, any>>> };

const buckets: SyncBucket[] = ['vehiculos', 'tanqueos', 'mantenimientos', 'viajes'];

export async function bindLocalDataToAccount(db: SQLiteDatabase, uid: string) {
  const current = await db.getFirstAsync<{ valor: string }>("SELECT valor FROM configuracion WHERE clave = 'sync_owner_uid'");
  if (current && current.valor !== uid) {
    throw new Error('Esta instalación ya está vinculada a otra cuenta. Para proteger los datos locales, no se sincronizaron con esta cuenta.');
  }
  if (!current) await db.runAsync("INSERT INTO configuracion (clave, valor) VALUES ('sync_owner_uid', ?)", uid);
}

async function getPendingChanges(db: SQLiteDatabase): Promise<PendingChanges> {
  const [vehiculos, tanqueos, mantenimientos, viajes] = await Promise.all([
    db.getAllAsync<Record<string, unknown>>('SELECT id, placa, alias, km_actual, updated_at, deleted FROM vehiculo WHERE pending = 1'),
    db.getAllAsync<Record<string, unknown>>('SELECT id, vehiculo_id, fecha, km, litros, total_centavos, updated_at, deleted FROM tanqueo WHERE pending = 1'),
    db.getAllAsync<Record<string, any>>('SELECT id, vehiculo_id, tipo, fecha, km, proximo_km, proxima_fecha, foto_uri, updated_at, deleted FROM mantenimiento WHERE pending = 1'),
    db.getAllAsync<Record<string, unknown>>('SELECT id, vehiculo_id, started_at, ended_at, distancia_metros, velocidad_max_kmh, duracion_segundos, metodo, km_inicio, km_fin, updated_at, deleted FROM viaje WHERE pending = 1'),
  ]);
  return {
    vehiculos,
    tanqueos,
    mantenimientos: mantenimientos.map(({ foto_uri, ...item }) => ({ ...item, factura_adjunta: Boolean(foto_uri) })),
    viajes,
  };
}

async function clearProcessedFlags(db: SQLiteDatabase, processed: Record<SyncBucket, string[]>) {
  for (const bucket of buckets) {
    const table = bucket === 'vehiculos' ? 'vehiculo' : bucket === 'tanqueos' ? 'tanqueo' : bucket === 'mantenimientos' ? 'mantenimiento' : 'viaje';
    for (const id of processed[bucket] ?? []) await db.runAsync(`UPDATE ${table} SET pending = 0 WHERE id = ?`, id);
  }
}

async function applySnapshot(db: SQLiteDatabase, snapshot: CloudSnapshot) {
  await db.withTransactionAsync(async () => {
    for (const item of snapshot.registros.vehiculos ?? []) {
      await db.runAsync(`INSERT INTO vehiculo (id, placa, alias, km_actual, remote_id, updated_at, deleted, pending)
        VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET placa=excluded.placa, alias=excluded.alias, km_actual=excluded.km_actual,
          remote_id=excluded.remote_id, updated_at=excluded.updated_at, deleted=excluded.deleted, pending=0
        WHERE excluded.updated_at > vehiculo.updated_at AND vehiculo.pending=0`,
      item.id, item.placa, item.alias, item.km_actual, item.id, item.updated_at, item.deleted);
    }
    for (const item of snapshot.registros.tanqueos ?? []) {
      await db.runAsync(`INSERT INTO tanqueo (id, vehiculo_id, fecha, km, litros, total_centavos, remote_id, updated_at, deleted, pending)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET vehiculo_id=excluded.vehiculo_id, fecha=excluded.fecha, km=excluded.km,
          litros=excluded.litros, total_centavos=excluded.total_centavos, remote_id=excluded.remote_id,
          updated_at=excluded.updated_at, deleted=excluded.deleted, pending=0
        WHERE excluded.updated_at > tanqueo.updated_at AND tanqueo.pending=0`,
      item.id, item.vehiculo_id, item.fecha, item.km, item.litros, item.total_centavos, item.id, item.updated_at, item.deleted);
    }
    for (const item of snapshot.registros.mantenimientos ?? []) {
      const local = await db.getFirstAsync<{ foto_uri: string | null }>('SELECT foto_uri FROM mantenimiento WHERE id = ?', item.id);
      const photo = item.factura_adjunta ? local?.foto_uri ?? null : null;
      await db.runAsync(`INSERT INTO mantenimiento (id, vehiculo_id, tipo, fecha, km, proximo_km, proxima_fecha, foto_uri, remote_id, updated_at, deleted, pending)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET vehiculo_id=excluded.vehiculo_id, tipo=excluded.tipo, fecha=excluded.fecha,
          km=excluded.km, proximo_km=excluded.proximo_km, proxima_fecha=excluded.proxima_fecha, foto_uri=excluded.foto_uri,
          remote_id=excluded.remote_id, updated_at=excluded.updated_at, deleted=excluded.deleted, pending=0
        WHERE excluded.updated_at > mantenimiento.updated_at AND mantenimiento.pending=0`,
      item.id, item.vehiculo_id, item.tipo, item.fecha, item.km, item.proximo_km, item.proxima_fecha ?? null, photo, item.id, item.updated_at, item.deleted);
    }
    for (const item of snapshot.registros.viajes ?? []) {
      await db.runAsync(`INSERT INTO viaje (id, vehiculo_id, started_at, ended_at, distancia_metros, velocidad_max_kmh, duracion_segundos, metodo, km_inicio, km_fin, remote_id, updated_at, deleted, pending)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET vehiculo_id=excluded.vehiculo_id, started_at=excluded.started_at,
          ended_at=excluded.ended_at, distancia_metros=excluded.distancia_metros, velocidad_max_kmh=excluded.velocidad_max_kmh,
          duracion_segundos=excluded.duracion_segundos, metodo=excluded.metodo, km_inicio=excluded.km_inicio,
          km_fin=excluded.km_fin, remote_id=excluded.remote_id, updated_at=excluded.updated_at,
          deleted=excluded.deleted, pending=0
        WHERE excluded.updated_at > viaje.updated_at AND viaje.pending=0`,
      item.id, item.vehiculo_id, item.started_at, item.ended_at, item.distancia_metros, item.velocidad_max_kmh,
      item.duracion_segundos, item.metodo, item.km_inicio ?? null, item.km_fin ?? null, item.id, item.updated_at, item.deleted);
    }
  });
  const active = await db.getFirstAsync<{ valor: string }>("SELECT valor FROM configuracion WHERE clave = 'vehiculo_activo'");
  if (!active) {
    const first = await db.getFirstAsync<{ id: string }>('SELECT id FROM vehiculo WHERE deleted = 0 ORDER BY alias COLLATE NOCASE LIMIT 1');
    if (first) await db.runAsync("INSERT INTO configuracion (clave, valor) VALUES ('vehiculo_activo', ?)", first.id);
  }
}

let running: Promise<{ enviados: number; recibidos: number }> | null = null;
let debounce: ReturnType<typeof setTimeout> | null = null;

export function queueCloudSync(db: SQLiteDatabase) {
  if (debounce) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void syncLocalDatabase(db).catch(() => undefined);
  }, 2500);
}

export function syncLocalDatabase(db: SQLiteDatabase) {
  if (running) return running;
  running = (async () => {
    const session = await getCloudSession();
    if (!session) throw new Error('Inicia sesión para sincronizar la bitácora.');
    const binding = await db.getFirstAsync<{ valor: string }>("SELECT valor FROM configuracion WHERE clave = 'sync_owner_uid'");
    if (binding?.valor !== session.uid) throw new Error('La cuenta no coincide con la cuenta vinculada a estos datos locales.');
    const changes = await getPendingChanges(db);
    const enviados = Object.values(changes).reduce((sum, records) => sum + records.length, 0);
    if (enviados) {
      const result = await cloudRequest<{ procesados: Record<SyncBucket, string[]> }>('/api/sync', { method: 'POST', body: JSON.stringify({ changes }) });
      await clearProcessedFlags(db, result.procesados);
    }
    const snapshot = await cloudRequest<CloudSnapshot>('/api/sync');
    await applySnapshot(db, snapshot);
    await db.runAsync("INSERT INTO configuracion (clave, valor) VALUES ('ultima_sincronizacion', ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor", new Date().toISOString());
    const recibidos = Object.values(snapshot.registros ?? {}).reduce((sum, records) => sum + records.length, 0);
    return { enviados, recibidos };
  })().finally(() => { running = null; });
  return running;
}
