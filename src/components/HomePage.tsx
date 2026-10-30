import React from 'react';
import { PageKey, PAGE_LABELS } from '../nav';
import { NewYearCountdown } from './NewYearCountdown';
import { Phone } from 'lucide-react';

interface HomePageProps {
  setPage: (p: PageKey) => void;
  phoneHref: string;
  isAdmin: boolean;
}

interface CardDef {
  page: PageKey;
  emoji: string;
  hint: string;
  gradient: string;
}

const CARDS: CardDef[] = [
  {
    page: 'schedule',
    emoji: '📅',
    hint: 'Выберите свободное время и оставьте заявку',
    gradient: 'linear-gradient(135deg, #e0564f 0%, #b82e29 100%)',
  },
  {
    page: 'media',
    emoji: '🎬',
    hint: 'Фото и видео с настоящих встреч',
    gradient: 'linear-gradient(135deg, #7452c8 0%, #4c3191 100%)',
  },
  {
    page: 'variants',
    emoji: '🎁',
    hint: 'Какие бывают программы и что в них входит',
    gradient: 'linear-gradient(135deg, #2d6fd0 0%, #1f4097 100%)',
  },
  {
    page: 'rules',
    emoji: '📜',
    hint: 'Что важно знать перед встречей',
    gradient: 'linear-gradient(135deg, #3f9e6a 0%, #25704a 100%)',
  },
  {
    page: 'reviews',
    emoji: '💬',
    hint: 'Что говорят семьи, которых уже навестил Дед Мороз',
    gradient: 'linear-gradient(135deg, #e8923a 0%, #c0651a 100%)',
  },
  {
    page: 'contacts',
    emoji: '📞',
    hint: 'Позвонить, написать, подписаться на канал',
    gradient: 'linear-gradient(135deg, #8a4fc0 0%, #5d2c94 100%)',
  },
];

export const HomePage: React.FC<HomePageProps> = ({ setPage, phoneHref, isAdmin }) => (
  <div className="space-y-8">
    {/* Баннер: фото ёлки с игрушками */}
    <section className="hero-photo snow rounded-[2rem] text-white text-center px-5 py-12 sm:py-20 shadow-xl">
      <div className="relative z-10 max-w-2xl mx-auto">
        <div className="text-5xl sm:text-6xl mb-3 drop-shadow-lg">🎅🎄</div>
        <h1 className="text-3xl sm:text-5xl font-bold leading-tight mb-3">Вызов Деда Мороза</h1>
        <p className="text-base sm:text-lg text-white/90 mb-7">
          Настоящая встреча с волшебством для детей и взрослых. Выберите удобное время, и праздник придёт к вам!
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={() => setPage('schedule')} className="btn-lime text-base">
            📅 Записаться на вызов
          </button>
          {phoneHref ? (
            <a
              href={phoneHref}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/15 hover:bg-white/25 font-bold border border-white/30 cursor-pointer"
            >
              <Phone className="w-4 h-4" />
              Позвонить Деду Морозу
            </a>
          ) : (
            <button
              type="button"
              onClick={() => setPage('contacts')}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/15 hover:bg-white/25 font-bold border border-white/30 cursor-pointer"
            >
              <Phone className="w-4 h-4" />
              Позвонить Деду Морозу
            </button>
          )}
        </div>
      </div>
    </section>

    {/* Отсчёт до Нового года */}
    <NewYearCountdown />

    {/* Разделы */}
    <section>
      <h2 className="text-2xl font-bold text-brand-deep text-center mb-5">Всё о встрече с Дедом Морозом</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CARDS.map((c) => (
          <button
            key={c.page}
            type="button"
            onClick={() => setPage(c.page)}
            className="menu-card"
            style={{ background: c.gradient }}
          >
            <span className="menu-emoji">{c.emoji}</span>
            <span className="font-display font-bold text-lg leading-snug">{PAGE_LABELS[c.page]}</span>
            <span className="text-sm text-white/85 leading-snug">{c.hint}</span>
            <span className="absolute -right-3 -bottom-4 text-8xl opacity-10 select-none">{c.emoji}</span>
          </button>
        ))}
      </div>

      {isAdmin && (
        <div className="mt-5">
          <button
            type="button"
            onClick={() => setPage('help')}
            className="w-full rounded-2xl border-2 border-dashed border-brand/30 text-brand font-bold py-3 hover:bg-brand/5 cursor-pointer"
          >
            📖 Инструкция и резервные копии (для администратора)
          </button>
        </div>
      )}
    </section>
  </div>
);
