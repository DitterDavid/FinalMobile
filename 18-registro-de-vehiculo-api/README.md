# API · Registro de vehículo

API Next.js (Route Handlers, runtime Node) para autenticación Firebase mediada por servidor, Firestore y Vercel Blob.

## Desarrollo

```bash
npm install
npm run dev
```

Configure estas variables en `.env.local` para desarrollo o en Vercel → Project Settings → Environment Variables:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (con `\\n` literales)
- `FIREBASE_WEB_API_KEY`

Habilite Authentication → Email/Password en Firebase y cree la base Firestore. Los registros se guardan en `usuarios/{uid}/{vehiculos|tanqueos|mantenimientos|viajes}`. `GET` y `POST /api/sync` requieren `Authorization: Bearer <Firebase ID token>`; el servidor verifica el token y limita cada consulta a la cuenta autenticada.

Vercel detecta Next.js automáticamente. Si el repositorio contiene también la app móvil, seleccione `18-registro-de-vehiculo-api` como Root Directory del proyecto Vercel. La app Android solo necesita la URL pública HTTPS de esta API mediante `EXPO_PUBLIC_API_URL`; las claves privadas permanecen en Vercel.

Solo `GET /api/health` funciona sin configurar Firebase. Las fotos de factura todavía no se sincronizan.
