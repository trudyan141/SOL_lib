const sol = require('./index');

test('getFeeSol should return value greater than 0',async () => {

  const rs = await sol?.getFeeSol('9KH3XLhd63Cdr29kwPiDbtDD5q277ouzFgHBGM6LH1Jw',null,null);
  console.log("🚀 ~ getFeeSol ~ rs:", rs)

  expect(parseFloat(rs)).toBeGreaterThanOrEqual(0);
});
test('transferSol',async () => {
  // PRIVATE_KEY=your_private_key_here yarn jest -t 'transferSol'
  let from = '9hpZwqRNsuSR7EMqRALR1C49djQHCDe9yGFZNwwEH818'
  let to = '4xYsNb6SbszLY9FQGocg5Nw4zkdW1AcDxeNGzVqfDNiU'
  let amount = 0.001;
  let privateKey = process.env.PRIVATE_KEY;
  const rs = await sol?.transferSol(from, to , amount, privateKey);
  console.log("🚀 ~ transferSol ~ rs:", rs) 
});
test('getStakingAccounts',async () => {
  let from = '9hpZwqRNsuSR7EMqRALR1C49djQHCDe9yGFZNwwEH818'
  const rs = await sol?.getStakingAccounts(from);
  console.log("🚀 ~ getStakingAccounts ~ rs:", rs)
}, 300000);

test('stakeSol', async () => {
  // PRIVATE_KEY=your_private_key_here yarn jest -t 'stakeSol'
  let privateKey = process.env.PRIVATE_KEY;
  let amountToStake = 0.01228288;
  const votePubkey = `AGXZemZbyZjz5NBhufcob2pf8AXnr9HaGFUGNCfooWrB`;
  const rs = await sol?.stakeSol({ privateKey, amountToStake, votePubkey});
  console.log("🚀 ~ stakeSol ~ rs:", rs)
}, 500000);

test('unstakeSol', async () => {
  // PRIVATE_KEY=your_private_key_here yarn jest -t 'unstakeSol'
  let privateKey = process.env.PRIVATE_KEY;
  const stakePubkey = `A74mef97P2EYqP7QtaNUBUgHtR7fDftTWsFFTU5QsEAT`;
  const rs = await sol?.unstakeSol({ privateKey, stakePubkey});
  console.log("🚀 ~ unstakeSol ~ rs:", rs)
},500000);