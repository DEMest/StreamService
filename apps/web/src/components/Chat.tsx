'use client';
import { useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { NicknameModal } from './NicknameModal';

interface Message { id: string; nickname: string; content: string; createdAt: string }

interface Props {
  orgSlug: string;
  onViewersChange?: (count: number) => void;
}

export function Chat({ orgSlug, onViewersChange }: Props) {
  const [nickname, setNickname] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const onViewersRef = useRef(onViewersChange);
  useEffect(() => { onViewersRef.current = onViewersChange; });

  useEffect(() => {
    const saved = localStorage.getItem('chat_nickname');
    if (saved) setNickname(saved);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    socket.emit('join', { orgSlug });
    const onHistory = (msgs: Message[]) => setMessages(msgs);
    const onMessage = (msg: Message) => setMessages((prev) => [...prev, msg]);
    const onViewers = (count: number) => onViewersRef.current?.(count);
    socket.on('history', onHistory);
    socket.on('message', onMessage);
    socket.on('viewers', onViewers);
    return () => {
      socket.off('history', onHistory);
      socket.off('message', onMessage);
      socket.off('viewers', onViewers);
    };
  }, [orgSlug]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  function handleNicknameConfirm(name: string) {
    localStorage.setItem('chat_nickname', name);
    setNickname(name);
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || !nickname) return;
    getSocket().emit('message', { orgSlug, nickname, content: input.trim() });
    setInput('');
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#111' }}>
      {!nickname && <NicknameModal onConfirm={handleNicknameConfirm} />}
      <div style={{ flex: 1, overflowY: 'auto', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {messages.map((m) => (
          <div key={m.id}>
            <span style={{ color: '#2563eb', fontWeight: 600, fontSize: '0.8rem' }}>{m.nickname}: </span>
            <span style={{ color: '#ddd', fontSize: '0.875rem' }}>{m.content}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={handleSend} style={{ display: 'flex', borderTop: '1px solid #222', padding: '0.5rem' }}>
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          placeholder="Сообщение..."
          maxLength={500}
          style={{ flex: 1, padding: '0.5rem', background: '#0a0a0a', border: 'none', color: '#fff', borderRadius: '4px 0 0 4px' }}
        />
        <button type="submit" style={{ padding: '0.5rem 1rem', background: '#2563eb', color: '#fff', border: 'none', borderRadius: '0 4px 4px 0', cursor: 'pointer' }}>
          →
        </button>
      </form>
    </div>
  );
}
