'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { Footer } from '@/components/Footer';
import { Eye, EyeSlash, Warning, Broadcast, VideoCamera, ChatCircle, Archive } from '@phosphor-icons/react';

const ADMIN_HOST_PREFIX = 'admin.';

/**
 * Имя хоста, на котором на самом деле живёт раздел этой роли, либо null, если
 * менять адрес не нужно. Админка отвечает только на `admin.<домен>`, кабинет
 * организации — только на основном.
 *
 * Разъехались они ради cookie: те ставятся host-only, поэтому две роли могут
 * держать сессии одновременно, но и перенести уже выданную сессию на соседнее
 * имя нельзя — войти придётся там, где раздел живёт.
 *
 * Локальная разработка сюда не попадает: у `localhost` нет точки в имени, а
 * поддомена нет и подавно — оба раздела остаются на одном адресе.
 */
function hostForRole(role: string, host: string): string | null {
  if (!host.includes('.')) return null;
  const onAdminHost = host.startsWith(ADMIN_HOST_PREFIX);
  if (role === 'superadmin' && !onAdminHost) return ADMIN_HOST_PREFIX + host;
  if (role !== 'superadmin' && onAdminHost) return host.slice(ADMIN_HOST_PREFIX.length);
  return null;
}

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [movedHost, setMovedHost] = useState(false);

  // Метку о переезде читаем из адреса уже после гидрации: страница статическая,
  // а useSearchParams потребовал бы оборачивать её в Suspense.
  useEffect(() => {
    setMovedHost(new URLSearchParams(window.location.search).has('moved'));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ role: string }>('/v1/auth/login', { login, password });
      const target = hostForRole(res.role, window.location.host);
      if (target) {
        // Сессию на этом имени гасим: она бесполезна (раздел живёт на другом
        // адресе), но шапка по ней предлагала бы ссылку в чужой раздел.
        await api.post('/v1/auth/logout', {});
        window.location.href = `https://${target}/login?moved=1`;
        return;
      }
      router.push(res.role === 'superadmin' ? '/admin' : '/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Неверный логин или пароль');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex flex-col">
      <div className="flex-1 flex">
        {/* Left panel — branding */}
        <div className="hidden lg:flex lg:w-1/2 bg-surface-primary relative overflow-hidden">
          {/* Decorative gradient blobs */}
          <div className="absolute -top-40 -left-40 w-96 h-96 bg-brand/8 rounded-full blur-3xl" />
          <div className="absolute -bottom-32 -right-32 w-80 h-80 bg-brand/5 rounded-full blur-3xl" />

          <div className="relative z-10 flex flex-col justify-between p-12 w-full max-w-lg mx-auto">
            <Link href="/" className="text-zinc-50 no-underline font-semibold text-xl tracking-tight">
              Liga Live
            </Link>

            <div className="space-y-8">
              <div>
                <h1 className="text-4xl font-bold text-zinc-50 tracking-tight leading-[1.1]">
                  Управляйте трансляциями спортивных событий
                </h1>
                <p className="text-zinc-500 mt-4 leading-relaxed max-w-md">
                  Профессиональная платформа для организаций, проводящих спортивные мероприятия. Мультикамерный стриминг, чат и архив записей.
                </p>
              </div>

              <div className="space-y-4">
                {[
                  { icon: VideoCamera, text: 'Мультикамерная трансляция в 4K' },
                  { icon: ChatCircle, text: 'Чат со зрителями в реальном времени' },
                  { icon: Archive, text: 'Автоматический архив всех трансляций' },
                  { icon: Broadcast, text: 'Простая настройка через SRT-протокол' },
                ].map(({ icon: Icon, text }) => (
                  <div key={text} className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-surface-elevated border border-zinc-800/60 flex items-center justify-center shrink-0">
                      <Icon size={18} className="text-brand" weight="duotone" />
                    </div>
                    <span className="text-sm text-zinc-400">{text}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Копирайт уехал в футер: две одинаковые строки на одном экране
                выглядели бы опечаткой. Слот занимает то, что организации здесь
                и правда стоит прочитать. */}
            <p className="text-xs text-zinc-700 leading-relaxed max-w-md">
              Выполняя вход, вы принимаете{' '}
              <Link href="/legal/terms" className="text-zinc-600 hover:text-zinc-400 no-underline transition-colors">
                пользовательское соглашение
              </Link>{' '}
              и{' '}
              <Link href="/legal/privacy" className="text-zinc-600 hover:text-zinc-400 no-underline transition-colors">
                политику конфиденциальности
              </Link>
              .
            </p>
          </div>
        </div>

        {/* Right panel — login form */}
        <div className="flex-1 flex flex-col bg-surface-elevated lg:bg-surface-card">
          {/* Mobile header */}
          <div className="lg:hidden flex items-center justify-between p-4 border-b border-zinc-800/40">
            <Link href="/" className="text-zinc-50 no-underline font-semibold text-lg tracking-tight">
              Liga Live
            </Link>
          </div>

          <div className="flex-1 flex items-center justify-center px-6 py-12">
            <div className="w-full max-w-sm">
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-zinc-50 tracking-tight">Вход в аккаунт</h2>
                <p className="text-sm text-zinc-500 mt-2">Войдите в панель управления организации</p>
              </div>

              <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-zinc-400">Логин</label>
                  <input
                    value={login}
                    onChange={(e) => setLogin(e.target.value)}
                    placeholder="Логин организации"
                    className="px-4 py-3 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors"
                    required
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-zinc-400">Пароль</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Пароль"
                      className="w-full px-4 py-3 pr-11 bg-surface-primary border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:border-brand focus:ring-1 focus:ring-brand/30 outline-none transition-colors"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600 hover:text-zinc-400 transition-colors bg-transparent border-none cursor-pointer p-1"
                    >
                      {showPassword ? <EyeSlash size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                {movedHost && !error && (
                  <div className="flex items-start gap-2 text-sm text-zinc-400 bg-zinc-400/5 border border-zinc-400/10 rounded-lg px-3 py-2.5">
                    <Warning size={16} weight="fill" className="shrink-0 mt-0.5" />
                    <span>Этот раздел живёт на другом адресе — мы вас сюда перевели. Войдите ещё раз: сессии на разных адресах независимы.</span>
                  </div>
                )}

                {error && (
                  <div className="flex items-center gap-2 text-sm text-red-400 bg-red-400/5 border border-red-400/10 rounded-lg px-3 py-2.5">
                    <Warning size={16} weight="fill" className="shrink-0" />
                    {error}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="py-3 bg-brand hover:bg-brand-hover text-white font-semibold rounded-lg transition-all duration-200 active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer mt-1"
                >
                  {loading ? 'Вход...' : 'Войти'}
                </button>
              </form>

              <p className="text-xs text-zinc-600 mt-6 text-center">
                Нет аккаунта?{' '}
                <Link href="/#contact" className="text-brand hover:text-brand-hover no-underline transition-colors">
                  Оставить заявку
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
      <Footer variant="compact" />
    </div>
  );
}
