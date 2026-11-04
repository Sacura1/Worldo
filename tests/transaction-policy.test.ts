import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {KeyPair} from '@near-js/crypto';
import {actionCreators,buildDelegateAction,encodeTransaction} from '@near-js/transactions';
import bs58 from 'bs58';
import {ACTION_GAS,actionCost,assertSponsoredDelegate,checkReviewedFee,prepareGameTransaction} from '../server/transaction-policy';
import {assembleUserSignedTransaction,submitSponsoredDelegate} from '../server/relayer';

const player=KeyPair.fromRandom('ed25519'),operator=KeyPair.fromRandom('ed25519');
const input={accountId:'player.near',publicKey:player.getPublicKey().toString(),contractId:'game.near',args:{},access:{nonce:10,block_height:100,block_hash:bs58.encode(new Uint8Array(32))}};
const forcedDelegate=(method:string,deposit:bigint,receiverId='game.near')=>buildDelegateAction({senderId:'player.near',receiverId,publicKey:player.getPublicKey(),nonce:11n,maxBlockHeight:400n,actions:[actionCreators.functionCall(method,Buffer.from('{}'),ACTION_GAS,deposit)]});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});

describe('player principal never comes from the sponsor',()=>{
 it.each(['register','deposit'])('%s constructs an ordinary transaction signed by the player',method=>{
  const deposit=10n**24n,prepared=prepareGameTransaction({...input,method,deposit:deposit.toString()});
  expect(prepared.kind).toBe('transaction');if(prepared.kind!=='transaction')throw Error('Unsafe funding path');
  expect(prepared.transaction.signerId).toBe('player.near');expect(prepared.transaction.publicKey.toString()).toBe(player.getPublicKey().toString());expect(prepared.transaction.receiverId).toBe('game.near');
  expect(prepared.transaction.actions).toHaveLength(1);expect(prepared.transaction.actions[0].enum).toBe('functionCall');expect(prepared.transaction.actions[0].functionCall?.deposit).toBe(deposit);
  expect(prepared.bytes).toEqual(Buffer.from(encodeTransaction(prepared.transaction)));
 });
 it('even a one-yocto game deposit cannot turn sponsorship into a credited player balance',()=>{
  expect(prepareGameTransaction({...input,method:'deposit',deposit:'1'}).kind).toBe('transaction');
  expect(()=>assertSponsoredDelegate(forcedDelegate('deposit',1n),'game.near')).toThrow('cannot use sponsored');
 });
 it('sponsor rejects material deposits at broadcast boundary before any network call',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch');
  await expect(submitSponsoredDelegate(forcedDelegate('deposit',10n**24n),'irrelevant')).rejects.toThrow('one-yocto');
  expect(fetch).not.toHaveBeenCalled();
 });
 it('keeps only one-yocto approved game calls delegated',()=>{
  const prepared=prepareGameTransaction({...input,method:'trade',deposit:'1'});expect(prepared.kind).toBe('delegateAction');
  if(prepared.kind!=='delegateAction')throw Error('Expected sponsored call');expect(assertSponsoredDelegate(prepared.delegate,'game.near')).toBe(1n);
  expect(()=>assertSponsoredDelegate(forcedDelegate('trade',1n,'another.near'),'game.near')).toThrow('cannot use sponsored');
  expect(()=>assertSponsoredDelegate(forcedDelegate('trade',2n),'game.near')).toThrow('one-yocto');
 });
 it('verifies the native transaction against the player key, never the operator key',()=>{
  const prepared=prepareGameTransaction({...input,method:'deposit',deposit:(10n**24n).toString()});if(prepared.kind!=='transaction')throw Error('Unsafe funding path');
  const hash=createHash('sha256').update(prepared.bytes).digest();
  const payload=(key:typeof player)=>Buffer.from(JSON.stringify({signature:[...key.sign(hash).signature]})).toString('base64');
  const signed=assembleUserSignedTransaction(prepared.transaction,payload(player));expect(signed.transaction.signerId).toBe('player.near');
  expect(()=>assembleUserSignedTransaction(prepared.transaction,payload(operator))).toThrow('does not match the player');
 });
});

describe('network cost review',()=>{
 it('states who actually pays the deposit and network gas',()=>{
  const native=actionCost('register','10000000000000000000000','100000000');expect(native.gasSponsored).toBe(false);expect(native.attachedDepositPayer).toBe('player');expect(native.feeEstimateYocto).toBe('6500000000000000000000');
  const delegated=actionCost('withdraw','1','100000000');expect(delegated.gasSponsored).toBe(true);expect(delegated.attachedDepositPayer).toBe('sponsor');
 });
 it('rejects missing, expired and increased native fee reviews',()=>{
  const quote=actionCost('deposit','1000000000000000000000000','100000000');
  expect(()=>checkReviewedFee(undefined,quote)).toThrow('fresh');
  expect(()=>checkReviewedFee({...quote,estimatedAt:Date.now()-120001},quote)).toThrow('fresh');
  expect(()=>checkReviewedFee(quote,actionCost('deposit',quote.attachedDepositYocto,'100000001'))).toThrow('increased');
  expect(checkReviewedFee(quote,quote)).toBe(quote.feeEstimateYocto);
 });
});
