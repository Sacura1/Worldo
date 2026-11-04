import {afterEach,describe,expect,it,vi} from 'vitest';
import {createElement,isValidElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {FundingInstructions,fundingInstructions,type FundingQuote,type FundingToken} from '../src/components/FundingInstructions';

const tokens:FundingToken[]=[{assetId:'asset-eth',symbol:'ETH',blockchain:'eth',decimals:18},{assetId:'asset-usdc',symbol:'USDC',blockchain:'sol',decimals:6}];
const quote:FundingQuote={id:'quote-id',dry:false,verified:true,request:{originAsset:'asset-eth',amount:'1234567890123456789'},quote:{depositAddress:'quoted-source-address',depositMemo:'00000421',amountInFormatted:'1.23',amountOutFormatted:'12'}};
afterEach(()=>vi.unstubAllGlobals());

describe('exact funding instructions',()=>{
 it('renders the required memo with leading zeros, exact source amount and chain',()=>{
  const html=renderToStaticMarkup(createElement(FundingInstructions,{quote,tokens,onCopyError:()=>{}}));
  expect(html).toContain('1.234567890123456789 ETH');expect(html).toContain('Ethereum');expect(html).toContain('quoted-source-address');expect(html).toContain('REQUIRED MEMO');expect(html).toContain('00000421');expect(html).toContain('Copy required memo');expect(html).toContain('address alone is not enough');
  expect(fundingInstructions(quote,tokens)?.memo).toBe('00000421');
 });
 it('uses signed source token units instead of a rounded amount or current form choice',()=>{
  const q={...quote,request:{originAsset:'asset-usdc',amount:'1000001'}};
  expect(fundingInstructions(q,tokens)).toMatchObject({amount:'1.000001',symbol:'USDC',network:'Solana'});
 });
 it('copies the memo verbatim instead of treating it as a number',()=>{
  const writeText=vi.fn().mockResolvedValue(undefined);vi.stubGlobal('navigator',{clipboard:{writeText}});
  const find=(node:unknown):(()=>void)|undefined=>{if(Array.isArray(node)){for(const child of node){const found=find(child);if(found)return found;}}else if(isValidElement(node)){const p=node.props as {children?:unknown;'aria-label'?:string;onClick?:()=>void};if(p['aria-label']==='Copy required memo')return p.onClick;return find(p.children);}return undefined;};
  const onCopy=find(FundingInstructions({quote,tokens,onCopyError:()=>{}}));expect(onCopy).toBeDefined();onCopy!();expect(writeText).toHaveBeenCalledWith('00000421');
 });
 it('does not invent a memo for address-only routes',()=>{
  const q={...quote,quote:{depositAddress:'quoted-source-address'}};
  const html=renderToStaticMarkup(createElement(FundingInstructions,{quote:q,tokens,onCopyError:()=>{}}));
  expect(fundingInstructions(q,tokens)?.memo).toBeNull();expect(html).not.toContain('REQUIRED MEMO');
 });
 it('never displays send instructions for previews, unverified quotes or ambiguous source units',()=>{
  for(const q of [{...quote,dry:true},{...quote,verified:false},{...quote,request:{originAsset:'unknown',amount:'1'}},{...quote,request:{originAsset:'asset-eth',amount:'1.2'}},{...quote,request:{originAsset:'asset-eth',amount:'0'}}]){
   expect(fundingInstructions(q,tokens)).toBeNull();const html=renderToStaticMarkup(createElement(FundingInstructions,{quote:q,tokens,onCopyError:()=>{}}));expect(html).toContain('could not be verified');expect(html).not.toContain('quoted-source-address');
  }
 });
});
