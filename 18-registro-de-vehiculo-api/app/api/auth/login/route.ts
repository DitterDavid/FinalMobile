import { NextResponse } from 'next/server';
import { z } from 'zod';
export const runtime = 'nodejs';
const schema = z.object({ email: z.email(), password: z.string().min(8) }).strict();
export async function POST(request: Request) {
  const key = process.env.FIREBASE_WEB_API_KEY;
  if (!key) return NextResponse.json({ error: 'Error interno' }, { status: 500 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Cuerpo JSON inválido' }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...parsed.data, returnSecureToken: true }) });
    const result = await response.json();
    if (!response.ok) return NextResponse.json({ error: result?.error?.message === 'TOO_MANY_ATTEMPTS_TRY_LATER' ? 'Demasiados intentos' : 'Correo o contraseña inválidos' }, { status: result?.error?.message === 'TOO_MANY_ATTEMPTS_TRY_LATER' ? 429 : 401 });
    return NextResponse.json({ token: result.idToken, refreshToken: result.refreshToken, expiraEnSeg: Number(result.expiresIn), usuario: { id: result.localId, email: result.email } });
  } catch { return NextResponse.json({ error: 'Error interno' }, { status: 500 }); }
}
