'use client';

import Link from 'next/link';
import { motion } from 'framer-motion';
import { Header } from '@/components/Header';
import { ContactForm } from '@/components/ContactForm';
import { InteractiveDemo } from '@/components/InteractiveDemo';
import { fadeUp, staggerContainer, cardFadeUp, scaleIn } from '@/lib/motion';
import {
  Broadcast, VideoCamera, Gauge, Archive, ArrowRight,
} from '@phosphor-icons/react';

const FEATURES = [
  {
    icon: VideoCamera,
    title: 'Мультикамерный стриминг',
    desc: 'До 4 камер в одном потоке. Зрители переключают ракурсы прямо в браузере \u2014 без задержки и перезагрузки плеера.',
    large: true,
  },
  {
    icon: Gauge,
    title: '4K без транскодинга',
    desc: 'Прямая трансляция в максимальном качестве через SRT-протокол с минимальной задержкой.',
  },
  {
    icon: Archive,
    title: 'Полный архив записей',
    desc: 'Все трансляции сохраняются автоматически. Зрители могут пересмотреть любой момент.',
  },
];

const STEPS = [
  {
    num: '01',
    title: 'Подключите видеомикшер',
    desc: 'Настройте vMix или OBS с 4 камерами и отправьте один SRT-поток на платформу.',
  },
  {
    num: '02',
    title: 'Создайте событие',
    desc: 'В панели управления создайте трансляцию, настройте приватность и поделитесь ссылкой.',
  },
  {
    num: '03',
    title: 'Зрители управляют',
    desc: 'Зрители открывают страницу в браузере и переключают камеры самостоятельно.',
  },
];

export default function HomePage() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-surface-primary text-zinc-200">
      <Header />

      {/* ── Hero ───────────────────────────────────────────── */}
      <section className="relative lg:min-h-[100dvh] lg:flex lg:items-center overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] bg-brand/6 rounded-full blur-[150px] pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 w-[300px] h-[300px] bg-brand/4 rounded-full blur-[100px] pointer-events-none" />

        <motion.div
          className="relative max-w-[1400px] mx-auto px-6 py-16 md:py-24 lg:py-32 w-full grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-10 lg:gap-14 lg:items-center"
          initial="hidden"
          animate="visible"
          variants={staggerContainer}
        >
          {/* Left ─ text */}
          <div>
            <motion.div variants={scaleIn} className="mb-6">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 bg-brand/10 border border-brand/20 rounded-full text-xs font-medium text-brand">
                <Broadcast size={12} weight="fill" className="animate-pulse" />
                Стриминговая платформа
              </span>
            </motion.div>

            <motion.h1
              variants={fadeUp}
              className="text-4xl md:text-6xl font-bold text-zinc-50 tracking-tight leading-[1.08] mb-6"
            >
              Прямые трансляции
              <br />
              <span className="text-brand">спортивных</span> мероприятий
            </motion.h1>

            <motion.p
              variants={fadeUp}
              className="text-base md:text-lg text-zinc-400 leading-relaxed mb-10 max-w-lg"
            >
              Liga Live — профессиональная платформа для организаций.
              Мультикамерный стриминг, управление событиями и полный архив записей.
            </motion.p>

            <motion.div variants={fadeUp} className="flex flex-wrap gap-3">
              <Link
                href="/streams"
                className="flex items-center gap-2 px-7 py-3.5 bg-brand hover:bg-brand-hover text-white font-semibold rounded-lg transition-all duration-200 active:scale-[0.98] no-underline"
              >
                Смотреть трансляции
                <ArrowRight size={16} weight="bold" />
              </Link>
              <a
                href="#contact"
                className="flex items-center gap-2 px-7 py-3.5 bg-zinc-800/80 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg transition-all duration-200 active:scale-[0.98] no-underline border border-zinc-700/50"
              >
                Подключить организацию
              </a>
            </motion.div>
          </div>

          {/* Right ─ interactive demo */}
          <motion.div variants={fadeUp}>
            <InteractiveDemo />
          </motion.div>
        </motion.div>

        {/* Scroll indicator — desktop only */}
        <motion.div
          className="hidden lg:block absolute bottom-8 left-1/2 -translate-x-1/2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.2 }}
        >
          <div className="w-5 h-8 rounded-full border-2 border-zinc-600 flex items-start justify-center pt-1.5">
            <motion.div
              className="w-1 h-1.5 rounded-full bg-zinc-400"
              animate={{ y: [0, 8, 0] }}
              transition={{ repeat: Infinity, duration: 1.8, ease: 'easeInOut' }}
            />
          </div>
        </motion.div>
      </section>

      {/* ── How It Works ───────────────────────────────────── */}
      <motion.section
        className="py-20 md:py-28 border-t border-zinc-800/40"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        variants={staggerContainer}
      >
        <div className="max-w-[1400px] mx-auto px-6">
          <motion.div variants={fadeUp} className="mb-10">
            <h2 className="text-2xl md:text-3xl font-bold text-zinc-50 tracking-tight mb-3">Как это работает</h2>
            <p className="text-sm text-zinc-500 max-w-md">От подключения камер до зрителей за три шага</p>
          </motion.div>

          <div className="divide-y divide-zinc-800/40">
            {STEPS.map((s, i) => (
              <motion.div
                key={i}
                variants={fadeUp}
                className="py-6 first:pt-0 last:pb-0 grid grid-cols-1 md:grid-cols-[48px_200px_1fr] gap-2 md:gap-6 items-baseline"
              >
                <span className="text-xl font-bold text-brand/30 font-mono">{s.num}</span>
                <h3 className="text-sm font-semibold text-zinc-100">{s.title}</h3>
                <p className="text-sm text-zinc-500 leading-relaxed">{s.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ── Features ───────────────────────────────────────── */}
      <motion.section
        className="py-20 md:py-28 border-t border-zinc-800/40"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        variants={staggerContainer}
      >
        <div className="max-w-[1400px] mx-auto px-6">
          <motion.div variants={fadeUp} className="mb-12">
            <h2 className="text-2xl md:text-3xl font-bold text-zinc-50 tracking-tight mb-3">Возможности платформы</h2>
            <p className="text-sm text-zinc-500 max-w-md">Всё необходимое для профессиональных спортивных трансляций</p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.title}
                variants={cardFadeUp}
                className={i === 0 ? 'md:row-span-2' : ''}
              >
                <div className={`h-full p-6 ${i === 0 ? 'md:p-8' : ''} rounded-xl bg-surface-elevated border border-zinc-800/40 hover:border-zinc-700/60 transition-colors group`}>
                  <div className={`${i === 0 ? 'w-12 h-12' : 'w-10 h-10'} rounded-lg bg-brand/10 flex items-center justify-center mb-4 group-hover:bg-brand/15 transition-colors`}>
                    <f.icon size={i === 0 ? 26 : 22} className="text-brand" weight="duotone" />
                  </div>
                  <h3 className={`${i === 0 ? 'text-lg' : 'text-sm'} font-semibold text-zinc-100 mb-2`}>{f.title}</h3>
                  <p className={`${i === 0 ? 'text-sm' : 'text-xs'} text-zinc-500 leading-relaxed`}>{f.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </motion.section>

      {/* ── Contact Form ───────────────────────────────────── */}
      <motion.section
        id="contact"
        className="py-20 md:py-28 border-t border-zinc-800/40"
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-80px' }}
        variants={staggerContainer}
      >
        <div className="max-w-[800px] mx-auto px-6">
          <motion.div variants={fadeUp} className="mb-10">
            <h2 className="text-2xl md:text-3xl font-bold text-zinc-50 tracking-tight mb-3">Подключите вашу организацию</h2>
            <p className="text-sm text-zinc-500 max-w-md">Оставьте заявку и мы свяжемся с вами для обсуждения деталей подключения</p>
          </motion.div>

          <motion.div variants={fadeUp} className="bg-surface-elevated border border-zinc-800/50 rounded-xl p-6 md:p-8">
            <ContactForm />
          </motion.div>
        </div>
      </motion.section>

      {/* ── Footer ─────────────────────────────────────────── */}
      <footer className="border-t border-zinc-800/40 py-8">
        <div className="max-w-[1400px] mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-xs text-zinc-600">&copy; {new Date().getFullYear()} Liga Live. Все права защищены.</span>
          <div className="flex items-center gap-4">
            <Link href="/streams" className="text-xs text-zinc-600 hover:text-zinc-400 no-underline transition-colors">Трансляции</Link>
            <Link href="/login" className="text-xs text-zinc-600 hover:text-zinc-400 no-underline transition-colors">Вход для организаций</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
