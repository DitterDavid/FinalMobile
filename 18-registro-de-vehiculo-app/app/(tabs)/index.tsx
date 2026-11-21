import { Link, useFocusEffect } from 'expo-router';
import { Alert, Pressable, ScrollView, Text, View, StyleSheet } from 'react-native';
import { useCallback, useState } from 'react';
import { useSQLiteContext } from 'expo-sqlite';
import * as Sharing from 'expo-sharing';
import { getActiveVehicleId, listVehicles, type Vehicle } from '@/repositories/vehicles';
import { listRefuels } from '@/repositories/refuels';
import { calculateMetrics } from '@/services/vehicle-metrics';
import { kmUntilService, listMaintenance } from '@/repositories/maintenance';
import { exportVehicleLogCsv } from '@/services/export-log';

export default function Dashboard() {
  const db = useSQLiteContext();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [consumption, setConsumption] = useState<number | null>(null);
  const [costPerKm, setCostPerKm] = useState<number | null>(null);
  const [maintenanceAlert, setMaintenanceAlert] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  useFocusEffect(useCallback(() => {
    let mounted = true;
    void (async () => {
      const activeId = await getActiveVehicleId(db);
      const vehicles = await listVehicles(db);
      const activeVehicle = vehicles.find(item => item.id === activeId) ?? null;
      const refuels = activeVehicle ? await listRefuels(db, activeVehicle.id) : [];
      const maintenance = activeVehicle ? await listMaintenance(db, activeVehicle.id) : [];
      const distance = refuels.slice(1).reduce((sum, item, index) => sum + Math.max(0, item.km - refuels[index].km), 0);
      const spend = refuels.slice(1).reduce((sum, item) => sum + item.total_centavos, 0);
      const nextService = activeVehicle ? maintenance
        .filter(item => item.proximo_km !== null && kmUntilService(item, activeVehicle.km_actual)! < 500)
        .sort((a, b) => (a.proximo_km ?? Number.MAX_SAFE_INTEGER) - (b.proximo_km ?? Number.MAX_SAFE_INTEGER))[0] : undefined;
      const remaining = activeVehicle && nextService ? kmUntilService(nextService, activeVehicle.km_actual) : null;
      if (mounted) {
        setVehicle(activeVehicle);
        setConsumption(refuels.length > 1 ? calculateMetrics(refuels[refuels.length - 2], refuels[refuels.length - 1]).consumoKmL : null);
        setCostPerKm(distance > 0 ? spend / 100 / distance : null);
        setMaintenanceAlert(nextService && remaining !== null
          ? `${nextService.tipo}: ${remaining < 0 ? `vencido hace ${Math.abs(remaining).toLocaleString('es-CO')} km` : `faltan ${remaining.toLocaleString('es-CO')} km`}`
          : null);
      }
    })();
    return () => { mounted = false; };
  }, [db]));

  async function exportLog() {
    setExportMessage('');
    setExporting(true);
    try {
      if (!(await Sharing.isAvailableAsync())) throw new Error('La opción para compartir archivos no está disponible en este dispositivo.');
      const file = await exportVehicleLogCsv(db);
      await Sharing.shareAsync(file.uri, { mimeType: 'text/csv', dialogTitle: 'Compartir bitácora', UTI: 'public.comma-separated-values-text' });
      setExportMessage(`Archivo CSV preparado con ${file.records} registros.`);
    } catch (cause) {
      Alert.alert('No se pudo exportar', cause instanceof Error ? cause.message : 'Inténtalo de nuevo.');
    } finally {
      setExporting(false);
    }
  }

  return <ScrollView contentContainerStyle={styles.page}>
    <Text style={styles.eyebrow}>TU VEHÍCULO, AL DÍA</Text>
    <Text style={styles.title}>Resumen</Text>
    <View style={styles.vehicleCard}>
      <Text style={styles.label}>Vehículo activo</Text>
      {vehicle ? <><Text style={styles.value}>{vehicle.alias}</Text><Text style={styles.hint}>{vehicle.placa} · {vehicle.km_actual.toLocaleString('es-CO')} km</Text></> : <><Text style={styles.value}>Aún no tienes uno</Text><Text style={styles.hint}>Agrega los datos de tu carro o moto para comenzar.</Text></>}
      <Link href="/(tabs)/vehiculos" style={styles.vehicleLink}>{vehicle ? 'Administrar vehículos' : 'Agregar vehículo'}</Link>
    </View>
    <View style={styles.card}><Text style={styles.label}>Consumo reciente</Text><Text style={styles.value}>{consumption != null ? `${consumption.toFixed(1)} km/L` : 'Agrega dos tanqueos'}</Text><Text style={styles.hint}>{costPerKm != null ? `Costo promedio: $${costPerKm.toLocaleString('es-CO', { maximumFractionDigits: 0 })} por km.` : 'Calcularemos km/L y costo por kilómetro.'}</Text></View>
    <View style={styles.card}><Text style={styles.label}>Próxima revisión</Text><Text style={styles.value}>{maintenanceAlert ?? 'Sin revisiones próximas'}</Text><Text style={styles.hint}>{maintenanceAlert ? 'Revisa el detalle en Mantenimiento.' : 'Te avisaremos cuando falten menos de 500 km.'}</Text></View>
    <Link href="/viaje" style={styles.button}>Iniciar un viaje</Link>
    <Link href="/cuenta" style={styles.accountButton}><Text style={styles.accountTitle}>Cuenta y nube</Text><Text style={styles.accountHint}>Usa la bitácora desde otros dispositivos</Text></Link>
    <Pressable accessibilityRole="button" accessibilityLabel="Exportar bitácora a CSV" disabled={exporting} onPress={() => void exportLog()} style={[styles.exportButton, exporting && styles.disabled]}>
      <Text style={styles.exportTitle}>{exporting ? 'Preparando archivo…' : 'Exportar bitácora'}</Text>
      <Text style={styles.exportHint}>CSV para abrir o guardar en Excel</Text>
    </Pressable>
    {!!exportMessage && <Text accessibilityLiveRegion="polite" style={styles.exportMessage}>{exportMessage}</Text>}
  </ScrollView>;
}
const styles = StyleSheet.create({ page: { flexGrow: 1, backgroundColor: '#f4f7f4', padding: 22, gap: 16 }, eyebrow: { color: '#16805f', fontWeight: '700', letterSpacing: 1.5, marginTop: 18 }, title: { color: '#142b25', fontSize: 32, fontWeight: '800' }, card: { backgroundColor: '#fff', padding: 20, borderRadius: 20, gap: 8 }, vehicleCard: { backgroundColor: '#e8f3ed', padding: 20, borderRadius: 20, gap: 8, borderWidth: 1, borderColor: '#c6dfd1' }, label: { color: '#56716a', fontWeight: '600' }, value: { color: '#142b25', fontSize: 20, fontWeight: '700' }, hint: { color: '#70837e' }, vehicleLink: { color: '#126b51', fontWeight: '700', marginTop: 5 }, button: { color: '#fff', backgroundColor: '#126b51', textAlign: 'center', overflow: 'hidden', padding: 16, borderRadius: 14, fontWeight: '700' }, accountButton: { backgroundColor: '#e8f3ed', borderColor: '#c6dfd1', borderWidth: 1, padding: 16, borderRadius: 14, gap: 4 }, accountTitle: { color: '#126b51', fontWeight: '700', textAlign: 'center' }, accountHint: { color: '#70837e', fontSize: 12, textAlign: 'center' }, exportButton: { backgroundColor: '#fff', borderColor: '#c6dfd1', borderWidth: 1, padding: 16, borderRadius: 14, gap: 4 }, exportTitle: { color: '#126b51', fontWeight: '700', textAlign: 'center' }, exportHint: { color: '#70837e', fontSize: 12, textAlign: 'center' }, disabled: { opacity: 0.6 }, exportMessage: { color: '#126b51', textAlign: 'center', fontSize: 13 } });
