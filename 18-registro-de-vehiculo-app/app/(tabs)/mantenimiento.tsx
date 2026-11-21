import { useCallback, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link as RouterLink, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import * as ImagePicker from 'expo-image-picker';
import { getActiveVehicleId, listVehicles, type Vehicle } from '@/repositories/vehicles';
import { kmUntilService, listMaintenance, removeMaintenance, saveMaintenance, type MaintenanceRecord } from '@/repositories/maintenance';
import { persistInvoiceImage, removeInvoiceImage } from '@/services/invoice-images';
import { removeMaintenanceReminder, scheduleMaintenanceReminder } from '@/services/maintenance-notifications';

const today = () => {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
};

export default function Maintenance() {
  const db = useSQLiteContext();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [records, setRecords] = useState<MaintenanceRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tipo, setTipo] = useState('');
  const [fecha, setFecha] = useState(today());
  const [km, setKm] = useState('');
  const [nextKm, setNextKm] = useState('');
  const [nextDate, setNextDate] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [originalPhotoUri, setOriginalPhotoUri] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const refresh = useCallback(async () => {
    const activeId = await getActiveVehicleId(db);
    const vehicles = await listVehicles(db);
    const activeVehicle = vehicles.find(item => item.id === activeId) ?? null;
    const nextRecords = activeVehicle ? await listMaintenance(db, activeVehicle.id) : [];
    setVehicle(activeVehicle);
    setRecords(nextRecords);
    if (activeVehicle) {
      for (const record of nextRecords) void scheduleMaintenanceReminder(db, record, activeVehicle.km_actual, false).catch(() => undefined);
    }
  }, [db]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  function resetForm(discardPendingPhoto = true) {
    if (discardPendingPhoto && photoUri && photoUri !== originalPhotoUri) removeInvoiceImage(photoUri);
    setEditingId(null); setTipo(''); setFecha(today()); setKm(vehicle ? String(vehicle.km_actual) : ''); setNextKm(''); setNextDate(''); setPhotoUri(null); setOriginalPhotoUri(null); setError('');
  }
  function edit(item: MaintenanceRecord) {
    resetForm();
    setEditingId(item.id); setTipo(item.tipo); setFecha(item.fecha); setKm(String(item.km)); setNextKm(item.proximo_km === null ? '' : String(item.proximo_km)); setNextDate(item.proxima_fecha ?? ''); setPhotoUri(item.foto_uri); setOriginalPhotoUri(item.foto_uri); setError('');
  }
  function showPhotoOptions() {
    Alert.alert('Factura del servicio', 'Puedes tomar una foto o elegir una imagen de tu galería.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Tomar foto', onPress: () => Alert.alert(
        'Usar la cámara',
        'La cámara se usará solo para tomar la foto de esta factura.',
        [{ text: 'Cancelar', style: 'cancel' }, { text: 'Continuar', onPress: () => { void choosePhoto('camera'); } }],
      ) },
      { text: 'Elegir de galería', onPress: () => { void choosePhoto('gallery'); } },
    ]);
  }
  async function choosePhoto(source: 'camera' | 'gallery') {
    setError('');
    try {
      if (source === 'camera') {
        const currentPermission = await ImagePicker.getCameraPermissionsAsync();
        const permission = currentPermission.granted ? currentPermission : await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setError('No se concedió acceso a la cámara. Puedes elegir la factura de tu galería.');
          return;
        }
      }
      const result = source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      if (asset.type && asset.type !== 'image') {
        setError('Selecciona una imagen para la factura.');
        return;
      }
      const savedUri = await persistInvoiceImage(asset.uri, asset.width);
      if (photoUri && photoUri !== originalPhotoUri) removeInvoiceImage(photoUri);
      setPhotoUri(savedUri);
    } catch {
      setError('No se pudo guardar la foto. Inténtalo de nuevo o elige otra imagen.');
    }
  }
  function clearPhoto() {
    if (photoUri && photoUri !== originalPhotoUri) removeInvoiceImage(photoUri);
    setPhotoUri(null);
  }
  async function submit() {
    if (!vehicle) return;
    setError(''); setNotice('');
    try {
      const savedId = await saveMaintenance(db, {
        id: editingId ?? undefined,
        vehicleId: vehicle.id,
        tipo,
        fecha,
        km: km.trim() === '' ? NaN : Number(km),
        proximo_km: nextKm.trim() === '' ? null : Number(nextKm),
        proxima_fecha: nextDate.trim() === '' ? null : nextDate.trim(),
        foto_uri: photoUri,
      });
      const saved = (await listMaintenance(db, vehicle.id)).find(item => item.id === savedId);
      let reminderScheduled = false;
      if (saved) {
        try { reminderScheduled = await scheduleMaintenanceReminder(db, saved, vehicle.km_actual, true); }
        catch { reminderScheduled = false; }
      }
      resetForm(false); await refresh();
      if (saved && (saved.proxima_fecha || saved.proximo_km !== null) && !reminderScheduled) {
        setNotice('Mantenimiento guardado. No se pudo programar el aviso; verifica los permisos de notificaciones del teléfono.');
      } else if (reminderScheduled) {
        setNotice('Mantenimiento guardado y aviso configurado.');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo guardar el mantenimiento.');
    }
  }
  function confirmRemove(item: MaintenanceRecord) {
    Alert.alert('Eliminar mantenimiento', `¿Quieres quitar “${item.tipo}” del ${item.fecha}?`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Eliminar', style: 'destructive', onPress: async () => { await removeMaintenance(db, item.id, item.vehiculo_id); await removeMaintenanceReminder(item.id); await refresh(); } },
    ]);
  }

  const alerts = vehicle ? records
    .filter(item => (item.proximo_km !== null && kmUntilService(item, vehicle.km_actual)! < 500) || (item.proxima_fecha !== null && item.proxima_fecha <= today()))
    .sort((a, b) => (a.proximo_km ?? Number.MAX_SAFE_INTEGER) - (b.proximo_km ?? Number.MAX_SAFE_INTEGER)) : [];

  return <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
    <Text style={s.eyebrow}>CUIDADO DEL VEHÍCULO</Text>
    <Text style={s.title}>Mantenimiento</Text>
    {vehicle ? <Text style={s.intro}>{vehicle.alias} · {vehicle.placa} · {vehicle.km_actual.toLocaleString('es-CO')} km</Text> : <View style={s.emptyVehicle}>
      <Text style={s.intro}>Registra o selecciona un vehículo para llevar su mantenimiento.</Text>
      <RouterLink href="/(tabs)/vehiculos" style={s.link}>Ir a Vehículos</RouterLink>
    </View>}

    {vehicle && <>
      <View style={s.alertBox}>
        <Text style={s.alertHeading}>{alerts.length ? 'Próximas revisiones' : 'Sin revisiones próximas'}</Text>
        {alerts.length ? alerts.map(item => {
          const remaining = kmUntilService(item, vehicle.km_actual);
          const dateDue = item.proxima_fecha !== null && item.proxima_fecha <= today();
          return <Text key={item.id} style={dateDue || (remaining !== null && remaining < 0) ? s.overdue : s.alertText}>
            {item.tipo}: {dateDue ? `revisión por fecha (${item.proxima_fecha})` : remaining !== null && remaining < 0 ? `vencido hace ${Math.abs(remaining).toLocaleString('es-CO')} km` : `faltan ${remaining?.toLocaleString('es-CO')} km`}
          </Text>;
        }) : <Text style={s.alertHint}>Aquí verás avisos al acercarse la fecha o el kilometraje de la revisión.</Text>}
      </View>
      <Text style={s.section}>Historial</Text>
      {!records.length && <Text style={s.empty}>Aún no hay servicios registrados.</Text>}
      {records.map(item => {
        const remaining = kmUntilService(item, vehicle.km_actual);
        return <View key={item.id} style={s.card}>
          <View style={s.cardTop}><View style={s.cardText}><Text style={s.service}>{item.tipo}</Text><Text style={s.date}>{item.fecha}</Text></View><Text style={s.km}>{item.km.toLocaleString('es-CO')} km</Text></View>
          {item.proximo_km !== null && <Text style={remaining !== null && remaining < 500 ? (remaining < 0 ? s.overdue : s.alertText) : s.nextService}>
            Próxima revisión: {item.proximo_km.toLocaleString('es-CO')} km{remaining !== null ? ` · ${remaining < 0 ? 'vencida' : `faltan ${remaining.toLocaleString('es-CO')} km`}` : ''}
          </Text>}
          {item.proxima_fecha && <Text style={item.proxima_fecha <= today() ? s.overdue : s.nextService}>Próxima revisión por fecha: {item.proxima_fecha}{item.proxima_fecha <= today() ? ' · vencida o corresponde hoy' : ''}</Text>}
          {item.foto_uri && <Image accessibilityLabel={`Factura de ${item.tipo}`} source={{ uri: item.foto_uri }} resizeMode="contain" style={s.invoicePreview} />}
          <View style={s.actions}><Action label="Editar mantenimiento" onPress={() => edit(item)} /><Action label="Eliminar mantenimiento" danger onPress={() => confirmRemove(item)} /></View>
        </View>;
      })}
      <View style={s.form}>
        <Text style={s.formTitle}>{editingId ? 'Editar mantenimiento' : 'Registrar mantenimiento'}</Text>
        <Text style={s.label}>Servicio o repuesto</Text>
        <TextInput accessibilityLabel="Tipo de mantenimiento" placeholder="Ej. Cambio de aceite" maxLength={80} value={tipo} onChangeText={setTipo} style={s.input} />
        <Text style={s.label}>Fecha</Text>
        <TextInput accessibilityLabel="Fecha del mantenimiento" placeholder="AAAA-MM-DD" maxLength={10} value={fecha} onChangeText={setFecha} style={s.input} />
        <Text style={s.label}>Odómetro al hacer el servicio (km)</Text>
        <TextInput accessibilityLabel="Odómetro del mantenimiento" keyboardType="number-pad" placeholder="Ej. 45200" value={km} onChangeText={value => setKm(value.replace(/\D/g, ''))} style={s.input} />
        <Text style={s.label}>Próxima revisión (km, opcional)</Text>
        <TextInput accessibilityLabel="Kilometraje de la próxima revisión" keyboardType="number-pad" placeholder="Ej. 50200" value={nextKm} onChangeText={value => setNextKm(value.replace(/\D/g, ''))} style={s.input} />
        <Text style={s.label}>Fecha de próxima revisión (opcional)</Text>
        <TextInput accessibilityLabel="Fecha de próxima revisión" placeholder="AAAA-MM-DD" maxLength={10} value={nextDate} onChangeText={setNextDate} style={s.input} />
        <Text style={s.photoHint}>Concede permiso para recibir avisos locales. Los avisos por kilometraje aparecen al abrir esta pantalla cuando se acercan.</Text>
        <Text style={s.label}>Foto de factura (opcional)</Text>
        <Text style={s.photoHint}>Se guarda comprimida en este dispositivo.</Text>
        <View style={s.photoActions}>
          <Pressable accessibilityRole="button" accessibilityLabel={photoUri ? 'Cambiar foto de factura' : 'Agregar foto de factura'} style={s.photoButton} onPress={showPhotoOptions}><Text style={s.photoButtonText}>{photoUri ? 'Cambiar foto' : 'Tomar o elegir foto'}</Text></Pressable>
          {!!photoUri && <Pressable accessibilityRole="button" accessibilityLabel="Quitar foto seleccionada" style={s.photoRemove} onPress={clearPhoto}><Text style={s.photoRemoveText}>Quitar</Text></Pressable>}
        </View>
        {!!photoUri && <Image accessibilityLabel="Vista previa de la factura" source={{ uri: photoUri }} resizeMode="contain" style={s.formPreview} />}
        {!!error && <Text accessibilityRole="alert" style={s.error}>{error}</Text>}
        {!!notice && <Text accessibilityLiveRegion="polite" style={s.notice}>{notice}</Text>}
        <Pressable accessibilityRole="button" style={s.save} onPress={() => void submit()}><Text style={s.saveText}>{editingId ? 'Guardar cambios' : 'Guardar mantenimiento'}</Text></Pressable>
        {!!editingId && <Pressable accessibilityRole="button" style={s.cancel} onPress={() => resetForm()}><Text style={s.cancelText}>Cancelar edición</Text></Pressable>}
      </View>
    </>}
  </ScrollView>;
}

function Action({ label, onPress, danger = false }: { label: string; onPress: () => void; danger?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={s.action}><Text style={danger ? s.danger : s.actionText}>{label}</Text></Pressable>;
}

const s = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: '#f4f7f4', padding: 20, gap: 14, paddingBottom: 36 },
  eyebrow: { color: '#16805f', fontWeight: '700', letterSpacing: 1.4, marginTop: 8 }, title: { color: '#142b25', fontSize: 30, fontWeight: '800' }, intro: { color: '#62756f' }, emptyVehicle: { backgroundColor: '#fff', borderRadius: 16, padding: 18, gap: 12 }, link: { color: '#126b51', fontWeight: '700' },
  alertBox: { backgroundColor: '#e8f3ed', borderColor: '#c6dfd1', borderWidth: 1, borderRadius: 16, padding: 16, gap: 7 }, alertHeading: { color: '#174a38', fontSize: 16, fontWeight: '700' }, alertText: { color: '#a05d10', fontWeight: '600' }, overdue: { color: '#b33b3b', fontWeight: '700' }, alertHint: { color: '#62756f', fontSize: 13 }, section: { color: '#142b25', fontSize: 20, fontWeight: '700', marginTop: 4 }, empty: { color: '#70837e', backgroundColor: '#fff', padding: 16, borderRadius: 14 },
  card: { backgroundColor: '#fff', borderRadius: 17, padding: 16, gap: 9 }, cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }, cardText: { flex: 1, gap: 3 }, service: { color: '#142b25', fontSize: 17, fontWeight: '700' }, date: { color: '#71817b', fontSize: 13 }, km: { color: '#526a63', fontWeight: '700' }, nextService: { color: '#526a63', fontSize: 13 }, invoicePreview: { width: '100%', height: 190, borderRadius: 12, backgroundColor: '#f5f7f5' }, actions: { flexDirection: 'row', gap: 8 }, action: { borderWidth: 1, borderColor: '#cad7d1', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 }, actionText: { color: '#35584c', fontWeight: '600' }, danger: { color: '#b33b3b', fontWeight: '600' },
  form: { backgroundColor: '#fff', padding: 18, borderRadius: 18, gap: 10, marginTop: 4 }, formTitle: { color: '#142b25', fontSize: 20, fontWeight: '700', marginBottom: 4 }, label: { color: '#526a63', fontWeight: '600', marginTop: 3 }, input: { borderWidth: 1, borderColor: '#cbd8d2', borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, color: '#142b25', backgroundColor: '#fff' }, photoHint: { color: '#71817b', fontSize: 12 }, photoActions: { flexDirection: 'row', alignItems: 'center', gap: 10 }, photoButton: { alignItems: 'center', borderWidth: 1, borderColor: '#94b7a6', paddingHorizontal: 13, paddingVertical: 11, borderRadius: 11 }, photoButtonText: { color: '#126b51', fontWeight: '700' }, photoRemove: { padding: 10 }, photoRemoveText: { color: '#b33b3b', fontWeight: '600' }, formPreview: { width: '100%', height: 200, borderRadius: 12, backgroundColor: '#f5f7f5' }, error: { color: '#b33b3b', fontSize: 13 }, notice: { color: '#126b51', fontSize: 13, fontWeight: '600' }, save: { backgroundColor: '#126b51', padding: 14, borderRadius: 12, alignItems: 'center', marginTop: 5 }, saveText: { color: '#fff', fontWeight: '700' }, cancel: { padding: 10, alignItems: 'center' }, cancelText: { color: '#526a63', fontWeight: '600' },
});
