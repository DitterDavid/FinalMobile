import * as SecureStore from 'expo-secure-store';

const sessionKey = 'registro_vehiculo_sesion';

export type CloudSession = {
  uid: string;
  email: string;
  token: string;
  refreshToken: string;
  expiresAt: number;
};

type TokenResponse = { token: string; refreshToken: string; expiraEnSeg: number; usuario?: { id: string; email: string } };

function apiUrl() {
  const value = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/$/, '');
  if (!value || value.includes('tu-api.vercel.app')) throw new Error('Configura EXPO_PUBLIC_API_URL con la dirección HTTPS de la API en Vercel.');
  if (!/^https:\/\//i.test(value)) throw new Error('La API debe tener una dirección HTTPS para conectarse desde el teléfono.');
  return value;
}

function tokenExpiry(seconds: number) { return Date.now() + seconds * 1000; }

export async function getCloudSession() {
  const value = await SecureStore.getItemAsync(sessionKey);
  if (!value) return null;
  try { return JSON.parse(value) as CloudSession; }
  catch { await SecureStore.deleteItemAsync(sessionKey); return null; }
}

export async function saveCloudSession(session: CloudSession) {
  await SecureStore.setItemAsync(sessionKey, JSON.stringify(session));
}

async function publicRequest(path: string, body: unknown) {
  let response: Response;
  try {
    response = await fetch(`${apiUrl()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch { throw new Error('No se pudo conectar con la API. Revisa internet y la dirección de Vercel.'); }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'No fue posible completar la solicitud.');
  return result as TokenResponse;
}

export async function signInOrRegister(path: '/api/auth/login' | '/api/auth/registro', email: string, password: string) {
  const result = await publicRequest(path, { email: email.trim().toLowerCase(), password });
  if (!result.usuario?.id || !result.usuario.email || !result.token || !result.refreshToken) throw new Error('La API devolvió una sesión incompleta.');
  const session: CloudSession = { uid: result.usuario.id, email: result.usuario.email, token: result.token, refreshToken: result.refreshToken, expiresAt: tokenExpiry(Number(result.expiraEnSeg)) };
  return session;
}

export async function signOutCloud() { await SecureStore.deleteItemAsync(sessionKey); }

async function refreshSession(session: CloudSession) {
  const result = await publicRequest('/api/auth/refresh', { refreshToken: session.refreshToken });
  const updated = { ...session, token: result.token, refreshToken: result.refreshToken, expiresAt: tokenExpiry(Number(result.expiraEnSeg)) };
  await saveCloudSession(updated);
  return updated;
}

export async function cloudRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  let session = await getCloudSession();
  if (!session) throw new Error('Inicia sesión para sincronizar la bitácora.');
  if (session.expiresAt <= Date.now() + 60_000) session = await refreshSession(session);
  const send = (token: string) => fetch(`${apiUrl()}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'content-type': 'application/json' } : {}), ...options.headers, authorization: `Bearer ${token}` },
  });
  let response: Response;
  try { response = await send(session.token); }
  catch { throw new Error('No se pudo conectar con la API. La bitácora local sigue disponible.'); }
  if (response.status === 401) {
    session = await refreshSession(session);
    try { response = await send(session.token); }
    catch { throw new Error('No se pudo conectar con la API. La bitácora local sigue disponible.'); }
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'No se pudo sincronizar la bitácora.');
  return result as T;
}
