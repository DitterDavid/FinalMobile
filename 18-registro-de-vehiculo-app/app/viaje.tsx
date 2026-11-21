import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as Location from 'expo-location';
import { getActiveVehicleId, listVehicles, type Vehicle } from '@/repositories/vehicles';
import { listTrips, saveTrip, type TripRecord } from '@/repositories/trips';
import { calculateGpsSegment, formatDuration, type GpsPoint } from '@/services/trip-metrics';

type Mode = 'gps' | 'manual';
type Session = {
  vehicleId: string;
  mode: Mode;
  startedAtMs: number;
  resumedAtMs: number;
  elapsedBeforeResumeMs: number;
  paused: boolean;
  startKm: number | null;
  distanceMeters: number;
  maxSpeedKmh: number;
  currentSpeedKmh: number;
  lastPoint: GpsPoint | null;
};

const metersToKilometers = (meters: number) => (meters / 1000).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateText = (value: string) => new Date(value).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });

export default function Trip() {
  const db = useSQLiteContext();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [trips, setTrips] = useState<TripRecord[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [status, setStatus] = useState('Elige GPS o modo manual para registrar un viaje.');
  const [error, setError] = useState('');
  const [distanceMeters, setDistanceMeters] = useState(0);
  const [maxSpeedKmh, setMaxSpeedKmh] = useState(0);
  const [currentSpeedKmh, setCurrentSpeedKmh] = useState(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [manualStartKm, setManualStartKm] = useState('');
  const [manualEndKm, setManualEndKm] = useState('');
  const sessionRef = useRef<Session | null>(null);
  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    const activeId = await getActiveVehicleId(db);
    const vehicles = await listVehicles(db);
    const activeVehicle = vehicles.find(item => item.id === activeId) ?? null;
    setVehicle(activeVehicle);
    setManualStartKm(String(activeVehicle?.km_actual ?? ''));
    setTrips(activeVehicle ? await listTrips(db, activeVehicle.id) : []);
  }, [db]);
  useFocusEffect(useCallback(() => {
    void refresh();
    const session = sessionRef.current;
    if (session?.paused && session.mode === 'manual') {
      startClock(session);
      setStatus('Viaje manual activo de nuevo.');
    } else if (session?.paused) {
      setStatus('El GPS se pausó al salir de esta pantalla. Puedes reanudarlo o guardar el tramo registrado.');
    }
    return () => pauseSession();
  }, [refresh]));

  useEffect(() => () => {
    pauseSession();
  }, []);

  function startClock(session: Session) {
    if (timerRef.current) clearInterval(timerRef.current);
    session.resumedAtMs = Date.now();
    session.paused = false;
    timerRef.current = setInterval(() => {
      setElapsedSeconds(Math.floor((session.elapsedBeforeResumeMs + Date.now() - session.resumedAtMs) / 1000));
    }, 1000);
  }

  function pauseSession() {
    const session = sessionRef.current;
    if (session && !session.paused) {
      session.elapsedBeforeResumeMs += Date.now() - session.resumedAtMs;
      session.paused = true;
      setElapsedSeconds(Math.floor(session.elapsedBeforeResumeMs / 1000));
    }
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }

  function beginSession(nextMode: Mode, startKm: number | null, firstPoint: GpsPoint | null = null) {
    if (!vehicle) return;
    const session: Session = {
      vehicleId: vehicle.id, mode: nextMode, startedAtMs: Date.now(), resumedAtMs: Date.now(), elapsedBeforeResumeMs: 0, paused: false, startKm,
      distanceMeters: 0, maxSpeedKmh: 0, currentSpeedKmh: 0, lastPoint: firstPoint,
    };
    sessionRef.current = session;
    setMode(nextMode); setDistanceMeters(0); setMaxSpeedKmh(0); setCurrentSpeedKmh(0); setElapsedSeconds(0); setError('');
    setStatus(nextMode === 'gps' ? 'Viaje GPS activo. Mantén esta pantalla abierta mientras conduces.' : 'Viaje manual activo. Al terminar, ingresa el odómetro final.');
    startClock(session);
  }

  function onLocation(location: Location.LocationObject) {
    const session = sessionRef.current;
    if (!session || session.mode !== 'gps') return;
    const point: GpsPoint = {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      timestamp: location.timestamp,
      speedMps: location.coords.speed,
      accuracy: location.coords.accuracy,
    };
    const result = calculateGpsSegment(session.lastPoint, point);
    if (!result.accepted) return;
    session.lastPoint = point;
    session.distanceMeters += result.distanceMeters;
    session.currentSpeedKmh = result.speedKmh;
    session.maxSpeedKmh = Math.max(session.maxSpeedKmh, result.speedKmh);
    setDistanceMeters(session.distanceMeters);
    setCurrentSpeedKmh(result.speedKmh);
    setMaxSpeedKmh(session.maxSpeedKmh);
  }

  function requestLocationAndStart() {
    Alert.alert(
      'Ubicación durante el viaje',
      'Usaremos el GPS mientras esta pantalla esté abierta para calcular la distancia y la velocidad. No registraremos tu ubicación en segundo plano.',
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Continuar', onPress: () => { void startGps(); } },
      ],
    );
  }

  async function startGps() {
    if (!vehicle) return;
    setError('');
    try {
      if (!await Location.hasServicesEnabledAsync()) {
        setStatus('Los servicios de ubicación están apagados. Puedes usar el odómetro manual.');
        return;
      }
      const existingPermission = await Location.getForegroundPermissionsAsync();
      const permission = existingPermission.granted ? existingPermission : await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setStatus('No se concedió la ubicación. El viaje manual sigue disponible.');
        return;
      }
      const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const firstPoint: GpsPoint = {
        latitude: initial.coords.latitude, longitude: initial.coords.longitude, timestamp: initial.timestamp,
        speedMps: initial.coords.speed, accuracy: initial.coords.accuracy,
      };
      beginSession('gps', null, firstPoint.accuracy !== null && firstPoint.accuracy > 60 ? null : firstPoint);
      subscriptionRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 5 },
        onLocation,
      );
    } catch {
      subscriptionRef.current?.remove();
      subscriptionRef.current = null;
      sessionRef.current = null;
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = null;
      setMode(null);
      setStatus('No fue posible iniciar el GPS. Puedes continuar con el odómetro manual.');
    }
  }

  async function resumeGps() {
    const session = sessionRef.current;
    if (!session || session.mode !== 'gps' || !session.paused) return;
    try {
      if (!await Location.hasServicesEnabledAsync()) {
        setError('Activa los servicios de ubicación para reanudar el GPS.');
        return;
      }
      const permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted) {
        setError('No hay permiso de ubicación. Puedes guardar el tramo GPS ya registrado.');
        return;
      }
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const resumedPoint: GpsPoint = {
        latitude: position.coords.latitude, longitude: position.coords.longitude, timestamp: position.timestamp,
        speedMps: position.coords.speed, accuracy: position.coords.accuracy,
      };
      session.lastPoint = resumedPoint.accuracy !== null && resumedPoint.accuracy > 60 ? null : resumedPoint;
      subscriptionRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 5 }, onLocation,
      );
      startClock(session);
      setError('');
      setStatus('GPS reanudado. La distancia mientras la pantalla estaba fuera no se registró.');
    } catch {
      setError('No fue posible reanudar el GPS. Guarda el tramo ya registrado o inténtalo de nuevo.');
    }
  }

  function startManual() {
    if (!vehicle) return;
    const startKm = manualStartKm.trim() === '' ? NaN : Number(manualStartKm);
    if (!Number.isSafeInteger(startKm) || startKm < vehicle.km_actual) {
      setError(`El odómetro inicial debe ser un número entero de al menos ${vehicle.km_actual.toLocaleString('es-CO')} km.`);
      return;
    }
    setManualEndKm('');
    beginSession('manual', startKm);
  }

  async function finishTrip() {
    const session = sessionRef.current;
    if (!session) return;
    let distance = session.distanceMeters;
    let endKm: number | null = null;
    if (session.mode === 'manual') {
      endKm = manualEndKm.trim() === '' ? NaN : Number(manualEndKm);
      if (!Number.isSafeInteger(endKm) || endKm < (session.startKm ?? 0)) {
        setError(`El odómetro final debe ser un número entero de al menos ${(session.startKm ?? 0).toLocaleString('es-CO')} km.`);
        return;
      }
      distance = (endKm - (session.startKm ?? endKm)) * 1000;
    }

    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    const endedAtMs = Date.now();
    const duration = Math.floor((session.elapsedBeforeResumeMs + (session.paused ? 0 : endedAtMs - session.resumedAtMs)) / 1000);
    try {
      await saveTrip(db, {
        vehicleId: session.vehicleId,
        started_at: new Date(session.startedAtMs).toISOString(),
        ended_at: new Date(endedAtMs).toISOString(),
        distancia_metros: distance,
        velocidad_max_kmh: session.mode === 'gps' ? session.maxSpeedKmh : 0,
        duracion_segundos: duration,
        metodo: session.mode,
        km_inicio: session.startKm,
        km_fin: endKm,
      });
      sessionRef.current = null;
      setMode(null); setElapsedSeconds(duration); setDistanceMeters(distance); setMaxSpeedKmh(session.maxSpeedKmh); setCurrentSpeedKmh(0);
      setStatus('Viaje guardado en este dispositivo.');
      setManualStartKm(String(endKm ?? vehicle?.km_actual ?? ''));
      setManualEndKm('');
      setError('');
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el viaje.');
      setStatus('El viaje terminó, pero no se pudo guardar. Inténtalo de nuevo.');
    }
  }

  return <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
    <Text style={s.eyebrow}>REGISTRO DE RECORRIDO</Text>
    <Text style={s.title}>Viaje</Text>
    {vehicle ? <Text style={s.intro}>{vehicle.alias} · {vehicle.placa} · odómetro {vehicle.km_actual.toLocaleString('es-CO')} km</Text> : <View style={s.notice}>
      <Text style={s.intro}>Registra o selecciona un vehículo antes de iniciar un viaje.</Text>
      <Link href="/(tabs)/vehiculos" style={s.link}>Ir a Vehículos</Link>
    </View>}

    {vehicle && <>
      <View style={s.metricsCard}>
        <Text style={[s.livePill, mode ? s.live : s.idle]}>{mode ? mode === 'gps' ? sessionRef.current?.paused ? 'GPS PAUSADO' : 'GPS EN VIVO' : 'MODO MANUAL' : 'LISTO PARA INICIAR'}</Text>
        <Text style={s.distance}>{metersToKilometers(distanceMeters)} <Text style={s.unit}>km</Text></Text>
        <View style={s.metricRow}>
          <Metric label="Duración" value={formatDuration(elapsedSeconds)} />
          <Metric label="Velocidad actual" value={`${Math.round(currentSpeedKmh)} km/h`} />
          <Metric label="Máxima" value={`${Math.round(maxSpeedKmh)} km/h`} />
        </View>
        <Text style={s.status}>{status}</Text>
      </View>

      {!mode && <>
        <Pressable accessibilityRole="button" accessibilityLabel="Iniciar seguimiento GPS en primer plano" style={s.primaryButton} onPress={requestLocationAndStart}>
          <Text style={s.primaryText}>Iniciar con GPS</Text>
        </Pressable>
        <View style={s.manualCard}>
          <Text style={s.formTitle}>Sin GPS o sin permiso</Text>
          <Text style={s.helper}>Registra los odómetros de salida y llegada. La app calculará la distancia recorrida.</Text>
          <Text style={s.label}>Odómetro inicial (km)</Text>
          <TextInput accessibilityLabel="Odómetro inicial del viaje" keyboardType="number-pad" value={manualStartKm} onChangeText={value => setManualStartKm(value.replace(/\D/g, ''))} style={s.input} />
          <Pressable accessibilityRole="button" accessibilityLabel="Iniciar viaje manual" style={s.secondaryButton} onPress={startManual}><Text style={s.secondaryText}>Iniciar modo manual</Text></Pressable>
        </View>
      </>}

      {mode === 'manual' && <View style={s.manualCard}>
        <Text style={s.formTitle}>Finalizar viaje manual</Text>
        <Text style={s.label}>Odómetro final (km)</Text>
        <TextInput accessibilityLabel="Odómetro final del viaje" keyboardType="number-pad" placeholder={`Mínimo ${(sessionRef.current?.startKm ?? 0).toLocaleString('es-CO')}`} value={manualEndKm} onChangeText={value => setManualEndKm(value.replace(/\D/g, ''))} style={s.input} />
        <Pressable accessibilityRole="button" style={s.primaryButton} onPress={() => void finishTrip()}><Text style={s.primaryText}>Guardar y finalizar</Text></Pressable>
      </View>}

      {mode === 'gps' && sessionRef.current?.paused && <Pressable accessibilityRole="button" accessibilityLabel="Reanudar seguimiento GPS" style={s.secondaryButton} onPress={() => void resumeGps()}><Text style={s.secondaryText}>Reanudar GPS</Text></Pressable>}
      {mode === 'gps' && <Pressable accessibilityRole="button" accessibilityLabel="Finalizar y guardar el viaje GPS" style={s.stopButton} onPress={() => void finishTrip()}><Text style={s.primaryText}>Finalizar y guardar</Text></Pressable>}
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}

      <Text style={s.section}>Viajes recientes</Text>
      {!trips.length && <Text style={s.empty}>Tus recorridos guardados aparecerán aquí.</Text>}
      {trips.map(item => <View key={item.id} style={s.tripCard}>
        <View style={s.cardTop}><Text style={s.tripDate}>{dateText(item.started_at)}</Text><Text style={s.modeTag}>{item.metodo === 'gps' ? 'GPS' : 'MANUAL'}</Text></View>
        <Text style={s.tripDistance}>{metersToKilometers(item.distancia_metros)} km</Text>
        <Text style={s.tripDetails}>{formatDuration(item.duracion_segundos)} · velocidad máx. {Math.round(item.velocidad_max_kmh)} km/h</Text>
        {item.metodo === 'manual' && item.km_inicio !== null && item.km_fin !== null && <Text style={s.tripDetails}>Odómetro {item.km_inicio.toLocaleString('es-CO')} → {item.km_fin.toLocaleString('es-CO')} km</Text>}
      </View>)}
    </>}
  </ScrollView>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <View style={s.metric}><Text style={s.metricLabel}>{label}</Text><Text style={s.metricValue}>{value}</Text></View>;
}

const s = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: '#f4f7f4', padding: 20, gap: 14, paddingBottom: 36 },
  eyebrow: { color: '#16805f', fontWeight: '700', letterSpacing: 1.4, marginTop: 8 }, title: { color: '#142b25', fontSize: 30, fontWeight: '800' }, intro: { color: '#62756f' }, link: { color: '#126b51', fontWeight: '700' }, notice: { backgroundColor: '#fff', borderRadius: 16, padding: 18, gap: 12 },
  metricsCard: { backgroundColor: '#fff', padding: 19, borderRadius: 20, gap: 12 }, livePill: { alignSelf: 'flex-start', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 99, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 }, live: { color: '#0c694d', backgroundColor: '#dff3e8' }, idle: { color: '#63766f', backgroundColor: '#edf1ee' }, distance: { color: '#142b25', fontSize: 42, fontWeight: '800' }, unit: { fontSize: 19, color: '#61756e' }, metricRow: { flexDirection: 'row', gap: 8 }, metric: { flex: 1, gap: 4 }, metricLabel: { color: '#75847f', fontSize: 11 }, metricValue: { color: '#214538', fontSize: 14, fontWeight: '700' }, status: { color: '#61756e', fontSize: 13, lineHeight: 19 },
  primaryButton: { backgroundColor: '#126b51', padding: 15, borderRadius: 13, alignItems: 'center' }, stopButton: { backgroundColor: '#a83b3b', padding: 15, borderRadius: 13, alignItems: 'center' }, primaryText: { color: '#fff', fontWeight: '700' }, secondaryButton: { borderWidth: 1, borderColor: '#94b7a6', padding: 13, borderRadius: 12, alignItems: 'center' }, secondaryText: { color: '#126b51', fontWeight: '700' },
  manualCard: { backgroundColor: '#fff', borderRadius: 18, padding: 17, gap: 10 }, formTitle: { color: '#142b25', fontSize: 18, fontWeight: '700' }, helper: { color: '#70837e', fontSize: 13, lineHeight: 18 }, label: { color: '#526a63', fontWeight: '600', marginTop: 2 }, input: { borderWidth: 1, borderColor: '#cbd8d2', borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, color: '#142b25', backgroundColor: '#fff' }, error: { color: '#b33b3b', fontSize: 13 }, section: { color: '#142b25', fontSize: 20, fontWeight: '700', marginTop: 4 }, empty: { color: '#70837e', backgroundColor: '#fff', padding: 16, borderRadius: 14 },
  tripCard: { backgroundColor: '#fff', padding: 15, borderRadius: 16, gap: 5 }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, tripDate: { color: '#61756e', fontSize: 12 }, modeTag: { color: '#5c776c', fontSize: 10, fontWeight: '800', letterSpacing: 0.7 }, tripDistance: { color: '#142b25', fontSize: 20, fontWeight: '700' }, tripDetails: { color: '#70837e', fontSize: 12 },
});
