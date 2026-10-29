import React from 'react';

/**
 * Простое оформление текста, которое вводит администратор (HTML не используется, поэтому безопасно):
 *   # Заголовок          — крупный заголовок
 *   ## Подзаголовок      — подзаголовок
 *   - пункт              — маркированный список (также «• пункт»)
 *   **жирный текст**     — жирный шрифт
 *   пустая строка        — новый абзац
 *   https://адрес        — становится ссылкой
 */
export type Block =
  | { type: 'h1' | 'h2'; text: string }
  | { type: 'p'; lines: string[] }
  | { type: 'ul'; items: string[] };

export function parseRichText(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ type: 'p', lines: para });
    para = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ type: 'ul', items: list });
    list = [];
  };

  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flushPara();
      flushList();
      continue;
    }
    const h2 = /^##\s+(.+)$/.exec(line);
    const h1 = /^#\s+(.+)$/.exec(line);
    const li = /^\s*(?:[-•*])\s+(.+)$/.exec(line);
    if (h2) {
      flushPara();
      flushList();
      blocks.push({ type: 'h2', text: h2[1].trim() });
    } else if (h1) {
      flushPara();
      flushList();
      blocks.push({ type: 'h1', text: h1[1].trim() });
    } else if (li) {
      flushPara();
      list.push(li[1].trim());
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return blocks;
}

/** Жирный текст и ссылки внутри строки */
function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s<]+)/g).map((part, i) => {
    const key = `${keyPrefix}-${i}`;
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={key}>{part.slice(2, -2)}</strong>;
    if (/^https?:\/\//.test(part)) {
      return (
        <a key={key} href={part} target="_blank" rel="noopener noreferrer" className="text-brand underline break-all">
          {part}
        </a>
      );
    }
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

export const RichText: React.FC<{ text: string }> = ({ text }) => {
  const blocks = parseRichText(text);
  return (
    <div className="space-y-4 text-slate-700 leading-relaxed">
      {blocks.map((b, i) => {
        if (b.type === 'h1') {
          return (
            <h2 key={i} className="text-2xl font-bold text-brand-deep pt-2">
              {renderInline(b.text, `h${i}`)}
            </h2>
          );
        }
        if (b.type === 'h2') {
          return (
            <h3 key={i} className="text-lg font-bold text-brand pt-1">
              {renderInline(b.text, `h${i}`)}
            </h3>
          );
        }
        if (b.type === 'ul') {
          return (
            <ul key={i} className="space-y-2">
              {b.items.map((it, j) => (
                <li key={j} className="flex gap-3">
                  <span className="mt-2 w-2 h-2 rounded-full bg-lime shrink-0 ring-2 ring-lime/30" />
                  <span>{renderInline(it, `l${i}-${j}`)}</span>
                </li>
              ))}
            </ul>
          );
        }
        if (b.type !== 'p') return null;
        return (
          <p key={i}>
            {b.lines.map((ln, j) => (
              <React.Fragment key={j}>
                {j > 0 && <br />}
                {renderInline(ln, `p${i}-${j}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
};
