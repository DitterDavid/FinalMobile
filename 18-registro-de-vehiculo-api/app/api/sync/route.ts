import { NextResponse } from 'next/server';
import { z } from 'zod';
import { firestore } from '@/server/firebase-admin';
import { errorResponse, requireUser } from '@/server/http';

export const runtime = 'nodejs';

const stamp = z.string().datetime();
const identity = { id: z.string().uuid(), updated_at: stamp, deleted: z.number().int().min(0).max(1) };
const vehicleSchema = z.object({ ...identity, placa: z.string().min(1).max(8), alias: z.string().min(1).max(40), km_actual: z.number().int().nonnegative() }).strict();
const refuelSchema = z.object({ ...identity, vehiculo_id: z.string().uuid(), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), km: z.number().int().nonnegative(), litros: z.number().positive(), total_centavos: z.number().int().positive() }).strict();
const maintenanceSchema = z.object({ ...identity, vehiculo_id: z.string().uuid(), tipo: z.string().min(1).max(80), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), km: z.number().int().nonnegative(), proximo_km: z.number().int().nonnegative().nullable(), proxima_fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), factura_adjunta: z.boolean() }).strict();
const tripSchema = z.object({ ...identity, vehiculo_id: z.string().uuid(), started_at: z.string().datetime(), ended_at: z.string().datetime(), distancia_metros: z.number().int().nonnegative(), velocidad_max_kmh: z.number().nonnegative().max(200), duracion_segundos: z.number().int().nonnegative(), metodo: z.enum(['gps', 'manual']), km_inicio: z.number().int().nonnegative().nullable(), km_fin: z.number().int().nonnegative().nullable() }).strict();
const syncSchema = z.object({
  changes: z.object({
    vehiculos: z.array(vehicleSchema).max(500),
    tanqueos: z.array(refuelSchema).max(500),
    mantenimientos: z.array(maintenanceSchema).max(500),
    viajes: z.array(tripSchema).max(500),
  }).strict(),
}).strict();

type CollectionName = 'vehiculos' | 'tanqueos' | 'mantenimientos' | 'viajes';

async function mergeChanges(uid: string, collection: CollectionName, records: Array<{ id: string; updated_at: string; [key: string]: unknown }>) {
  const db = firestore();
  const processed: string[] = [];
  for (const record of records) {
    const reference = db.collection('usuarios').doc(uid).collection(collection).doc(record.id);
    await db.runTransaction(async transaction => {
      const current = await transaction.get(reference);
      const previous = current.data();
      if (!previous || String(previous.updated_at ?? '') <= record.updated_at) {
        transaction.set(reference, { ...record, owner_uid: uid });
      }
    });
    processed.push(record.id);
  }
  return processed;
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const db = firestore();
    const names: CollectionName[] = ['vehiculos', 'tanqueos', 'mantenimientos', 'viajes'];
    const entries = await Promise.all(names.map(async name => {
      const snapshot = await db.collection('usuarios').doc(user.uid).collection(name).get();
      return [name, snapshot.docs.map(document => {
        const { owner_uid: _owner, ...record } = document.data();
        return { ...record, id: document.id };
      })] as const;
    }));
    return NextResponse.json({ registros: Object.fromEntries(entries) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 }); }
    const parsed = syncSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Registros inválidos', detalles: parsed.error.issues.map(issue => ({ campo: issue.path.join('.'), mensaje: issue.message })) }, { status: 400 });
    const { changes } = parsed.data;
    const [vehiculos, tanqueos, mantenimientos, viajes] = await Promise.all([
      mergeChanges(user.uid, 'vehiculos', changes.vehiculos),
      mergeChanges(user.uid, 'tanqueos', changes.tanqueos),
      mergeChanges(user.uid, 'mantenimientos', changes.mantenimientos),
      mergeChanges(user.uid, 'viajes', changes.viajes),
    ]);
    return NextResponse.json({ procesados: { vehiculos, tanqueos, mantenimientos, viajes } });
  } catch (error) { return errorResponse(error); }
}
