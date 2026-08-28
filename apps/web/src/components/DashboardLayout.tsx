import { Header } from './Header';
import { Footer } from './Footer';

export function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-surface-primary text-zinc-200">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer variant="compact" />
    </div>
  );
}
