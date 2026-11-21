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
  if (!parsed.success) return NextResponse.json({ error: 'Datos inválidos', detalles: parsed.error.issues.map(i => ({ campo: String(i.path[0] ?? ''), mensaje: i.message })) }, { status: 400 });
  try {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${encodeURIComponent(key)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...parsed.data, returnSecureToken: true }) });
    const result = await response.json();
    if (!response.ok) {
      const code = result?.error?.message;
      const status = code === 'EMAIL_EXISTS' ? 409 : code === 'WEAK_PASSWORD' ? 400 : code === 'TOO_MANY_ATTEMPTS_TRY_LATER' ? 429 : 401;
      return NextResponse.json({ error: status === 409 ? 'El correo ya está registrado' : status === 400 ? 'Contraseña débil' : status === 429 ? 'Demasiados intentos' : 'No fue posible crear la cuenta' }, { status });
    }
    return NextResponse.json({ token: result.idToken, refreshToken: result.refreshToken, expiraEnSeg: Number(result.expiresIn), usuario: { id: result.localId, email: result.email } }, { status: 201 });
  } catch { return NextResponse.json({ error: 'Error interno' }, { status: 500 }); }
}
