import {useEffect, useRef, type ReactNode, useState} from 'react';
import {Coins, Droplets, Fuel, Leaf, TreePine, X} from 'lucide-react';
import type {Resource} from '../../shared/game';
import {useI18n} from '../lib/i18n';
export const RESOURCE_LABELS: Record<Resource, string> = {
  crude_oil: 'Crude oil',
  petrol: 'Petrol',
  rubber: 'Rubber',
  wood: 'Wood',
};
export const RESOURCE_ICONS = {crude_oil: Droplets, petrol: Fuel, rubber: Leaf, wood: TreePine};
export function GoodsIcon({resource, size = 22}: {resource: Resource; size?: number}) {
  const Icon = RESOURCE_ICONS[resource];
  return <Icon size={size} />;
}
export function Money({value}: {value: number}) {
  const {t, formatNumber} = useI18n();
  return (
    <span className="coin-value" title={t('Worldo coins')}>
      <Coins size={16} />
      {formatNumber(value, {maximumFractionDigits: 0})}
      <small>{t('coins')}</small>
    </span>
  );
}
/** The coin pouch counts up to a new balance just as the flying coins arrive. */
export function CountingMoney({value}: {value: number}) {
  const [shown, setShown] = useState(value),
    current = useRef(value);
  useEffect(() => {
    const start = current.current;
    if (value <= start || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      current.current = value;
      setShown(value);
      return;
    }
    const began = performance.now() + 700;
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - began) / 1000)),
        next = Math.round(start + (value - start) * (1 - (1 - progress) ** 3));
      current.current = next;
      setShown(next);
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return <Money value={shown} />;
}
export function Meter({value, label, className = ''}: {value: number; label: string; className?: string}) {
  return (
    <div
      className={`meter ${className}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
    >
      <span style={{width: `${Math.max(0, Math.min(100, value))}%`}} />
    </div>
  );
}
export function Modal({
  title,
  eyebrow,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  eyebrow?: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const {t} = useI18n(),
    ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div
      className="modal-backdrop"
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <section
        ref={ref}
        tabIndex={-1}
        className={`game-panel ${wide ? 'wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={t(title)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
          if (e.key === 'Tab') {
            const items = ref.current?.querySelectorAll<HTMLElement>(
              'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
            );
            if (items?.length) {
              const first = items[0],
                last = items[items.length - 1];
              if (document.activeElement === ref.current) {
                e.preventDefault();
                (e.shiftKey ? last : first).focus();
              } else if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }
          }
        }}
      >
        <header className="panel-header">
          <div>
            {eyebrow && <span className="eyebrow">{t(eyebrow)}</span>}
            <h2>{t(title)}</h2>
          </div>
          <button className="icon-button" aria-label={t('Close panel')} onClick={onClose}>
            <X />
          </button>
        </header>
        <div className="panel-content">{children}</div>
      </section>
    </div>
  );
}
