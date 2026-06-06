'use client';
import { useEffect, useRef, useState } from 'react';
import { getSocket } from '@/lib/socket';
import { NicknameModal } from './NicknameModal';
import { PaperPlaneRight, ChatCircle, Lock } from '@phosphor-icons/react';

interface Message { id: string; nickname: string; content: string; createdAt: string }

interface Props {
  orgSlug: string;
  /**
   * Named Stream slug. Пустая строка/undefined ⇒ default Stream орги
   * (backward-compat). Каждый Stream имеет изолированную чат-комнату
   * (room key = `org:<orgSlug>:stream:<streamSlug | 'default'>`),
   * поэтому viewer-count и сообщения не пересекаются между Stream'ами
   * одной орги.
   */
  streamSlug?: string;
  onViewersChange?: (count: number) => void;
  authorName?: string;
  authLoading?: boolean;
}

export function Chat({ orgSlug, streamSlug, onViewersChange, authorName, authLoading }: Props) {
  const [nickname, setNickname] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [nicknameModalOpen, setNicknameModalOpen] = useState(false);
  const [ttlMinutes, setTtlMinutes] = useState(180);
  const [chatEnabled, setChatEnabled] = useState(true);
  const pendingContentRef = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const onViewersRef = useRef(onViewersChange);
  useEffect(() => { onViewersRef.current = onViewersChange; });

  useEffect(() => {
    if (authorName) { setNickname(authorName); return; }
    const saved = localStorage.getItem('chat_nickname');
    if (saved) setNickname(saved);
  }, [authorName]);

  useEffect(() => {
    const socket = getSocket();

    function join() {
      socket.emit('join', { orgSlug, streamSlug: streamSlug ?? '' });
    }

    join();
    socket.on('connect', join);

    const onHistory = (msgs: Message[]) => setMessages(msgs);
    const onMessage = (msg: Message) => setMessages((prev) => {
      // Replace optimistic temp message with real one from server
      const tempIdx = prev.findIndex((m) => m.id.startsWith('_tmp_') && m.nickname === msg.nickname && m.content === msg.content);
      if (tempIdx !== -1) {
        const next = [...prev];
        next[tempIdx] = msg;
        return next;
      }
      return [...prev, msg];
    });
    const onViewers = (count: number) => onViewersRef.current?.(count);
    const onTtl = (mins: number) => { if (typeof mins === 'number' && mins > 0) setTtlMinutes(mins); };
    const onEnabled = (enabled: boolean) => setChatEnabled(enabled !== false);
    const onCleared = () => setMessages([]);
    socket.on('history', onHistory);
    socket.on('message', onMessage);
    socket.on('viewers', onViewers);
    socket.on('chat_ttl', onTtl);
    socket.on('chat_enabled', onEnabled);
    socket.on('chat_cleared', onCleared);
    return () => {
      socket.off('connect', join);
      socket.off('history', onHistory);
      socket.off('message', onMessage);
      socket.off('viewers', onViewers);
      socket.off('chat_ttl', onTtl);
      socket.off('chat_enabled', onEnabled);
      socket.off('chat_cleared', onCleared);
    };
  }, [orgSlug, streamSlug]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Auto-prune messages older than configured TTL
  useEffect(() => {
    const interval = setInterval(() => {
      const cutoff = Date.now() - ttlMinutes * 60 * 1000;
      setMessages((prev) => prev.filter((m) => new Date(m.createdAt).getTime() > cutoff));
    }, 30_000);
    return () => clearInterval(interval);
  }, [ttlMinutes]);

  function sendMessage(content: string, nick: string) {
    const tempId = `_tmp_${Date.now()}`;
    setMessages((prev) => [...prev, { id: tempId, nickname: nick, content, createdAt: new Date().toISOString() }]);
    getSocket().emit('message', { orgSlug, streamSlug: streamSlug ?? '', nickname: nick, content });
  }

  function handleNicknameConfirm(name: string) {
    localStorage.setItem('chat_nickname', name);
    setNickname(name);
    setNicknameModalOpen(false);
    const pending = pendingContentRef.current;
    pendingContentRef.current = null;
    if (pending) {
      sendMessage(pending, name);
      setInput('');
    }
  }

  function handleNicknameCancel() {
    pendingContentRef.current = null;
    setNicknameModalOpen(false);
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!chatEnabled) return;
    const content = input.trim();
    if (!content) return;
    if (!nickname) {
      pendingContentRef.current = content;
      setNicknameModalOpen(true);
      return;
    }
    sendMessage(content, nickname);
    setInput('');
  }

  return (
    <div className="flex flex-col h-full bg-surface-elevated">
      {nicknameModalOpen && <NicknameModal onConfirm={handleNicknameConfirm} onCancel={handleNicknameCancel} />}

      <div className="flex-1 overflow-y-auto p-3 space-y-1 scrollbar-thin">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 opacity-40">
            <ChatCircle size={28} className="text-zinc-600" />
            <span className="text-xs text-zinc-600">Чат пуст</span>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className="leading-snug">
            <span className="text-brand font-semibold text-xs">{m.nickname}: </span>
            <span className="text-zinc-300 text-sm">{m.content}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {chatEnabled ? (
        <form onSubmit={handleSend} className="border-t border-zinc-800/60 p-2 flex gap-1.5">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Сообщение..."
            maxLength={500}
            className="flex-1 px-3 py-2 bg-surface-primary border-none rounded-lg text-sm text-zinc-200 placeholder:text-zinc-600 focus:ring-1 focus:ring-brand/30 outline-none transition-colors"
          />
          <button
            type="submit"
            className="p-2 bg-brand hover:bg-brand-hover text-white rounded-lg transition-all duration-200 active:scale-95"
          >
            <PaperPlaneRight size={16} weight="fill" />
          </button>
        </form>
      ) : (
        <div className="border-t border-zinc-800/60 p-3 flex items-center justify-center gap-2 bg-surface-primary/40">
          <Lock size={14} className="text-zinc-500" />
          <span className="text-xs text-zinc-400">Чат временно отключён организатором</span>
        </div>
      )}
    </div>
  );
}
