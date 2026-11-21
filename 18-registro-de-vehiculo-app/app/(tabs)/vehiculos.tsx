import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from 'expo-router';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import { getActiveVehicleId, listVehicles, removeVehicle, saveVehicle, setActiveVehicle, type Vehicle } from '@/repositories/vehicles';

export default function Vehicles() {
  const db = useSQLiteContext();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [plate, setPlate] = useState('');
  const [alias, setAlias] = useState('');
  const [km, setKm] = useState('');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setVehicles(await listVehicles(db));
    setActiveId(await getActiveVehicleId(db));
  }, [db]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  function clearForm() {
    setEditingId(null); setPlate(''); setAlias(''); setKm(''); setError('');
  }
  function edit(vehicle: Vehicle) {
    setEditingId(vehicle.id); setPlate(vehicle.placa); setAlias(vehicle.alias); setKm(String(vehicle.km_actual)); setError('');
  }
  async function submit() {
    setError('');
    const parsedKm = km.trim() === '' ? NaN : Number(km);
    try {
      await saveVehicle(db, { id: editingId ?? undefined, placa: plate, alias, km_actual: parsedKm });
      clearForm(); await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el vehículo.');
    }
  }
  function confirmRemove(vehicle: Vehicle) {
    Alert.alert('Eliminar vehículo', `¿Quieres quitar ${vehicle.alias} (${vehicle.placa}) de la lista?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => { await removeVehicle(db, vehicle.id); await refresh(); } },
    ]);
  }

  return <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
    <Text style={s.eyebrow}>TU GARAJE</Text>
    <Text style={s.title}>Vehículos</Text>
    <Text style={s.intro}>Registra la placa y el odómetro para empezar tu bitácora.</Text>
    {vehicles.map((vehicle, index) => <VehicleCard key={vehicle.id} vehicle={vehicle} active={activeId === vehicle.id} previous={index > 0 ? () => void activate(vehicles[index - 1]) : undefined} next={index < vehicles.length - 1 ? () => void activate(vehicles[index + 1]) : undefined} onSwipe={delta => { const target = vehicles[index + delta]; if (target) void activate(target); }}>
      <View style={s.row}><View style={s.vehicleInfo}><Text style={s.alias}>{vehicle.alias}</Text><Text style={s.plate}>{vehicle.placa}</Text></View>
        {activeId === vehicle.id && <Text style={s.active}>ACTIVO</Text>}</View>
      <Text style={s.km}>{vehicle.km_actual.toLocaleString('es-CO')} km</Text>
      <View style={s.actions}>
        {activeId !== vehicle.id && <Action label="Usar este" onPress={async () => { await setActiveVehicle(db, vehicle.id); await refresh(); }} />}
        <Action label="Editar" onPress={() => edit(vehicle)} />
        <Action label="Eliminar" danger onPress={() => confirmRemove(vehicle)} />
      </View>
    </VehicleCard>)}
    <View style={s.form}>
      <Text style={s.formTitle}>{editingId ? 'Editar vehículo' : 'Agregar vehículo'}</Text>
      <Text style={s.label}>Placa</Text>
      <TextInput accessibilityLabel="Placa del vehículo" autoCapitalize="characters" autoCorrect={false} maxLength={6} placeholder="ABC123 o ABC12D" value={plate} onChangeText={setPlate} style={s.input} />
      <Text style={s.label}>Nombre o alias</Text>
      <TextInput accessibilityLabel="Nombre del vehículo" placeholder="Mi carro" maxLength={40} value={alias} onChangeText={setAlias} style={s.input} />
      <Text style={s.label}>Kilometraje actual</Text>
      <TextInput accessibilityLabel="Kilometraje actual" keyboardType="number-pad" placeholder="Ej. 45200" value={km} onChangeText={value => setKm(value.replace(/\D/g, ''))} style={s.input} />
      {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
      <Pressable accessibilityRole="button" style={s.save} onPress={() => void submit()}><Text style={s.saveText}>{editingId ? 'Guardar cambios' : 'Guardar vehículo'}</Text></Pressable>
      {!!editingId && <Pressable accessibilityRole="button" style={s.cancel} onPress={clearForm}><Text style={s.cancelText}>Cancelar edición</Text></Pressable>}
    </View>
  </ScrollView>;

  async function activate(vehicle: Vehicle) { await setActiveVehicle(db, vehicle.id); await refresh(); }
}

function VehicleCard({ vehicle, active, previous, next, onSwipe, children }: { vehicle: Vehicle; active: boolean; previous?: () => void; next?: () => void; onSwipe: (delta: number) => void; children: React.ReactNode }) {
  const gesture = usePanGesture({ enabled: active, activeOffsetX: [-24, 24], failOffsetY: [-14, 14], runOnJS: true, onDeactivate: event => { if (!event.canceled && Math.abs(event.translationX) > 70) onSwipe(event.translationX < 0 ? 1 : -1); } });
  return <GestureDetector gesture={gesture}><View style={[s.card, active && s.selected]}>
    {children}
    {active && (previous || next) && <View style={s.navigation}>
      {previous && <Action label="Vehículo anterior" onPress={previous} />}
      <Text style={s.hint}>Desliza para cambiar</Text>
      {next && <Action label="Vehículo siguiente" onPress={next} />}
    </View>}
  </View></GestureDetector>;
}

function Action({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={s.action}><Text style={danger ? s.danger : s.actionText}>{label}</Text></Pressable>;
}

const s = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: '#f4f7f4', padding: 20, gap: 14, paddingBottom: 36 },
  eyebrow: { color: '#16805f', fontWeight: '700', letterSpacing: 1.5, marginTop: 8 },
  title: { color: '#142b25', fontSize: 30, fontWeight: '800' }, intro: { color: '#62756f', marginBottom: 4 },
  card: { backgroundColor: '#fff', padding: 17, borderRadius: 18, gap: 10, borderWidth: 1, borderColor: '#e5ece8' },
  selected: { borderColor: '#16805f' }, navigation: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8 }, hint: { color: '#71817b', fontSize: 12 }, row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, vehicleInfo: { gap: 3 }, alias: { color: '#142b25', fontWeight: '700', fontSize: 18 }, plate: { color: '#587169', letterSpacing: 1 }, active: { color: '#16805f', fontSize: 11, fontWeight: '800' }, km: { color: '#142b25', fontSize: 22, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 }, action: { borderWidth: 1, borderColor: '#cad7d1', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 }, actionText: { color: '#35584c', fontWeight: '600' }, danger: { color: '#b33b3b', fontWeight: '600' },
  form: { backgroundColor: '#fff', padding: 18, borderRadius: 18, gap: 10, marginTop: 4 }, formTitle: { color: '#142b25', fontSize: 20, fontWeight: '700', marginBottom: 4 }, label: { color: '#526a63', fontWeight: '600', marginTop: 3 }, input: { borderWidth: 1, borderColor: '#cbd8d2', borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, color: '#142b25', backgroundColor: '#fff' }, error: { color: '#b33b3b', fontSize: 13 }, save: { backgroundColor: '#126b51', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 5 }, saveText: { color: '#fff', fontWeight: '700' }, cancel: { padding: 10, alignItems: 'center' }, cancelText: { color: '#526a63', fontWeight: '600' },
});
