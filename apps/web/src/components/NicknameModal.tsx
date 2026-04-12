'use client';
import { useState } from 'react';

interface Props {
  onConfirm: (nickname: string) => void;
}

export function NicknameModal({ onConfirm }: Props) {
  const [value, setValue] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const name = value.trim();
    if (name) onConfirm(name);
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
      <form onSubmit={handleSubmit} style={{ background: '#1a1a1a', padding: '2rem', borderRadius: '8px', display: 'flex', flexDirection: 'column', gap: '1rem', minWidth: '280px' }}>
        <p style={{ color: '#fff', margin: 0, fontWeight: 600 }}>Введите никнейм для чата</p>
        <input
          autoFocus value={value} onChange={(e) => setValue(e.target.value)}
          maxLength={32} placeholder="Ваш никнейм"
          style={{ padding: '0.75rem', borderRadius: '4px', border: '1px solid #333', background: '#0a0a0a', color: '#fff' }}
          required
        />
        <button type="submit" style={{ padding: '0.75rem', borderRadius: '4px', background: '#2563eb', color: '#fff', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
          Войти в чат
        </button>
      </form>
    </div>
  );
}
