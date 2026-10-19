import { ActivityTypeConfig } from '../types';

export const ACTIVITY_TYPES: Record<string, ActivityTypeConfig> = {
  work: {
    name: 'Работа',
    color: '#4f8ef7',
    bgLight: 'rgba(79, 142, 247, 0.12)',
    textColor: '#1d4ed8',
  },
  study: {
    name: 'Учёба',
    color: '#9b59f6',
    bgLight: 'rgba(155, 89, 246, 0.12)',
    textColor: '#6d28d9',
  },
  sport: {
    name: 'Спорт',
    color: '#10b981',
    bgLight: 'rgba(16, 185, 129, 0.12)',
    textColor: '#047857',
  },
  rest: {
    name: 'Отдых',
    color: '#f59e0b',
    bgLight: 'rgba(245, 158, 11, 0.12)',
    textColor: '#b45309',
  },
  personal: {
    name: 'Личные дела',
    color: '#ec4899',
    bgLight: 'rgba(236, 72, 153, 0.12)',
    textColor: '#be185d',
  },
  other: {
    name: 'Другое',
    color: '#64748b',
    bgLight: 'rgba(100, 116, 139, 0.12)',
    textColor: '#334155',
  },
};
