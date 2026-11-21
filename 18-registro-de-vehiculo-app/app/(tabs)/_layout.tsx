import { Tabs } from 'expo-router';
export default function TabsLayout() {
  return <Tabs screenOptions={{ headerStyle: { backgroundColor: '#10231f' }, headerTintColor: '#fff', tabBarActiveTintColor: '#138a63' }}>
    <Tabs.Screen name="index" options={{ title: 'Resumen', tabBarLabel: 'Inicio' }} />
    <Tabs.Screen name="vehiculos" options={{ title: 'Vehículos' }} />
    <Tabs.Screen name="tanqueos" options={{ title: 'Tanqueos' }} />
    <Tabs.Screen name="mantenimiento" options={{ title: 'Mantenimiento' }} />
  </Tabs>;
}
