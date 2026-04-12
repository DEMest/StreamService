'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await api.post<{ role: string }>('/v1/auth/login', { login, password });
      router.push(res.role === 'superadmin' ? '/admin' : '/dashboard');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Неверный логин или пароль');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#0a0a0a' }}>
      <form onSubmit={handleSubmit} style={{ background: '#1a1a1a', padding: '2rem', borderRadius: '8px', width: '320px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <h1 style={{ color: '#fff', margin: 0, fontSize: '1.25rem' }}>StreamService</h1>
        <input
          value={login} onChange={(e) => setLogin(e.target.value)}
          placeholder="Логин организации"
          style={{ padding: '0.75rem', borderRadius: '4px', border: '1px solid #333', background: '#0a0a0a', color: '#fff' }}
          required
        />
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          placeholder="Пароль"
          style={{ padding: '0.75rem', borderRadius: '4px', border: '1px solid #333', background: '#0a0a0a', color: '#fff' }}
          required
        />
        {error && <p style={{ color: '#ff4444', margin: 0, fontSize: '0.875rem' }}>{error}</p>}
        <button type="submit" disabled={loading}
          style={{ padding: '0.75rem', borderRadius: '4px', background: '#e53', color: '#fff', border: 'none', cursor: loading ? 'not-allowed' : 'pointer', fontWeight: 600 }}>
          {loading ? 'Вход...' : 'Войти'}
        </button>
      </form>
    </div>
  );
}
