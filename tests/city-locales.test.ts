import {describe, expect, it} from 'vitest';
import {readFile, readdir} from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import {messages, translate} from '../src/lib/i18n';
import {LANGUAGES} from '../shared/languages';
import {ITEMS} from '../shared/config/items';
import {CITY_NAMES, CITY_BUILDINGS, RESOURCE_ZONES} from '../shared/city-layout';
import {MAYORS, MAYOR_SUGGESTIONS} from '../shared/mayors';
import citySource from '../src/locales/city-source.json';

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();
function literals(node: ts.Node | undefined): string[] {
  if (!node) return [];
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isConditionalExpression(node)) return [...literals(node.whenTrue), ...literals(node.whenFalse)];
  if (ts.isParenthesizedExpression(node)) return literals(node.expression);
  return [];
}
describe('city localization', () => {
  it('covers every city/ownership phrase in all ten locales without dropping placeholders', () => {
    expect(new Set(citySource).size).toBe(citySource.length);
    for (const {code} of LANGUAGES)
      for (const key of citySource) {
        expect(messages[code][key], `${code}: ${key}`).toBeTruthy();
        expect(placeholders(messages[code][key]), `${code}: ${key}`).toEqual(placeholders(key));
      }
  });
  it('covers literal and conditional UI phrases plus safe server errors in the live city path', async () => {
    const files = [
      ...(await readdir('src/city')).filter(f => f.endsWith('.tsx')).map(f => path.join('src/city', f)),
      'src/components/Funding.tsx',
      ...(await readdir('server/economy')).filter(f => f.endsWith('.ts')).map(f => path.join('server/economy', f)),
      'server/world-store.ts',
      'server/city-controller.ts',
      'server/game-api.ts',
      'server/preview-api.ts',
      'server/city-chain.ts',
      'server/gameplay-sessions.ts',
      'server/chain-mode.ts',
    ];
    const contents = await Promise.all(files.map(async file => ({file, text: await readFile(file, 'utf8')})));
    const found = new Set<string>();
    for (const {file, text} of contents) {
      const source = ts.createSourceFile(
        file,
        text,
        ts.ScriptTarget.Latest,
        true,
        file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
      );
      const visit = (node: ts.Node) => {
        const call =
          ts.isCallExpression(node) &&
          ((ts.isIdentifier(node.expression) && node.expression.text === 't') ||
            (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 't'));
        const error =
          ts.isNewExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 'GameError';
        if (call || error) for (const key of literals(node.arguments?.[0])) found.add(key);
        ts.forEachChild(node, visit);
      };
      visit(source);
    }
    for (const key of found)
      for (const {code} of LANGUAGES) expect(messages[code][key], `${code}: ${key}`).toBeTruthy();
    // This scans the repository from disk; its timeout is not a gameplay budget.
  }, 15000);
  it('covers equipment, map locations, mayor introductions and suggested dialogue', () => {
    const labels = [
      ...Object.values(ITEMS).map(item => item.name),
      ...Object.values(CITY_NAMES),
      ...CITY_BUILDINGS.map(b => b.label).filter(Boolean),
      ...RESOURCE_ZONES.map(z => z.name),
      ...MAYORS.flatMap(m => [m.role, m.introduction]),
      ...MAYOR_SUGGESTIONS,
    ];
    for (const label of labels)
      for (const {code} of LANGUAGES) expect(messages[code][label], `${code}: ${label}`).toBeTruthy();
  });
  it('translates deterministic price reasons and nested resource/state labels while preserving numbers', () => {
    for (const {code} of LANGUAGES.filter(l => l.code !== 'en')) {
      const reason = translate('18 coins per unit; fuel 22%, wood stock 40/100.', code);
      expect(reason).not.toContain('coins per unit');
      for (const number of ['18', '22', '40', '100']) expect(reason).toContain(number);
      const event = translate('Harbor City is dark.', code);
      expect(event).not.toContain('Harbor City');
      expect(event).not.toContain(' is dark.');
    }
  });
  it('does not interpret NEAR accounts, station token IDs or transaction identifiers as copy', () => {
    for (const id of ['station:harbor:1', 'owner.worldo.testnet', 'equipment:motor:pickup:42', '8za5UEpNQy5u31f8'])
      for (const {code} of LANGUAGES) expect(translate(id, code)).toBe(id);
  });
});
