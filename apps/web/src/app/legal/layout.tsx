import { Header } from '@/components/Header';
import { Footer } from '@/components/Footer';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-surface-primary text-zinc-200">
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
