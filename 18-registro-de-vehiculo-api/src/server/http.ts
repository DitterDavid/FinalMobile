import { NextResponse } from 'next/server';
import { adminAuth } from './firebase-admin';

export function errorResponse(error: unknown) {
  if (error instanceof Error && error.name === 'UnauthorizedError') return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  console.error('Error de API', error instanceof Error ? error.name : 'UnknownError');
  return NextResponse.json({ error: 'Error interno' }, { status: 500 });
}
export async function requireUser(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) { const e = new Error('Unauthorized'); e.name = 'UnauthorizedError'; throw e; }
  try { return await adminAuth().verifyIdToken(token); }
  catch { const e = new Error('Unauthorized'); e.name = 'UnauthorizedError'; throw e; }
}
