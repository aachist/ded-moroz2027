import React from 'react';
import { PHONE_LENGTH, formatNational, normalizePhoneInput } from '../utils/phone';

interface Props {
  /** Только национальные цифры (до 10), без +7. */
  value: string;
  onChange: (digits: string) => void;
  className?: string;
  name?: string;
  ariaLabel?: string;
  required?: boolean;
}

/** Поле телефона: «+7» подставлено заранее, клиент вводит 10 цифр, форматирование при вводе. */
export const PhoneField: React.FC<Props> = ({ value, onChange, className = '', name, ariaLabel = 'Телефон', required }) => (
  <div className={`flex items-stretch rounded-lg border border-slate-300 bg-white focus-within:ring-2 focus-within:ring-blue-500 ${className}`}>
    <span className="flex items-center pl-3 pr-1 text-sm font-semibold text-slate-700 select-none" aria-hidden="true">
      +7
    </span>
    <input
      type="tel"
      name={name}
      inputMode="tel"
      autoComplete="tel-national"
      aria-label={`${ariaLabel}: код +7, затем ${PHONE_LENGTH} цифр`}
      placeholder="(900) 111-22-33"
      required={required}
      value={formatNational(value)}
      onChange={(e) => onChange(normalizePhoneInput(e.target.value))}
      className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm outline-none"
    />
  </div>
);
