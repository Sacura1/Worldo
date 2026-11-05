import {describe,expect,it} from 'vitest';
import {appTranslations} from '../src/locales/app';
import {runtimeTranslations} from '../src/locales/runtime';
import {panelTranslations} from '../src/locales/panels';
import {LANGUAGES,type Locale} from '../shared/languages';

describe('game translation semantics',()=>{
 it('distinguishes underground oil deposits from incoming payments',()=>{
  const bankingTerms:Partial<Record<Locale,RegExp>>={ar:/وديعة|إيداع|الإيداع/,hi:/जमा|डिपॉजिट/,zh:/存款|充值|入金/,ja:/入金|預金|デポジット/,ko:/예치금|예금|입금/,de:/Einzahl|Einlager|Depot/i};
  const oilKeys=['Deposit exhausted today','Deposit located · ready to drill','Deposit marked · move within 5 m','Deposit {distance} m away.'];
  for(const [locale,banking]of Object.entries(bankingTerms) as [Locale,RegExp][]){
   for(const key of oilKeys)expect(appTranslations[locale][key],locale+': '+key).not.toMatch(banking);
   expect(runtimeTranslations[locale]['Deposit located. Work within 5 metres of the marked ground.'],locale).not.toMatch(banking);
  }
  const paymentTerms:Partial<Record<Locale,RegExp>>={ar:/إيداع|الإيداع/,hi:/जमा/,zh:/充值|存款/,ja:/入金/,ko:/입금/};
  for(const [locale,payment]of Object.entries(paymentTerms) as [Locale,RegExp][])expect(panelTranslations[locale]['Deposit detected'],locale).toMatch(payment);
 });
 it('explains inventory-based pricing rather than stock-market prices',()=>{
  const inventoryTerms:Record<Exclude<Locale,'en'>,RegExp>={fr:/stocks?/i,es:/existencias/i,pt:/estoque/i,de:/Lagerbestand/i,ar:/مخزون/,hi:/भंडार/,zh:/库存/,ja:/在庫/,ko:/재고/};
  for(const [locale,inventory]of Object.entries(inventoryTerms) as [Exclude<Locale,'en'>,RegExp][])expect(runtimeTranslations[locale]['Live contract quote · price changes with stock'],locale).toMatch(inventory);
 });
 it('translates the interface wording around Worldo branding in every language',()=>{
  const headings=['WELCOME TO WORLDO','WORLDO  /  FUEL & SERVICE','WORLDO / FIELD GUIDE','WORLDO / LOCAL BUSINESS','WORLDO REFINERY','WORLDO SUPPLY'];
  const normalize=(text:string)=>text.replace(/\s+/g,' ').trim().toLowerCase();
  for(const {code}of LANGUAGES){if(code==='en')continue;for(const key of headings){const copy=appTranslations[code][key];expect(copy,code+': '+key).toBeTruthy();expect(normalize(copy),code+': '+key).not.toBe(normalize(key));}}
 });
});
