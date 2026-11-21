import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
export function GET() { return NextResponse.json({ ok: true, servicio: 'registro-de-vehiculo-api' }); }
