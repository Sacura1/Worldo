import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import type {GameSnapshot} from '../shared/game';
import {MayorDecision} from '../src/city/TradeCounter';

type City = GameSnapshot['world']['cities']['motor'];
const shown = (priceRate: number) =>
  renderToStaticMarkup(
    <MayorDecision city={{policy: {note: 'Holding steady.', source: 'near-ai', priceRate}} as unknown as City} />,
  );

describe('the mayor decision box', () => {
  it('says how the decision moves everyday prices', () => {
    expect(shown(1.1)).toContain('raises everyday prices by 10%');
    expect(shown(0.85)).toContain('lowers everyday prices by 15%');
  });

  it('adds no price line when prices are unchanged', () => {
    expect(shown(1)).not.toContain('everyday prices');
  });
});
