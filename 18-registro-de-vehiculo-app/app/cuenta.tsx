import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { bindLocalDataToAccount, syncLocalDatabase } from '@/services/cloud-sync';
import { getCloudSession, saveCloudSession, signInOrRegister, signOutCloud, type CloudSession } from '@/services/cloud-auth';

export default function Account() {
  const db = useSQLiteContext();
  const [session, setSession] = useState<CloudSession | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [lastSync, setLastSync] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setSession(await getCloudSession());
    setLastSync((await db.getFirstAsync<{ valor: string }>("SELECT valor FROM configuracion WHERE clave = 'ultima_sincronizacion'"))?.valor ?? null);
  }, [db]);
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));

  async function authenticate() {
    setBusy(true); setMessage('');
    try {
      const result = await signInOrRegister(mode === 'register' ? '/api/auth/registro' : '/api/auth/login', email, password);
      await bindLocalDataToAccount(db, result.uid);
      await saveCloudSession(result);
      setSession(result);
      setPassword('');
      try {
        const resultSync = await syncLocalDatabase(db);
        setMessage(`Cuenta conectada. ${resultSync.enviados} enviados y ${resultSync.recibidos} disponibles en la nube.`);
        await refresh();
      } catch (cause) {
        setMessage(cause instanceof Error ? `Cuenta conectada; no se pudo sincronizar: ${cause.message}` : 'Cuenta conectada; la sincronización quedó pendiente.');
      }
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'No se pudo conectar la cuenta.');
    } finally { setBusy(false); }
  }

  async function syncNow() {
    setBusy(true); setMessage('');
    try {
      const result = await syncLocalDatabase(db);
      setMessage(`Sincronización completa: ${result.enviados} enviados, ${result.recibidos} disponibles.`);
      await refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'No se pudo sincronizar. La información local se conserva.');
    } finally { setBusy(false); }
  }

  function confirmSignOut() {
    Alert.alert('Cerrar sesión', 'Tus datos guardados en el teléfono permanecerán aquí y no se sincronizarán hasta iniciar sesión de nuevo.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive', onPress: async () => { await signOutCloud(); setSession(null); setMessage('Sesión cerrada. Los datos locales se conservaron.'); } },
    ]);
  }

  return <ScrollView contentContainerStyle={s.page} keyboardShouldPersistTaps="handled">
    <Text style={s.eyebrow}>DATOS EN TUS DISPOSITIVOS</Text>
    <Text style={s.title}>Cuenta y nube</Text>
    <View style={s.card}>
      <Text style={s.heading}>Sincroniza tu bitácora</Text>
      <Text style={s.body}>La información seguirá guardada en este teléfono y se sincronizará al conectarse a internet. Inicia sesión con la misma cuenta en tus otros dispositivos.</Text>
      {!session ? <>
        <View style={s.switches}>
          <Pressable accessibilityRole="button" onPress={() => setMode('login')} style={[s.mode, mode === 'login' && s.modeActive]}><Text style={mode === 'login' ? s.modeActiveText : s.modeText}>Iniciar sesión</Text></Pressable>
          <Pressable accessibilityRole="button" onPress={() => setMode('register')} style={[s.mode, mode === 'register' && s.modeActive]}><Text style={mode === 'register' ? s.modeActiveText : s.modeText}>Crear cuenta</Text></Pressable>
        </View>
        <Text style={s.label}>Correo electrónico</Text>
        <TextInput accessibilityLabel="Correo electrónico" autoCapitalize="none" autoComplete="email" keyboardType="email-address" value={email} onChangeText={setEmail} placeholder="nombre@correo.com" style={s.input} />
        <Text style={s.label}>Contraseña (mínimo 8 caracteres)</Text>
        <TextInput accessibilityLabel="Contraseña" autoCapitalize="none" autoComplete={mode === 'register' ? 'new-password' : 'password'} secureTextEntry value={password} onChangeText={setPassword} style={s.input} />
        <Text style={s.small}>Al conectarte por primera vez, los registros de este teléfono se copiarán a la cuenta.</Text>
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void authenticate()} style={[s.primary, busy && s.disabled]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>{mode === 'register' ? 'Crear cuenta y sincronizar' : 'Iniciar sesión y sincronizar'}</Text>}
        </Pressable>
      </> : <>
        <Text style={s.email}>{session.email}</Text>
        {!!lastSync && <Text style={s.small}>Última sincronización: {new Date(lastSync).toLocaleString('es-CO')}</Text>}
        <Pressable accessibilityRole="button" disabled={busy} onPress={() => void syncNow()} style={[s.primary, busy && s.disabled]}>
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={s.primaryText}>Sincronizar ahora</Text>}
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy} onPress={confirmSignOut} style={s.secondary}><Text style={s.secondaryText}>Cerrar sesión</Text></Pressable>
      </>}
      {!!message && <Text accessibilityLiveRegion="polite" style={s.message}>{message}</Text>}
    </View>
    <View style={s.note}><Text style={s.noteTitle}>Sobre las facturas</Text><Text style={s.body}>La bitácora y los datos se sincronizan. Las fotos de facturas siguen guardadas solo en este teléfono por ahora.</Text></View>
    <Link href="/(tabs)" style={s.back}>Volver al resumen</Link>
  </ScrollView>;
}

const s = StyleSheet.create({
  page: { flexGrow: 1, backgroundColor: '#f4f7f4', padding: 20, gap: 16, paddingBottom: 36 },
  eyebrow: { color: '#16805f', fontWeight: '700', letterSpacing: 1.4, marginTop: 8 }, title: { color: '#142b25', fontSize: 30, fontWeight: '800' },
  card: { backgroundColor: '#fff', borderRadius: 18, padding: 18, gap: 11 }, heading: { color: '#142b25', fontSize: 19, fontWeight: '700' }, body: { color: '#62756f', lineHeight: 20 },
  switches: { flexDirection: 'row', gap: 8, marginVertical: 4 }, mode: { flex: 1, alignItems: 'center', borderWidth: 1, borderColor: '#cad7d1', padding: 10, borderRadius: 10 }, modeActive: { backgroundColor: '#e8f3ed', borderColor: '#16805f' }, modeText: { color: '#526a63', fontWeight: '600' }, modeActiveText: { color: '#126b51', fontWeight: '700' },
  label: { color: '#526a63', fontWeight: '600', marginTop: 2 }, input: { borderWidth: 1, borderColor: '#cbd8d2', borderRadius: 11, paddingHorizontal: 13, paddingVertical: 12, color: '#142b25', backgroundColor: '#fff' },
  small: { color: '#71817b', fontSize: 12, lineHeight: 17 }, primary: { backgroundColor: '#126b51', padding: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', minHeight: 48, marginTop: 4 }, primaryText: { color: '#fff', fontWeight: '700', textAlign: 'center' }, disabled: { opacity: 0.6 },
  email: { color: '#142b25', fontWeight: '700' }, secondary: { alignItems: 'center', padding: 12 }, secondaryText: { color: '#b33b3b', fontWeight: '600' }, message: { color: '#126b51', fontSize: 13, lineHeight: 18 }, note: { backgroundColor: '#e8f3ed', borderRadius: 15, padding: 16, gap: 6 }, noteTitle: { color: '#174a38', fontWeight: '700' }, back: { color: '#126b51', textAlign: 'center', fontWeight: '700', padding: 10 },
});
