/* eslint-disable no-useless-catch */
const Bip39 = require("bip39");
const nacl = require("tweetnacl");
const bs58 = require("bs58");
const { derivePath } = require("ed25519-hd-key");
const BigNumber = require("bignumber.js");
const axios = require("axios");
const web3 = require("@solana/web3.js");
const { forEachSeries } = require("p-iteration");

const { LAMPORTS_PER_SOL } = web3;
const MEMO_PROGRAM_ID = new web3.PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const solScanApiUrl = process.env.SOL_SCAN_API_URL || "https://api.solscan.io";
const solApiUrl = process.env.SOL_API_URL || "https://api.mainnet-beta.solana.com";
const solCluster = process.env.SOL_CLUSTER || "";
const rateLimit = parseFloat(process.env.SOL_RATE_LIMIT || "40");
let numOfTasks = parseInt(process.env.SOL_NUM_OF_TASKS || "5");
let minSendAmount = 0.00001;
let rentExemptionForSystemAccount = 1000000;
let minimumBalanceForRentExemption = 2282880;
let minimumStakeAmount = 0.01;

const cache = {};
let apiUrl = solApiUrl;

const _getConnection = () => {
  const key = [
    "CONNECTION",
    apiUrl
  ].join("_").toUpperCase();
  let connection = cache[key];
  if (connection) {
    return connection;
  }

  connection = new web3.Connection(apiUrl, {
    commitment:"confirmed",
    confirmTransactionInitialTimeout:  90 * 10 * 1000
  });
  cache[key] = connection;

  return connection;
};

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function setSolApiUrl(configApiUrl) {
  apiUrl = configApiUrl;
}

async function setConfigSol(config) {
  console.log("🚀 ~ setConfigSol ~ config:", config)
  if (!config) {
    return;
  }

  if (config.rpcUrl) {
    apiUrl = config.rpcUrl;
  }

  if (config.minSendAmount > 0) {
    minSendAmount = config.minSendAmount;
  }

  if (config.rentExemptionForSystemAccount > 0) {
    rentExemptionForSystemAccount = config.rentExemptionForSystemAccount;
  }

  if (config.minimumBalanceForRentExemption > 0) {
    minimumBalanceForRentExemption = config.minimumBalanceForRentExemption;
  }

  if (config.minimumStakeAmount > 0) {
    minimumStakeAmount = config.minimumStakeAmount;
  }

  if (config.numOfTasks > 0) {
    numOfTasks = config.numOfTasks;
  }

  return {
    rpcUrl: apiUrl,
    rentExemptionForSystemAccount,
    minimumStakeAmount,
    minSendAmount: minSendAmount,
  };
}

const generateKeySol = async (mnemonic, passphrase = "", path = "m/44'/501'/0'/0'") => {
  try {
    console.log('generateKeySol');
    let seed = await Bip39.mnemonicToSeed(mnemonic, passphrase);
    if (path) {
      seed = derivePath(path, seed).key;
    }
     console.log(nacl,'nacl=>generateKeySol');
    const account = new web3.Account(nacl.sign.keyPair.fromSeed(seed).secretKey);
    console.log(account,'account=>generateKeySol');
    return {
      privateKey: bs58.encode(account._keypair.secretKey),
      address: bs58.encode(account._keypair.publicKey),
      // privateKey: bs58.encode(account._secretKey),
      // address: bs58.encode(account._publicKey),
      hdPath: path
    };
  } catch (e) {
    throw e;
  }
};

const getFeeSol = async () => {
  try {
    const connection = _getConnection();
    const block = await connection.getRecentBlockhash();
    console.log("🚀 ~ getFeeSol ~ block:", block)

    return BigNumber(block.feeCalculator.lamportsPerSignature).div(LAMPORTS_PER_SOL).toFixed();
  } catch (error) {
    console.log("🚀 ~ getFeeSol ~ error:", error)
    return null;
  }
};

const transferSol = async (from, to, amount, privateKey) => {
  try {
    const connection = _getConnection();
    const latestBlockHash = await connection.getLatestBlockhash();
    console.log(latestBlockHash,'latestBlockHash');
    const manualTransaction = new web3.Transaction({
      recentBlockhash: latestBlockHash.blockhash,
      feePayer: new web3.PublicKey(from)
    });
    manualTransaction.add(web3.SystemProgram.transfer({
      fromPubkey: new web3.PublicKey(from),
      toPubkey: new web3.PublicKey(to),
      lamports: BigNumber(amount).times(LAMPORTS_PER_SOL).toFixed(0),
    }));
   
    const raw = await _signTransaction(manualTransaction, new web3.PublicKey(from), privateKey);
    const tx = raw ? await _sendRawTransaction(raw) : raw;

    return tx;
  } catch (e) {
    console.log(e,'error=>transferSol');
    throw e;
  }
};

const _signTransaction = async (transaction, publicKey, privateKey) => {
  try {
    const transactionBuffer = transaction.serializeMessage();
     console.log(transactionBuffer,'transactionBuffer');
    const signature = nacl.sign.detached(transactionBuffer, bs58.decode(privateKey));
      console.log(signature,'signature');
    transaction.addSignature(publicKey, signature);
    const isVerifiedSignature = transaction.verifySignatures();
    
    if (isVerifiedSignature) {
      return transaction.serialize();
    }

    return null;
  } catch (e) {
    console.log(e,'error=>_signTransaction');
    throw e;
  }
};

const _sendRawTransaction = async (rawTransaction) => {
  try {
    const connection = _getConnection();
    return await web3.sendAndConfirmRawTransaction(connection, rawTransaction);
  } catch (e) {
    throw e;
  }
};

const getBalanceSol = async (address) => {
  const connection = _getConnection();
  const balance = await connection.getBalance(new web3.PublicKey(address));
  
  return new BigNumber(balance).div(LAMPORTS_PER_SOL).toFixed();
};

const verifyAddressSol = async (address) => {
  try {
    new web3.PublicKey(address);

    return true;
  } catch (e) {
    // 
    return false;
  }
};

const getHistorySol = async (address, limit) => {
  const connection = _getConnection();
  const options = {
    limit: limit,
    until: null,
  };
  const signatures = await connection.getConfirmedSignaturesForAddress2(new web3.PublicKey(address), options);
  // 
  if (!signatures.length) {
    return [];
  }

  const result = [];
  for (let i = 0; i < signatures.length; i++) {
    const txId = signatures[i].signature;
    const url = `${solScanApiUrl}/transaction?tx=${txId}&cluster=${solCluster}`;
    const txResult = await axios.get(url);
    const txInfo = txResult.data;
    const { parsedInstruction } = txInfo;

    let amount = null;
    let tx_type = "";
    let to_address = null;
    let from_address = null;
    let memo = null;
    let stakeAccount = null;

    if (!parsedInstruction) continue;
    

    parsedInstruction.forEach(instruction => {
      if (instruction.type === "sol-transfer") {
        from_address = instruction.params.source;
        to_address = instruction.params.destination;
        amount = new BigNumber(instruction.params.amount).div(LAMPORTS_PER_SOL).toFixed();
        tx_type = from_address === address ? "send" : "receive";

        return;
      }

      if (instruction.type === "createAccount" && instruction.program === "system") {
        // Create stake account
        if (instruction.params.programOwner === "Stake11111111111111111111111111111111111111") {
          amount = instruction.params["transferAmount(SOL)"];
        }

        return;
      }

      if (instruction.type === "delegate" && instruction.program === "stake") {
        from_address = instruction.params.stakeAuthority;
        to_address = instruction.params.voteAccount;
        tx_type = "delegate";

        return;
      }

      if (instruction.program === "spl-memo") {
        try {
          const bytes2 = Buffer.from(instruction.data, "hex");
          memo = bytes2.toString();
        } catch (error) {
          //
        }

        return;
      }

      if (instruction.type === "withdraw" && instruction.program === "stake") {
        from_address = instruction.params.stakeAccount;
        to_address = instruction.params.withdrawAuthority;
        amount = new BigNumber(instruction.params.lamports).div(LAMPORTS_PER_SOL).toFixed();
        tx_type = "withdrawStake";

        return;
      }

      if (instruction.type === "deactivate" && instruction.program === "stake") {
        from_address = instruction.params.stakeAuthority;
        stakeAccount = instruction.params.stakeAccount;
        tx_type = "undelegate";

        return;
      }

    });

    const tx = {
      tx_id: txId,
      tx_time: txInfo.blockTime,
      block_height: txInfo.slot,
      fee: new BigNumber(txInfo.fee).div(LAMPORTS_PER_SOL).toFixed(),
      status: txInfo.status,
      amount,
      from_address,
      to_address,
      tx_type,
      memo,
      stakeAccount,
    };

    result.push(tx);
  }

  return result;
};

// Staking
async function getEstimatedFee(transaction) {
  const connection = _getConnection();
  const fees = await transaction.getEstimatedFee(connection);

  return BigNumber(fees).div(LAMPORTS_PER_SOL).toFixed();
}

async function getSolVoteAccounts() {
  const connection = _getConnection();
  // To delegate our stake, we get the current vote accounts and choose the first
  const voteAccounts = await connection.getVoteAccounts();
  // const voteAccount = voteAccounts.current.concat(voteAccounts.delinquent)[0];
  // const votePubkey = new web3.PublicKey(voteAccount.votePubkey);

  return voteAccounts;
}

async function getValidatorInfo(votePubkey) {
  const connection = _getConnection();
  const voteAccounts = await connection.getVoteAccounts();
  const validatorInfo = voteAccounts.current.find(item => item.votePubkey === votePubkey);
  if (!validatorInfo) {
    return null;
  }

  // Get config data for validator
  const configAccounts = await connection.getParsedProgramAccounts(new web3.PublicKey("Config1111111111111111111111111111111111111"), {
    encoding: "jsonParsed",
    commitment: "recent",
  });

  let hasConfigData = false;
  for (let index = 0; index < configAccounts.length; index++) {
    if (hasConfigData) {
      break;
    }

    const configAccount = configAccounts[index];
    const { type, info } = configAccount.account.data.parsed || {};
    if (type === "validatorInfo") {
      const { configData, keys } = info;
      keys.forEach(keyInfo => {
        if (keyInfo.pubkey === votePubkey || keyInfo.pubkey === validatorInfo.nodePubkey) {
          validatorInfo.name = configData.name;
          validatorInfo.website = configData.website;
          validatorInfo.keybaseUsername = configData.keybaseUsername;
          hasConfigData = true;
        }
      });
    }
  }

  /*
  const stakingAccounts = await connection.getParsedProgramAccounts(web3.StakeProgram.programId, {
    encoding: "jsonParsed",
    commitment: "recent",
    filters: [
      {
        "memcmp": {
          "offset": 124,
          "bytes": votePubkey
        }
      }
    ]
  });
  const numOfDelegators = stakingAccounts.length;
  
  */

  return {
    name: validatorInfo.name,
    website: validatorInfo.website,
    keybaseUsername: validatorInfo.keybaseUsername,
    commission: validatorInfo.commission,
    votePubkey: validatorInfo.votePubkey,
    nodePubkey: validatorInfo.nodePubkey,
    activatedStake: new BigNumber(validatorInfo.activatedStake).div(LAMPORTS_PER_SOL).toFixed(),
    numOfDelegators: 0,
  };
}

async function getMinimumStakeAmountSol() {
  // const rentExemption = await getRentExemptionForStakingAccount();

  // return new BigNumber(rentExemption).plus(1).toFixed();
  return minimumStakeAmount;
}

async function getRentExemptionForStakingAccount() {
  // const connection = _getConnection();
  // const minAmount = await connection.getMinimumBalanceForRentExemption(web3.StakeProgram.space);
  const minAmount = minimumBalanceForRentExemption;

  return new BigNumber(minAmount).div(LAMPORTS_PER_SOL).toFixed();
}

async function getRentExemptionForSystemAccount() {
  // const connection = _getConnection();
  // const minAmount = await connection.getMinimumBalanceForRentExemption(web3.NONCE_ACCOUNT_LENGTH);
  const minAmount = rentExemptionForSystemAccount;

  return new BigNumber(minAmount).div(LAMPORTS_PER_SOL).toFixed();
}

async function checkSendAmountSol(from, to, amount) {
  amount = new BigNumber(amount);
  let minAmount = new BigNumber(minSendAmount);
  let maxAmount = new BigNumber(0);
  const errorCode = null;

  // Amount must be greater than Rent Exemption For System Account
  if (amount.lt(minAmount)) {
    return {
      errorCode: "SOL_AMOUNT_MUST_BE_GREAT_OR_EQUAL",
      amount: minAmount.toFixed(),
    };
  }

  const sysmtemAccountRentExempt = new BigNumber(await getRentExemptionForSystemAccount());
  const toBalance = new BigNumber(await getBalanceSol(to));
  if (toBalance < sysmtemAccountRentExempt.toNumber()) {
    // Amount must be greater than Rent Exemption For System Account
    minAmount = new BigNumber(sysmtemAccountRentExempt);
  }

  if (amount.lt(minAmount)) {
    return {
      errorCode: "SOL_AMOUNT_MUST_BE_GREAT_OR_EQUAL",
      amount: minAmount.toFixed(),
    };
  }

  const fromBalance = new BigNumber(await getBalanceSol(from));
  if (fromBalance.toNumber() === 0) {
    return {
      errorCode: "SOL_AMOUNT_IS_ZERO",
    };
  }

  const fee = new BigNumber(await getFeeSol());
  let availbleCanSendAmount = fromBalance.minus(fee);
  if (availbleCanSendAmount.gt(0)) {
    let hasRentAmount = false;
    const remainingAmount = availbleCanSendAmount.minus(amount);
    if (remainingAmount.eq(0)) {
      // Send max
      hasRentAmount = true;
    } else if (remainingAmount.lt(sysmtemAccountRentExempt)) {
      hasRentAmount = true;
      availbleCanSendAmount = availbleCanSendAmount.minus(sysmtemAccountRentExempt);
    }

    if (!hasRentAmount) {
      // Check stake accounts
      const stakingAccounts = await getStakingAccounts(from, true);
      // 
      if (stakingAccounts.length > 0) {
        availbleCanSendAmount = availbleCanSendAmount.minus(sysmtemAccountRentExempt);
        if (availbleCanSendAmount.lt(0)) {
          availbleCanSendAmount = new BigNumber(0);
        }
      }
    }

    maxAmount = availbleCanSendAmount;
  } else {
    maxAmount = new BigNumber(0);
  }

  if (amount.gt(maxAmount)) {
    return {
      errorCode: "SOL_AMOUNT_MUST_BE_LESS_OR_EQUAL",
      amount: maxAmount.toFixed(),
    };
  }

  return {
    errorCode,
  };
}

async function getStakeFeeSol({
  publicKey,
  amountToStake,
  votePubkey,
  memo,
}) {
  const { stakeTransaction } = await createStakeTx({
    publicKey,
    privateKey: null,
    amountToStake,
    votePubkey,
    memo,
  });
  const fee = await getEstimatedFee(stakeTransaction);

  return fee;
}

async function createStakeTx({
  publicKey,
  privateKey,
  amountToStake,
  votePubkey,
  memo,
}) {
  const wallet = privateKey ? new web3.Account(bs58.decode(privateKey)) : web3.Keypair.generate();
  // Setup a transaction to create our stake account
  // Note: `StakeProgram.createAccount` returns a `Transaction` preconfigured with the necessary `TransactionInstruction`s
  const stakeAccount = web3.Keypair.generate();
  const connection = _getConnection();
  const latestBlockHash = await connection.getLatestBlockhash();
  const manualTransaction = new web3.Transaction({
    recentBlockhash: latestBlockHash.blockhash,
    feePayer: publicKey ? new web3.PublicKey(publicKey) : wallet.publicKey,
  });

  const createStakeAccountTx = web3.StakeProgram.createAccount({
    fromPubkey: wallet.publicKey,
    // Here we set two authorities: Stake Authority and Withdrawal Authority. Both are set to our wallet.
    authorized: new web3.Authorized(wallet.publicKey, wallet.publicKey),
    lamports: new BigNumber(amountToStake).times(LAMPORTS_PER_SOL).toFixed(),
    lockup: new web3.Lockup(0, 0, wallet.publicKey), // Optional. We'll set this to 0 for demonstration purposes.
    stakePubkey: stakeAccount.publicKey,
  });
  manualTransaction.add(createStakeAccountTx);

  // We can then delegate our stake to the voteAccount
  const delegateTx = web3.StakeProgram.delegate({
    stakePubkey: stakeAccount.publicKey,
    authorizedPubkey: wallet.publicKey,
    votePubkey: new web3.PublicKey(votePubkey),
  });
  manualTransaction.add(delegateTx);

  if (memo) {
    manualTransaction.add(
      new web3.TransactionInstruction({
        keys: [{
          pubkey: wallet.publicKey,
          isSigner: true,
          isWritable: true
        }],
        data: Buffer.from(memo, "utf-8"),
        programId: MEMO_PROGRAM_ID,
      })
    );
  }
  console.log(manualTransaction,'createStakeTx=>manualTransaction');
  console.log(wallet,'createStakeTx=>wallet');
  console.log(stakeAccount,'createStakeTx=>stakeAccount');
  return {
    stakeTransaction: manualTransaction,
    wallet,
    stakeAccount,
  };
}

async function stakeSol({
  privateKey,
  amountToStake,
  votePubkey,
  memo,
}) {
  console.log(privateKey,'stakeSol=>privateKey');
  console.log(votePubkey,'stakeSol=>votePubkey');
  console.log(amountToStake,'stakeSol=>amountToStake');
  const {
    stakeTransaction,
    wallet,
    stakeAccount,
  } = await createStakeTx({
    publicKey: null,
    privateKey: privateKey,
    amountToStake,
    votePubkey,
    memo,
  });

  const connection = _getConnection();
  console.log(stakeTransaction,"stakeTransaction");
  console.log(connection,"connection");
  try{
    const createStakeAccountTxId = await web3.sendAndConfirmTransaction(
      connection,
      stakeTransaction,
      [
        wallet,
        stakeAccount, // Since we're creating a new stake account, we have that account sign as well
      ]
    );
    console.log(`Stake account created. Tx Id: ${createStakeAccountTxId}`);
    /*
    // Check our newly created stake account balance. This should be 0.5 SOL.
    const stakeBalance = await connection.getBalance(stakeAccount.publicKey);
    console.log(`Stake account balance: ${stakeBalance / LAMPORTS_PER_SOL} SOL`);

    // Verify the status of our stake account. This will start as inactive and will take some time to activate.
    const stakeStatus = await connection.getStakeActivation(stakeAccount.publicKey);
    console.log(`Stake account status: ${stakeStatus.state}`);
    */

    return createStakeAccountTxId;
  }catch(error){
    console.log("stakeSol=>error",error);
    return null;
  }
  
}

async function getStakingAccounts(publicKey, dontGetDetails) {
  const connection = _getConnection();
  const stakingAccounts = await connection.getParsedProgramAccounts(web3.StakeProgram.programId, {
    encoding: "jsonParsed",
    commitment: "recent",
    filters: [
      {
        memcmp: {
          offset: 44,
          bytes: publicKey, // base58 encoded string
        }
      }
    ],
  });
  if (!stakingAccounts.length) {
    return [];
  }

  const result = [];
  stakingAccounts.forEach(stakingAccount => {
    const stakeAccount = stakingAccount.pubkey.toBase58().toString();
    const rentExemptReserve = new BigNumber(stakingAccount.account.data.parsed.info.meta.rentExemptReserve).div(LAMPORTS_PER_SOL).toFixed();
    const stakeData = stakingAccount.account.data.parsed.info.stake;
    const activeStake = new BigNumber(stakeData.delegation.stake).div(LAMPORTS_PER_SOL).toFixed();
    console.log("🚀 ~ getStakingAccounts ~ activeStake:", activeStake)
    const balance = new BigNumber(stakingAccount.account.lamports).div(LAMPORTS_PER_SOL).toFixed();

    const obj = {
      stakeAccount,
      balance,
      rentExemptReserve,
      activationEpoch: parseInt(stakeData.delegation.activationEpoch),
      status: null,
      activeStake: activeStake,
      rewards: null,
      votePubkey: stakeData.delegation.voter
      // type: stakingAccount.account.data.parsed.type,
    };

    result.push(obj);
  });
  console.log("🚀 ~ getStakingAccounts ~ stakingAccounts:", stakingAccounts)
  if (dontGetDetails) {
    return result;
  }

  const delayTime = (60 / rateLimit) * 1000 + 50;
  const epochInfo = await connection.getEpochInfo();
  const currentEpoch = epochInfo.epoch
  console.log("🚀 ~ getStakingAccounts ~ currentEpoch:", currentEpoch)
  await forEachSeries(result, async (stakeAccountInfo) => {
    console.log("🚀 ~ awaitforEachSeries ~ stakeAccountInfo.activationEpoch:", stakeAccountInfo.activationEpoch)
    const pubkey = new web3.PublicKey(stakeAccountInfo.stakeAccount);
    const stakeStatus = await connection.getStakeActivation(pubkey);
    const status = stakeStatus.state;
    await sleep(delayTime);
    let rewards = 0
    if(BigNumber(stakeAccountInfo.activationEpoch).lt(currentEpoch)){
      const rewardInfo = await getInflationReward(connection, pubkey, stakeAccountInfo.activationEpoch + 1);
      console.log("🚀 ~ awaitforEachSeries ~ rewardInfo:", rewardInfo)
      if(rewardInfo){
        const stakeAmount = BigNumber(rewardInfo?.inflationReward?.postBalance).minus(rewardInfo?.inflationReward?.amount).toFixed()
        rewards = BigNumber(stakeAccountInfo.balance).minus(BigNumber(stakeAmount).div(LAMPORTS_PER_SOL)).toFixed()
      }
    }
    stakeAccountInfo.rewards = rewards;
    stakeAccountInfo.status = status;
    stakeAccountInfo.staked = BigNumber(stakeAccountInfo.activeStake).toFixed();
    stakeAccountInfo.activeStake = stakeAccountInfo.activeStake 
  });

  return result;
}

async function getStakingRewards(stakingAccounts) {
  return;
 
}

async function limit(jobs, limit) {
  if (!Array.isArray(jobs)) {
    throw new Error("First argument is not an array.");
  }

  const n = Math.min(limit || 5, jobs.length);
  const ret = [];
  let index = 0;

  const next = async () => {
    const i = index++;
    const job = jobs[i];
    ret[i] = await job();
    if (index < jobs.length) {
      await next();
    }
  };

  const next_arr = Array(n).fill(next);
  await Promise.all(next_arr.map((f) => {
    return f();
  }));

  return ret;
}

// if (typeof localStorage === "undefined" || localStorage === null) {
//   const LocalStorage = require("node-localstorage").LocalStorage;
//   // eslint-disable-next-line no-global-assign
//   localStorage = new LocalStorage("./scratch");
// }

function storeData(key, value) {
  try {
    const jsonValue = JSON.stringify(value);
    localStorage.setItem(key, jsonValue);
  } catch (e) {
    // saving error
  }
}

function getData(key) {
  try {
    const text = localStorage.getItem(key);
    if (text) {
      return JSON.parse(text);
    }
  } catch (e) {
    // error reading value
  }

  return null;
}

const getInflationReward = async (connection, pubkey, epoch, delayTime) => {
 

  try {
      const key = [
      "Inflation-Reward",
      pubkey,
      epoch,
    ].join("_").toUpperCase();
    let value = await getData(key);

    if (value) {
      return { cache: true, inflationReward: value }
    }
    const result = await connection.getInflationReward([pubkey], epoch);
    console.log("🚀 ~ getInflationReward ~ result:", result)
    value = result[0];
    // No reward
    if (value == null) {
      value = {
        amount: 0
      };
    }
    storeData(key, value);

    return { cache: false, inflationReward: value }
  } catch (error) {
    console.log("file: sign.SOL.js:716  getInflationReward  error", error);
  }

  return null;
};

async function unstakeSol({
  privateKey,
  stakePubkey,
}) {
  const wallet = privateKey ? new web3.Account(bs58.decode(privateKey)) : web3.Keypair.generate();
  const connection = _getConnection();
  // At anytime we can choose to deactivate our stake. Our stake account must be inactive before we can withdraw funds.
  const deactivateTx = web3.StakeProgram.deactivate({
    stakePubkey: new web3.PublicKey(stakePubkey),
    authorizedPubkey: wallet.publicKey,
  });
  const deactivateTxId = await web3.sendAndConfirmTransaction(
    connection,
    deactivateTx,
    [wallet]
  );
  // 

  return deactivateTxId;
}

async function getUnstakeFeeSol({
  publicKey,
  stakePubkey,
}) {
  const deactivateTx = web3.StakeProgram.deactivate({
    stakePubkey: new web3.PublicKey(stakePubkey),
    authorizedPubkey: new web3.PublicKey(publicKey),
  });
  const connection = _getConnection();
  const recentBlockhash = await connection.getRecentBlockhash();
  const manualTransaction = new web3.Transaction({
    recentBlockhash: recentBlockhash.blockhash,
    feePayer: new web3.PublicKey(publicKey),
  });
  manualTransaction.add(deactivateTx);

  const fee = await getEstimatedFee(manualTransaction);

  return fee;
}

async function withdrawStakeSol({
  privateKey,
  stakePubkey,
}) {
  const stakePubkey2 = new web3.PublicKey(stakePubkey);
  const wallet = privateKey ? new web3.Account(bs58.decode(privateKey)) : web3.Keypair.generate();
  const connection = _getConnection();

  // Check that stake is available
  const stakeBalance = await connection.getBalance(stakePubkey2);
  // Once deactivated, we can withdraw our SOL back to our main wallet
  const withdrawTx = web3.StakeProgram.withdraw({
    stakePubkey: stakePubkey2,
    authorizedPubkey: wallet.publicKey,
    toPubkey: wallet.publicKey,
    lamports: stakeBalance, // Withdraw the full balance at the time of the transaction
  });
  const withdrawTxId = await web3.sendAndConfirmTransaction(connection, withdrawTx, [
    wallet,
  ]);

  return withdrawTxId;
}

async function getWithdrawStakeFeeSol({
  publicKey,
  stakePubkey,
}) {
  const stakePubkey2 = new web3.PublicKey(stakePubkey);
  const walletPublicKey = new web3.PublicKey(publicKey);
  const connection = _getConnection();

  const withdrawTx = web3.StakeProgram.withdraw({
    stakePubkey: stakePubkey2,
    authorizedPubkey: walletPublicKey,
    toPubkey: walletPublicKey,
    lamports: 0,
  });

  const recentBlockhash = await connection.getRecentBlockhash();
  const manualTransaction = new web3.Transaction({
    recentBlockhash: recentBlockhash.blockhash,
    feePayer: new web3.PublicKey(publicKey),
  });
  manualTransaction.add(withdrawTx);

  const fee = await getEstimatedFee(manualTransaction);

  return fee;
}

async function getTotalStakedSOL(publicKey) {
  try {
    let total_staked = 0;
    const stake_accounts = await getStakingAccounts(publicKey);
    if (stake_accounts && stake_accounts.length) {
      total_staked = stake_accounts.reduce((accumulator, currentValue) => {
        return BigNumber(currentValue.activeStake).plus(accumulator).toNumber();
      }, 0);
    }
    return total_staked;
  } catch (error) {
    return 0;
  }
}

const service = {
  generateKeySol,
  transferSol,
  getFeeSol,
  getBalanceSol,
  verifyAddressSol,
  getHistorySol,
  stakeSol,
  unstakeSol,
  withdrawStakeSol,
  getEstimatedFee,
  getStakingAccounts,
  setSolApiUrl,
  getStakeFeeSol,
  getUnstakeFeeSol,
  getWithdrawStakeFeeSol,
  getMinimumStakeAmountSol,
  getSolVoteAccounts,
  getRentExemptionForSystemAccount,
  getValidatorInfo,
  getTotalStakedSOL,
  getRentExemptionForStakingAccount,
  getStakingRewards,
  setConfigSol,
  checkSendAmountSol,
  memo: "ROCKX-MS-SOL"
};

export default service;
// module.exports = service;
