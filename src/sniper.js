/* eslint-disable prefer-regex-literals, max-len, no-await-in-loop */
require('dotenv').config({ path: './.env' });

const Web3 = require('web3');
const Web3WsProvider = require('web3-providers-ws');
const colors = require('colors/safe');
const retry = require('async-retry');
const PancakeRouterABI = require('./ABI/pancakeRouter.json');
const BEP20ABI = require('./ABI/bep20.json');

const websocketOptions = {
  timeout: 30000, // ms

  clientConfig: {
    // Useful if requests are large
    maxReceivedFrameSize: 100000000, // bytes - default: 1MiB
    maxReceivedMessageSize: 100000000, // bytes - default: 8MiB

    // Useful to keep a connection alive
    keepalive: true,
    keepaliveInterval: 60000, // ms
  },

  // Enable auto reconnection
  reconnect: {
    auto: true,
    delay: 5000, // ms
    maxAttempts: 5,
    onTimeout: false,
  },
};

const websocket = new Web3WsProvider(process.env.WEBSOCKET, websocketOptions);
const web3 = new Web3(websocket);
const pancakeswap = new web3.eth.Contract(PancakeRouterABI, process.env.PANCAKE_ROUTER);
const addLiquidityETH = new RegExp('^0xf305d719');

web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY);

async function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitTransaction(txHash, { logs = false, action = '' } = {}) {
  let tx = null;

  while (tx == null) {
    tx = await web3.eth.getTransactionReceipt(txHash);
  }

  if (logs) {
    console.log(`${action} transaction confirmed: ${colors.green(`https://bscscan.com/tx/${txHash}`)}`);
  }

  return (tx.status);
}

async function approveToken(tokenAddress, receiver, amount) {
  try {
    const tokenInstance = new web3.eth.Contract(BEP20ABI, tokenAddress);
    const tokenName = await tokenInstance.methods.name().call();

    tokenInstance.methods.approve(receiver, amount).send({
      from: process.env.WALLET_ADDRESS,
      gas: process.env.GAS_LIMIT,
      gasPrice: web3.utils.toWei(process.env.GAS_PRICE, 'gwei'),
    }, async (error, txHash) => {
      if (error) {
        throw new Error(`Token could not be approved \n${error}`);
      }
      console.log(`Approve ${tokenName}: ${colors.yellow(txHash)}`);

      const status = await waitTransaction(txHash);
      if (!status) {
        console.log('Approval transaction failed');
      }
    });
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

async function scanMempool() {
  const mempool = web3.eth.subscribe('pendingTransactions', (error) => {
    if (error) console.log(error);
  });

  mempool.on('data', async (txHash) => {
    await web3.eth.getTransaction(txHash, (_, tx) => {
      if (tx && tx.to === process.env.pcs_router) {
        if (addLiquidityETH.test(tx.input)) {
          const decodeInput = web3.eth.abi.decodeParameters(
            [
              {
                type: 'address',
                name: 'token',
              },
              {
                type: 'uint256',
                name: 'amountTokenDesired',
              },
              {
                type: 'uint256',
                name: 'amountTokenMin',
              },
              {
                type: 'uint256',
                name: 'amountETHMin',
              },
              {
                type: 'address',
                name: 'to',
              },
              {
                type: 'uint256',
                name: 'deadline',
              },
            ],
            tx.input.slice(10),
          );

          if (decodeInput.token === process.env.purchaseToken) {
            console.log(`\nA liquidity added event has been found: ${tx.hash}`);

            mempool.unsubscribe((error) => {
              if (error) console.log(error);
            });

            return true;
          }
        }
      }
    });
  });
}

async function buyTokenWithAnotherToken(fromToken, toToken, purchaseAmount) {
  const toTokenInstance = new web3.eth.Contract(BEP20ABI, toToken);
  const toTokenName = await toTokenInstance.methods.name().call();
  const toTokenSymbol = await toTokenInstance.methods.symbol().call();

  const amountsIn = web3.utils.toWei(purchaseAmount, 'ether');
  const amountsOut = await pancakeswap.methods.getAmountsOut(amountsIn, [fromToken, toToken]).call();
  const amountsOutMin = web3.utils.toBN(amountsOut[1] * (1 - process.env.SLIPPAGE / 100));

  await retry(
    async () => {
      await pancakeswap.methods.swapExactTokensForTokens(
        amountsIn,
        amountsOutMin,
        [fromToken, toToken],
        process.env.WALLET_ADDRESS,
        Date.now() + 1000 * 60 * process.env.DEADLINE,
      ).send({
        from: process.env.WALLET_ADDRESS,
        gas: process.env.GAS_LIMIT,
        gasPrice: web3.utils.toWei(process.env.GAS_PRICE, 'gwei'),
      })
        .on('transactionHash', async (txHash) => {
          console.log(`\nBuy ${toTokenName} (${toTokenSymbol}): ${colors.yellow(txHash)}`);

          const status = await waitTransaction(txHash, { logs: true, action: 'Buy' });
          if (!status) {
            console.log(`Buy ${toTokenName} (${toTokenSymbol}) transaction failed`);
          }
        })
        .on('error', (error) => {
          console.error(error);
        });
    },
    {
      retries: 5,
      onRetry: (_, number) => {
        console.log(`Purchase Failed - Retrying ${colors.yellow(number)}`);
        if (number === 5) {
          console.log('Sniping failed...');
          process.exit(0);
        }
      },
    },
  );
}

async function buyTokenWithBNB(toToken, purchaseAmount) {
  const toTokenInstance = new web3.eth.Contract(BEP20ABI, toToken);
  const toTokenName = await toTokenInstance.methods.name().call();
  const toTokenSymbol = await toTokenInstance.methods.symbol().call();

  const amountsIn = web3.utils.toWei(purchaseAmount, 'ether');
  const amountsOut = await pancakeswap.methods.getAmountsOut(amountsIn, [process.env.WBNB_ADDRESS, toToken]).call();
  const amountsOutMin = web3.utils.toBN(amountsOut[1] * (1 - process.env.SLIPPAGE / 100));

  await retry(
    async () => {
      await pancakeswap.methods
        .swapExactETHForTokens(
          amountsOutMin,
          [process.env.WBNB_ADDRESS, process.env.PURCHASE_TOKEN_ADDRESS],
          process.env.WALLET_ADDRESS,
          Date.now() + 1000 * 60 * process.env.DEADLINE,
        )
        .send({
          from: process.env.WALLET_ADDRESS,
          value: web3.utils.toWei(purchaseAmount, 'ether'),
          gas: process.env.GAS_LIMIT,
          gasPrice: web3.utils.toWei(process.env.GAS_PRICE, 'gwei'),
        })
        .on('transactionHash', async (txHash) => {
          console.log(`\nBuy ${toTokenName} (${toTokenSymbol}): ${colors.yellow(txHash)}`);

          const status = await waitTransaction(txHash, { logs: true, action: 'Buy' });
          if (!status) {
            console.log(`Buy ${toTokenName} (${toTokenSymbol}) transaction failed`);
          }
        })
        .on('error', (error) => {
          console.error(error);
        });
    },
    {
      retries: 5,
      onRetry: (_, number) => {
        console.log(`Purchase Failed - Retrying ${colors.yellow(number)}`);
        if (number === 5) {
          console.log('Sniping failed...');
          process.exit(0);
        }
      },
    },
  );
}

async function init() {
  console.log(`
 ██████╗██╗   ██╗██████╗ ███████╗██████╗        ██████╗ ███╗   ██╗██╗
██╔════╝╚██╗ ██╔╝██╔══██╗██╔════╝██╔══██╗      ██╔═══██╗████╗  ██║██║
██║      ╚████╔╝ ██████╔╝█████╗  ██████╔╝█████╗██║   ██║██╔██╗ ██║██║
██║       ╚██╔╝  ██╔══██╗██╔══╝  ██╔══██╗╚════╝██║   ██║██║╚██╗██║██║
╚██████╗   ██║   ██████╔╝███████╗██║  ██║      ╚██████╔╝██║ ╚████║██║
 ╚═════╝   ╚═╝   ╚═════╝ ╚══════╝╚═╝  ╚═╝       ╚═════╝ ╚═╝  ╚═══╝╚═╝`);

  console.log('\nStarting PancakeSwap Bot Snipe!');
  await sleep(1000);
  console.log(colors.bgBlue('Scanning BSC Blockchain Mempool....'));
}

init();
