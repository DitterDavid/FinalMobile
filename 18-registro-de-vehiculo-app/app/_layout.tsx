import { Stack } from 'expo-router';
import { AppState } from 'react-native';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SQLiteProvider } from 'expo-sqlite';
import { initializeDatabase } from '@/db/database';
import { syncLocalDatabase } from '@/services/cloud-sync';
import { useSQLiteContext } from 'expo-sqlite';

export default function RootLayout() {
  return <GestureHandlerRootView style={{ flex: 1 }}>
    <SQLiteProvider databaseName="vehiculos.db" onInit={initializeDatabase}>
      <SyncOnResume />
      <Stack screenOptions={{ headerShown: false }} />
    </SQLiteProvider>
  </GestureHandlerRootView>;
}

function SyncOnResume() {
  const db = useSQLiteContext();
  useEffect(() => {
    const sync = () => { void syncLocalDatabase(db).catch(() => undefined); };
    if (AppState.currentState === 'active') sync();
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') sync(); });
    return () => subscription.remove();
  }, [db]);
  return null;
}
