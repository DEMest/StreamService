import { Header } from './Header';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#0a0a0a', color: '#fff' }}>
      <Header />
      <main style={{ flex: 1 }}>{children}</main>
    </div>
  );
}
