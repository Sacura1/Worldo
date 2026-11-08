import {describe, it, expect} from 'vitest';
import {toAtomicAmount, validRefundAddress} from '../server/intents';
import {executionSucceeded} from '../server/near';
describe('cross-chain funding input', () => {
  it('preserves amounts larger than JS safe integers', () => {
    expect(toAtomicAmount('0.123456789012345678901234', 24)).toBe('123456789012345678901234');
    expect(toAtomicAmount('1', 6)).toBe('1000000');
  });
  it.each(['0', '-1', 'NaN', '1e6', '1.2345678', ' 1', 'Infinity', 1])(
    'rejects invalid or overprecise amounts %s',
    amount => expect(() => toAtomicAmount(amount, 6)).toThrow(),
  );
  it('does not silently round excess precision', () => expect(() => toAtomicAmount('0.0000001', 6)).toThrow());
  it('requires an origin-chain refund address', () => {
    expect(validRefundAddress('base', 'alice.near')).toBe(false);
    expect(validRefundAddress('base', '0x1111111111111111111111111111111111111111')).toBe(true);
    expect(validRefundAddress('base', '0x0000000000000000000000000000000000000000')).toBe(false);
    expect(validRefundAddress('near', 'alice.near')).toBe(true);
    expect(validRefundAddress('unknown', 'alice.near')).toBe(false);
  });
});
describe('confirmed chain execution', () => {
  it('requires successful final execution and checks nested receipt failures', () => {
    expect(executionSucceeded({status: {SuccessValue: ''}, receipts_outcome: []})).toBe(true);
    expect(executionSucceeded({status: {Failure: {}}})).toBe(false);
    expect(
      executionSucceeded({status: {SuccessValue: ''}, receipts_outcome: [{outcome: {status: {Failure: {}}}}]}),
    ).toBe(false);
    expect(executionSucceeded({status: 'Started'})).toBe(false);
  });
});
