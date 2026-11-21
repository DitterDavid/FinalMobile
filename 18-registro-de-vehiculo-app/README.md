# App móvil · Registro de vehículo

Aplicación Expo SDK 58 + React Native + TypeScript + Expo Router. SQLite mantiene una copia local para funcionar sin conexión; al vincular una cuenta Firebase, los registros se sincronizan con la API desplegada en Vercel.

## Inicio

```bash
npx expo install
npx expo start
```

Para completar dependencias del alcance original:

```bash
npx expo install expo-sqlite expo-secure-store react-native-gesture-handler react-native-reanimated expo-location expo-camera expo-sensors expo-notifications expo-haptics expo-image-manipulator
```

## Funciones objetivo

- Vehículos, tanqueos y mantenimientos con persistencia local.
- Consumo km/L, costo/km, alertas a menos de 500 km.
- Viaje con ubicación en primer plano y entrada manual si no hay permiso/GPS.
- Fotos de facturas comprimidas antes de sincronizar.
- Gestos siempre acompañados por controles accesibles.
- Cuenta Firebase y sincronización de vehículos, tanqueos, mantenimientos y viajes.
- Exportación de la bitácora a CSV para Excel.

## Flujo disponible

La pestaña **Vehículos** permite registrar, editar, seleccionar y quitar vehículos. Valida placas colombianas (`ABC123` o `ABC12D`) y evita reducir el odómetro. El primer vehículo guardado queda seleccionado; al quitarlo se selecciona otro disponible automáticamente. El resumen muestra el vehículo activo. Los datos se guardan en SQLite y funcionan sin conexión.

La pestaña **Tanqueos** permite crear, editar y eliminar registros con fecha, odómetro, litros y valor pagado. Rechaza datos inválidos y kilometrajes que contradicen el historial; al guardar actualiza el odómetro del vehículo sin reducirlo. Calcula km/L entre tanqueos consecutivos y costo por km, tanto en la bitácora como en el resumen.

La pestaña **Mantenimiento** guarda servicios y kilometraje de próxima revisión. Muestra alertas cuando faltan menos de 500 km o si la revisión ya venció; el resumen también indica la alerta más cercana del vehículo activo.

Cada mantenimiento puede guardar una foto de factura desde la cámara o la galería. La imagen se reduce a un máximo de 1280 px de ancho, se comprime como JPEG y se conserva en la carpeta de documentos de la app para mostrarla en el historial.

La pantalla **Viaje** registra recorridos con ubicación en primer plano (`watchPositionAsync`), calcula distancia, velocidad máxima y duración, y descarta saltos por encima de 200 km/h o lecturas con precisión deficiente. Al salir de la pantalla pausa GPS; al volver se puede reanudar. El modo manual calcula distancia con odómetro inicial y final. Los últimos 20 viajes se guardan localmente.

En **Inicio → Cuenta y nube**, crea o inicia sesión con el mismo correo en cada dispositivo. La app sube los cambios pendientes y descarga los registros al conectarse; también sincroniza después de guardar y al volver a abrir la app. Los datos locales se conservan sin conexión. La cuenta sincronizada queda vinculada a esa instalación para no mezclar bitácoras de distintos usuarios. Las fotos de factura todavía no se copian a la nube.

En **Inicio → Exportar bitácora**, genera un CSV UTF-8 con separador compatible con Excel en español y abre la hoja del teléfono para compartirlo. Incluye tanqueos, mantenimientos y viajes de todos los vehículos activos; marca si hay una factura adjunta, pero no incluye la imagen.

## Conexión con Vercel y Firebase

1. Despliega `18-registro-de-vehiculo-api` como proyecto Next.js en Vercel. Si importas el repositorio contenedor, configura su directorio raíz en `18-registro-de-vehiculo-api`.
2. En Firebase, habilita Authentication con correo y contraseña, crea Firestore y genera una cuenta de servicio.
3. En Vercel → Settings → Environment Variables, configura `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` y `FIREBASE_WEB_API_KEY`. La clave privada es un secreto; configúrala en Vercel, nunca en el código móvil.
4. Copia la URL HTTPS desplegada de la API a `.env` en la app móvil: `EXPO_PUBLIC_API_URL=https://<tu-api>.vercel.app`.
5. Para instalar la app Android final, genera el paquete después de configurar esa URL; una URL local como `localhost` no sirve en otros teléfonos.

## Compilaciones Android con EAS

- Para instalar una versión de prueba directamente en un teléfono Android: `eas build --platform android --profile preview` (genera un APK de distribución interna).
- Para publicar en Google Play: `eas build --platform android --profile production` (genera un AAB).
- Los perfiles incluyen la URL pública de la API de producción. No requieren ni deben incluir las credenciales privadas de la cuenta de servicio Firebase.
- El identificador Android configurado es `com.ditterdavid.registrovehiculo`; debe mantenerse igual en futuras actualizaciones de esta app.

La ruta `/api/health` permite comprobar el despliegue. `/api/sync` requiere una sesión Firebase válida y almacena cada cuenta bajo su propio espacio de Firestore.

## Seguridad

`EXPO_PUBLIC_API_URL` es pública y queda dentro del APK. No colocar secretos, claves de servicio ni tokens persistentes en el código. Los tokens de sesión se guardan con `expo-secure-store`.
