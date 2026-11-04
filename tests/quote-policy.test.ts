import {afterEach,describe,it,expect,vi} from 'vitest';
vi.mock('@defuse-protocol/one-click-sdk-typescript',()=>({verifyQuoteSignature:vi.fn(()=>true)}));
import {verifyQuoteSignature,type QuoteResponse} from '@defuse-protocol/one-click-sdk-typescript';
import {assertQuoteMatches} from '../server/intents';

const request={dry:false,swapType:'EXACT_INPUT',originAsset:'nep141:eth.omft.near',destinationAsset:'nep141:wrap.near',amount:'1000000',recipient:'alice.near',recipientType:'DESTINATION_CHAIN',refundTo:'0x1111111111111111111111111111111111111111',refundType:'ORIGIN_CHAIN',slippageTolerance:100,deadline:new Date(Date.now()+60000).toISOString()};
function quote(){return {timestamp:new Date().toISOString(),signature:'verified-by-test-stub',quoteRequest:{...request},quote:{depositAddress:'0x2222222222222222222222222222222222222222',deadline:request.deadline}} as unknown as QuoteResponse;}
afterEach(()=>vi.mocked(verifyQuoteSignature).mockReturnValue(true));
describe('signed quote routing policy',()=>{
 it('accepts an authentic matching route',()=>expect(()=>assertQuoteMatches(request,quote())).not.toThrow());
 it('rejects an invalid upstream signature before consuming deposit data',()=>{vi.mocked(verifyQuoteSignature).mockReturnValue(false);expect(()=>assertQuoteMatches(request,quote())).toThrow(/signature/);});
 it.each(['recipient','refundTo','originAsset','destinationAsset','amount','slippageTolerance'])('rejects a changed %s',(field)=>{const response=quote();(response.quoteRequest as unknown as Record<string,unknown>)[field]='changed';expect(()=>assertQuoteMatches(request,response)).toThrow(/match/);});
 it('rejects stale quotes',()=>{const response=quote();response.timestamp=new Date(Date.now()-10*60_000).toISOString();expect(()=>assertQuoteMatches(request,response)).toThrow(/expired/);});
 it('requires deposit instructions for executable quotes',()=>{const response=quote();delete response.quote.depositAddress;expect(()=>assertQuoteMatches(request,response)).toThrow(/deposit/);});
 it('rejects expired deposit instructions',()=>{const response=quote();response.quote.deadline=new Date(Date.now()-1000).toISOString();expect(()=>assertQuoteMatches(request,response)).toThrow(/deposit/);});
});
