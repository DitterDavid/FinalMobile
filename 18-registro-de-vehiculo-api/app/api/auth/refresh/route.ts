import { NextResponse } from 'next/server';
import { z } from 'zod';
export const runtime = 'nodejs';
const schema = z.object({ refreshToken: z.string().min(1) }).strict();
export async function POST(request: Request) {
  const key = process.env.FIREBASE_WEB_API_KEY;
  if (!key) return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
  try {
    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: parsed.data.refreshToken }) });
    const result = await response.json();
    if (!response.ok) return NextResponse.json({ error: 'Sesión vencida' }, { status: 401 });
    return NextResponse.json({ token: result.id_token, refreshToken: result.refresh_token, expiraEnSeg: Number(result.expires_in) });
  } catch { return NextResponse.json({ error: 'Error interno' }, { status: 500 }); }
}
