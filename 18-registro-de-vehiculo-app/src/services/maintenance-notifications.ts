import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { MaintenanceRecord } from '@/repositories/maintenance';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

async function getPermission(request: boolean) {
  if (Platform.OS === 'android') {
    try {
      await Notifications.setNotificationChannelAsync('maintenance', {
        name: 'Mantenimiento del vehículo',
        importance: Notifications.AndroidImportance.DEFAULT,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#16805f',
      });
    } catch {
      // Expo Go on some Android builds cannot create a custom channel. Continue
      // with the fallback notification channel so saving a maintenance record works.
    }
  }
  let permission = await Notifications.getPermissionsAsync();
  if (request && !permission.granted) permission = await Notifications.requestPermissionsAsync();
  return permission.granted;
}

function dueDateAtNine(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  const due = new Date(year, month - 1, day, 9, 0, 0, 0);
  return due;
}

async function cancelDateReminder(recordId: string) {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(scheduled
    .filter(item => item.content.data?.kind === 'maintenance-date' && item.content.data?.maintenanceId === recordId)
    .map(item => Notifications.cancelScheduledNotificationAsync(item.identifier)));
}

export async function scheduleMaintenanceReminder(db: SQLiteDatabase, record: MaintenanceRecord, currentKm: number, requestPermission: boolean) {
  const hasDate = Boolean(record.proxima_fecha);
  const nearKm = record.proximo_km !== null && record.proximo_km - currentKm < 500;
  if (!hasDate && record.proximo_km === null) return false;
  if (!(await getPermission(requestPermission))) return false;

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const matchingDate = scheduled.find(item => item.content.data?.kind === 'maintenance-date' && item.content.data?.maintenanceId === record.id && item.content.data?.dueDate === record.proxima_fecha);
  await Promise.all(scheduled
    .filter(item => item.content.data?.kind === 'maintenance-date' && item.content.data?.maintenanceId === record.id && item !== matchingDate)
    .map(item => Notifications.cancelScheduledNotificationAsync(item.identifier)));
  if (record.proxima_fecha) {
    const date = dueDateAtNine(record.proxima_fecha);
    if (!matchingDate && date.getTime() > Date.now()) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Mantenimiento próximo',
          body: `Hoy corresponde revisar: ${record.tipo}.`,
          data: { kind: 'maintenance-date', maintenanceId: record.id, dueDate: record.proxima_fecha },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date },
      });
    }
  }

  if (nearKm) {
    const reminderKey = `maintenance_km_notified_${record.id}_${record.proximo_km}`;
    const notified = await db.getFirstAsync<{ valor: string }>('SELECT valor FROM configuracion WHERE clave = ?', reminderKey);
    if (!notified) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: record.proximo_km! < currentKm ? 'Mantenimiento vencido' : 'Mantenimiento próximo',
          body: record.proximo_km! < currentKm
            ? `${record.tipo}: supera el kilometraje recomendado por ${(currentKm - record.proximo_km!).toLocaleString('es-CO')} km.`
            : `${record.tipo}: faltan ${(record.proximo_km! - currentKm).toLocaleString('es-CO')} km para la revisión.`,
          data: { kind: 'maintenance-km', maintenanceId: record.id, dueKm: record.proximo_km },
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: 1, repeats: false },
      });
      await db.runAsync('INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)', reminderKey, new Date().toISOString());
    }
  }
  return true;
}

export async function removeMaintenanceReminder(recordId: string) {
  await cancelDateReminder(recordId);
}
