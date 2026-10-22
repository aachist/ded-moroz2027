import { ActivityTypeConfig } from '../types';

// Виды праздника (предлагаются при создании записи)
export const ACTIVITY_TYPES: Record<string, ActivityTypeConfig> = {
  kids: {
    name: 'Дети',
    color: '#ef4444',
    bgLight: 'rgba(239, 68, 68, 0.12)',
    textColor: '#b91c1c',
  },
  adults: {
    name: 'Взрослые',
    color: '#2563eb',
    bgLight: 'rgba(37, 99, 235, 0.12)',
    textColor: '#1d4ed8',
  },

  // Прежние виды занятости: остаются только для записей, созданных раньше,
  // в списке выбора и в легенде не показываются.
  work: {
    name: 'Работа',
    color: '#4f8ef7',
    bgLight: 'rgba(79, 142, 247, 0.12)',
    textColor: '#1d4ed8',
    legacy: true,
  },
  study: {
    name: 'Учёба',
    color: '#9b59f6',
    bgLight: 'rgba(155, 89, 246, 0.12)',
    textColor: '#6d28d9',
    legacy: true,
  },
  sport: {
    name: 'Спорт',
    color: '#10b981',
    bgLight: 'rgba(16, 185, 129, 0.12)',
    textColor: '#047857',
    legacy: true,
  },
  rest: {
    name: 'Отдых',
    color: '#f59e0b',
    bgLight: 'rgba(245, 158, 11, 0.12)',
    textColor: '#b45309',
    legacy: true,
  },
  personal: {
    name: 'Личные дела',
    color: '#ec4899',
    bgLight: 'rgba(236, 72, 153, 0.12)',
    textColor: '#be185d',
    legacy: true,
  },
  other: {
    name: 'Другое',
    color: '#64748b',
    bgLight: 'rgba(100, 116, 139, 0.12)',
    textColor: '#334155',
    legacy: true,
  },
};

/** Виды, которые можно выбрать при создании новой записи. */
export const SELECTABLE_TYPES = Object.entries(ACTIVITY_TYPES).filter(([, cfg]) => !cfg.legacy);
