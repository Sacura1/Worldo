import {useLayoutEffect, useState, type CSSProperties} from 'react';
import {Coins} from 'lucide-react';
import {useI18n} from '../lib/i18n';

/** Coins fly from a sale to the coin pouch, so a trade reads as a payout. */
export function CoinBurst({amount, target}: {amount: number; target: HTMLElement | null}) {
  const {formatNumber} = useI18n();
  const [path, setPath] = useState<{x: number; y: number} | null>(null);
  useLayoutEffect(() => {
    const box = target?.getBoundingClientRect();
    if (box)
      setPath({
        x: box.left + box.width / 2 - window.innerWidth / 2,
        y: box.top + box.height / 2 - window.innerHeight * 0.55,
      });
  }, [target]);
  if (!path) return null;
  const route = {'--x': `${path.x}px`, '--y': `${path.y}px`} as CSSProperties;
  return (
    <div className="coin-burst" aria-hidden="true">
      {Array.from({length: 10}, (_, i) => (
        <i key={i} style={{...route, '--spread': `${(i - 4.5) * 16}px`, '--delay': `${i * 45}ms`} as CSSProperties}>
          <Coins size={20} />
        </i>
      ))}
      <b style={route}>+{formatNumber(amount, {maximumFractionDigits: 0})}</b>
    </div>
  );
}
