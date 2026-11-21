import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewInstance } from 'react-native';
import { GestureDetector, useCompetingGestures, useLongPressGesture, usePanGesture } from 'react-native-gesture-handler';
import { Link, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { calculateMetrics } from '@/services/vehicle-metrics';
import { getActiveVehicleId, listVehicles, type Vehicle } from '@/repositories/vehicles';
import { listRefuels, removeRefuel, saveRefuel, type RefuelRecord } from '@/repositories/refuels';

const today = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};
const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

export default function Refuels() {
  const db = useSQLiteContext();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [refuels, setRefuels] = useState<RefuelRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fecha, setFecha] = useState(today());
  const [km, setKm] = useState('');
  const [litros, setLitros] = useState('');
  const [pesos, setPesos] = useState('');
  const [error, setError] = useState('');
  const scrollRef = useRef<ScrollViewInstance>(null);

  const refresh = useCallback(async () => {
    const activeId = await getActiveVehicleId(db);
    const vehicles = await listVehicles(db);
    const activeVehicle = vehicles.find(item => item.id === activeId) ?? null;
    setVehicle(activeVehicle);
    setRefuels(activeVehicle ? await listRefuels(db, activeVehicle.id) : []);
  }, [db]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  function resetForm() {
    setEditingId(null); setFecha(today()); setKm(vehicle ? String(vehicle.km_actual) : ''); setLitros(''); setPesos(''); setError('');
  }
  function edit(item: RefuelRecord) {
    setEditingId(item.id); setFecha(item.fecha); setKm(String(item.km)); setLitros(String(item.litros)); setPesos(String(item.total_centavos / 100)); setError('');
  }
  function duplicate(item: RefuelRecord) {
    setEditingId(null); setFecha(today()); setKm(vehicle ? String(vehicle.km_actual) : String(item.km));
    setLitros(String(item.litros)); setPesos(String(item.total_centavos / 100)); setError('');
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }
  async function submit() {
    if (!vehicle) return;
    setError('');
    const parsedLiters = Number(litros.trim().replace(',', '.'));
    const parsedPesos = Number(pesos.trim().replace(/\s/g, ''));
    try {
      await saveRefuel(db, {
        id: editingId ?? undefined,
        vehicleId: vehicle.id,
        fecha,
        km: km.trim() === '' ? NaN : Number(km),
        litros: parsedLiters,
        total_centavos: Number.isSafeInteger(parsedPesos) ? parsedPesos * 100 : NaN,
      });
      resetForm();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el tanqueo.');
    }
  }
  function confirmRemove(item: RefuelRecord) {
    Alert.alert('Eliminar tanqueo', `¿Quieres quitar el registro de ${item.fecha}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => { await removeRefuel(db, item.id, item.vehiculo_id); await refresh(); } },
    ]);
  }

  const totalDistance = refuels.slice(1).reduce((sum, item, index) => sum + Math.max(0, item.km - refuels[index].km), 0);
  const totalSpend = refuels.slice(1).reduce((sum, item) => sum + item.total_centavos, 0);
  const averageCost = totalDistance > 0 ? totalSpend / 100 / totalDistance : null;
  const latestMetrics = refuels.length > 1 ? calculateMetrics(refuels[refuels.length - 2], refuels[refuels.length - 1]) : null;

  return <ScrollView ref={scrollRef} contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
    <Text style={s.eyebrow}>BITÁCORA</Text>
    <Text style={s.title}>Tanqueos</Text>
    {vehicle ? <Text style={s.intro}>{vehicle.alias} · {vehicle.placa} · {vehicle.km_actual.toLocaleString('es-CO')} km</Text> : <View style={s.emptyVehicle}>
      <Text style={s.intro}>Primero registra un vehículo para asociar tus tanqueos.</Text>
      <Link href="/(tabs)/vehiculos" style={s.link}>Ir a Vehículos</Link>
    </View>}

    {vehicle && <>
      <View style={s.summary}>
        <View style={s.metric}><Text style={s.metricLabel}>Último consumo</Text><Text style={s.metricValue}>{latestMetrics?.consumoKmL != null ? `${latestMetrics.consumoKmL.toFixed(1)} km/L` : '—'}</Text></View>
        <View style={s.metric}><Text style={s.metricLabel}>Costo promedio</Text><Text style={s.metricValue}>{averageCost != null ? `${cop.format(averageCost)}/km` : '—'}</Text></View>
      </View>
      <Text style={s.section}>Registros</Text>
      {refuels.length > 0 && <Text style={s.gestureHint}>Mantén pulsado para duplicar · desliza a la izquierda para eliminar</Text>}
      {refuels.length === 0 && <Text style={s.empty}>Aún no hay tanqueos. Guarda el primero para iniciar la bitácora.</Text>}
      {refuels.map((item, index) => {
        const previous = index > 0 ? refuels[index - 1] : null;
        const metrics = calculateMetrics(previous, item);
        return <RefuelCard key={item.id} item={item} consumption={metrics.consumoKmL != null ? `${metrics.consumoKmL.toFixed(1)} km/L` : 'Primer tanqueo, sin comparación'} cost={metrics.costoPorKm != null ? `${cop.format(metrics.costoPorKm)} por km desde el tanqueo anterior` : undefined} onDuplicate={() => duplicate(item)} onDelete={() => confirmRemove(item)} onEdit={() => edit(item)} />;
      })}
      <View style={s.form}>
        <Text style={s.formTitle}>{editingId ? 'Editar tanqueo' : 'Registrar tanqueo'}</Text>
        <Text style={s.label}>Fecha</Text>
        <TextInput accessibilityLabel="Fecha del tanqueo" placeholder="AAAA-MM-DD" maxLength={10} value={fecha} onChangeText={setFecha} style={s.input} />
        <Text style={s.label}>Odómetro (km)</Text>
        <TextInput accessibilityLabel="Odómetro del tanqueo" keyboardType="number-pad" placeholder="Ej. 45200" value={km} onChangeText={value => setKm(value.replace(/\D/g, ''))} style={s.input} />
        <Text style={s.label}>Litros</Text>
        <TextInput accessibilityLabel="Litros cargados" keyboardType="decimal-pad" placeholder="Ej. 38,5" value={litros} onChangeText={value => setLitros(value.replace(/[^\d.,]/g, ''))} style={s.input} />
        <Text style={s.label}>Total pagado (COP)</Text>
        <TextInput accessibilityLabel="Total pagado en pesos colombianos" keyboardType="number-pad" placeholder="Ej. 150000" value={pesos} onChangeText={value => setPesos(value.replace(/\D/g, ''))} style={s.input} />
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        <Pressable accessibilityRole="button" style={s.save} onPress={() => void submit()}><Text style={s.saveText}>{editingId ? 'Guardar cambios' : 'Guardar tanqueo'}</Text></Pressable>
        {!!editingId && <Pressable accessibilityRole="button" style={s.cancel} onPress={resetForm}><Text style={s.cancelText}>Cancelar edición</Text></Pressable>}
      </View>
    </>}
  </ScrollView>;
}

function Action({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={s.action}><Text style={danger ? s.danger : s.actionText}>{label}</Text></Pressable>;
}

function RefuelCard({ item, consumption, cost, onDuplicate, onDelete, onEdit }: { item: RefuelRecord; consumption: string; cost?: string; onDuplicate: () => void; onDelete: () => void; onEdit: () => void }) {
  const pan = usePanGesture({ activeOffsetX: [-24, 24], failOffsetY: [-14, 14], runOnJS: true, onDeactivate: event => { if (!event.canceled && event.translationX < -80) onDelete(); } });
  const longPress = useLongPressGesture({ minDuration: 600, maxDistance: 12, runOnJS: true, onActivate: onDuplicate });
  const combined = useCompetingGestures(pan, longPress);
  return <View style={s.card}>
    <GestureDetector gesture={combined}><View style={s.gestureArea}>
      <View style={s.cardTop}><View><Text style={s.date}>{item.fecha}</Text><Text style={s.km}>{item.km.toLocaleString('es-CO')} km</Text></View><Text style={s.total}>{cop.format(item.total_centavos / 100)}</Text></View>
      <Text style={s.detail}>{item.litros.toLocaleString('es-CO', { maximumFractionDigits: 2 })} L · {consumption}</Text>
      {!!cost && <Text style={s.cost}>{cost}</Text>}
    </View></GestureDetector>
    <View style={s.actions}><Action label="Editar tanqueo" onPress={onEdit} /><Action label="Duplicar tanqueo" onPress={onDuplicate} /><Action label="Eliminar tanqueo" danger onPress={onDelete} /></View>
  </View>;
}

const s = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: '#f4f7f4', padding: 20, gap: 14, paddingBottom: 36 },
  eyebrow: { color: '#16805f', fontWeight: '700', letterSpacing: 1.5, marginTop: 8 }, title: { fontSize: 30, fontWeight: '800', color: '#142b25' }, intro: { color: '#62756f' }, emptyVehicle: { backgroundColor: '#fff', borderRadius: 16, padding: 18, gap: 12 }, link: { color: '#126b51', fontWeight: '700' },
  summary: { flexDirection: 'row', gap: 10 }, metric: { flex: 1, backgroundColor: '#e8f3ed', borderRadius: 16, padding: 15, gap: 7 }, metricLabel: { color: '#56716a', fontSize: 12, fontWeight: '600' }, metricValue: { color: '#142b25', fontSize: 17, fontWeight: '800' }, section: { color: '#142b25', fontSize: 20, fontWeight: '700', marginTop: 5 }, empty: { color: '#70837e', backgroundColor: '#fff', padding: 16, borderRadius: 14 },
  card: { backgroundColor: '#fff', borderRadius: 17, padding: 16, gap: 8 }, gestureArea: { gap: 8 }, gestureHint: { color: '#71817b', fontSize: 12 }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, date: { color: '#61756e', fontSize: 13 }, km: { color: '#142b25', fontSize: 19, fontWeight: '700', marginTop: 3 }, total: { color: '#142b25', fontWeight: '700' }, detail: { color: '#3f6558' }, cost: { color: '#71817b', fontSize: 12 }, actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 3 }, action: { borderWidth: 1, borderColor: '#cad7d1', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 }, actionText: { color: '#35584c', fontWeight: '600' }, danger: { color: '#b33b3b', fontWeight: '600' },
  form: { backgroundColor: '#fff', padding: 18, borderRadius: 18, gap: 10, marginTop: 4 }, formTitle: { color: '#142b25', fontSize: 20, fontWeight: '700', marginBottom: 4 }, label: { color: '#526a63', fontWeight: '600', marginTop: 3 }, input: { borderWidth: 1, borderColor: '#cbd8d2', borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, color: '#142b25', backgroundColor: '#fff' }, error: { color: '#b33b3b', fontSize: 13 }, save: { backgroundColor: '#126b51', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 5 }, saveText: { color: '#fff', fontWeight: '700' }, cancel: { padding: 10, alignItems: 'center' }, cancelText: { color: '#526a63', fontWeight: '600' },
});
