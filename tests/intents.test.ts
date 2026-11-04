import {describe,it,expect} from 'vitest';
import {toAtomicAmount,validRefundAddress} from '../server/intents';
import {encodeChallenge,validateChallengePayload,validateContractAction,executionSucceeded} from '../server/near';
describe('cross-chain funding input',()=>{
 it('preserves amounts larger than JS safe integers',()=>{expect(toAtomicAmount('0.123456789012345678901234',24)).toBe('123456789012345678901234');expect(toAtomicAmount('1',6)).toBe('1000000');});
 it.each(['0','-1','NaN','1e6','1.2345678',' 1','Infinity',1])('rejects invalid or overprecise amounts %s',(amount)=>expect(()=>toAtomicAmount(amount,6)).toThrow());
 it('does not silently round excess precision',()=>expect(()=>toAtomicAmount('0.0000001',6)).toThrow());
 it('requires an origin-chain refund address',()=>{expect(validRefundAddress('base','alice.near')).toBe(false);expect(validRefundAddress('base','0x1111111111111111111111111111111111111111')).toBe(true);expect(validRefundAddress('base','0x0000000000000000000000000000000000000000')).toBe(false);expect(validRefundAddress('near','alice.near')).toBe(true);expect(validRefundAddress('unknown','alice.near')).toBe(false);});
});
describe('bounded mainnet game transactions',()=>{
 it('allows only the supported game methods',()=>{expect(()=>validateContractAction('grant_harvest',{account_id:'alice.near'},'1')).toThrow();expect(()=>validateContractAction('set_oracle',{oracle:'attacker.near'},'1')).toThrow();});
 it('bounds deposits and requires the exact security deposit',()=>{expect(()=>validateContractAction('register',{},'1')).toThrow();expect(()=>validateContractAction('trade',{merchant_id:'refinery.near',token_id:'crude',amount:'2',buy:false,limit:'10'},'0')).toThrow();expect(validateContractAction('build_refinery',{},'1').method).toBe('build_refinery');});
 it('rejects extra fields and excessive batch sizes',()=>{expect(()=>validateContractAction('process',{merchant_id:'refinery.near',token_id:'crude',batches:21},'1')).toThrow();expect(()=>validateContractAction('build_refinery',{admin:true},'1')).toThrow();});
 it('requires successful final execution and checks nested receipt failures',()=>{expect(executionSucceeded({status:{SuccessValue:''},receipts_outcome:[]})).toBe(true);expect(executionSucceeded({status:{Failure:{}}})).toBe(false);expect(executionSucceeded({status:{SuccessValue:''},receipts_outcome:[{outcome:{status:{Failure:{}}}}]})).toBe(false);expect(executionSucceeded({status:'Started'})).toBe(false);});
});
describe('social-login challenge binding',()=>{
 const challenge={message:'Sign in to Lowland.',recipient:'lowland.test',nonce:Array.from({length:32},(_,i)=>i),expiresAt:Date.now()+1000};
 it('accepts only the exact NEP413 payload',()=>{const bytes=[...encodeChallenge(challenge)];expect(validateChallengePayload(bytes,challenge)).toBe(true);bytes[10]^=1;expect(validateChallengePayload(bytes,challenge)).toBe(false);});
 it('binds message, nonce, and intended app',()=>{const bytes=[...encodeChallenge(challenge)];expect(validateChallengePayload(bytes,{...challenge,recipient:'attacker.test'})).toBe(false);expect(validateChallengePayload(bytes,{...challenge,nonce:Array(32).fill(9)})).toBe(false);expect(validateChallengePayload('not an array',challenge)).toBe(false);expect(validateChallengePayload([256],challenge)).toBe(false);});
});
