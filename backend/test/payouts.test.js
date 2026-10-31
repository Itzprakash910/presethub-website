const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../utils/payouts');

test('creator commission defaults to 90 percent', () => {
  assert.equal(P.CREATOR_SHARE(), 0.9);
  assert.equal(P.creatorShare(10000), 9000);
  assert.equal(P.creatorShare(999), 899);
});

test('manual payout default has no fee or GST deduction', () => {
  const result = P.payoutCharges(25000);
  assert.equal(result.feePaise, 0);
  assert.equal(result.gstPaise, 0);
  assert.equal(result.netPaise, 25000);
});

test('payout fee GST is calculated only on configured fee', () => {
  const oldFee = process.env.PAYOUT_FEE_PAISE;
  const oldGst = process.env.PAYOUT_FEE_GST_PERCENT;
  process.env.PAYOUT_FEE_PAISE = '2000';
  process.env.PAYOUT_FEE_GST_PERCENT = '18';
  try {
    assert.deepEqual(P.payoutCharges(10000), { feePaise: 2000, gstPaise: 360, netPaise: 7640, gstRate: 18 });
    assert.equal(P.payoutCharges(1000).feePaise, 1000);
    assert.equal(P.payoutCharges(1000).netPaise, 0);
  } finally {
    if (oldFee === undefined) delete process.env.PAYOUT_FEE_PAISE; else process.env.PAYOUT_FEE_PAISE = oldFee;
    if (oldGst === undefined) delete process.env.PAYOUT_FEE_GST_PERCENT; else process.env.PAYOUT_FEE_GST_PERCENT = oldGst;
  }
});

test('bank, IFSC, UPI and account holder validators', () => {
  assert.equal(P.validateIfsc('SBIN0001234'), 'SBIN0001234');
  assert.equal(P.validateIfsc('BADIFSC'), null);
  assert.equal(P.validateAccount('123456789012'), '123456789012');
  assert.equal(P.validateAccount('123'), null);
  assert.equal(P.validateUpi('creator@upi'), 'creator@upi');
  assert.equal(P.validateUpi('not-an-upi'), null);
  assert.equal(P.validateName('Creator Name'), 'Creator Name');
  assert.equal(P.validateName('x'), null);
});
