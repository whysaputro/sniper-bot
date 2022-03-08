/* eslint-disable prefer-regex-literals, max-len, no-await-in-loop, no-underscore-dangle, no-param-reassign, no-shadow */
const Web3 = require('web3');
const Web3WsProvider = require('web3-providers-ws');
const colors = require('colors/safe');
const { Listr } = require('listr2');
const { version } = require('../package.json');
const Token = require('./Class/Token');
const PancakeRouterABI = require('./ABI/pancakeRouter.json');
const BEP20ABI = require('./ABI/bep20.json');
const addLiquidityETH = require('./Utilities/addLiquidityETH');
const addLiquidity = require('./Utilities/addLiquidity');

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
const mempool = web3.eth.subscribe('pendingTransactions', (error) => {
  if (error) console.log(error);
});

web3.eth.accounts.wallet.add(process.env.PRIVATE_KEY);

function approveToken(tokenAddress, amount) {
  return new Promise((resolve, reject) => {
    const tokenInstance = new web3.eth.Contract(BEP20ABI, tokenAddress);
    const amountInWei = web3.utils.toWei(String(amount), 'ether');

    tokenInstance.methods.approve(process.env.PANCAKE_ROUTER, amountInWei).send({
      from: process.env.WALLET_ADDRESS,
      gas: process.env.GAS_LIMIT,
      gasPrice: web3.utils.toWei(process.env.GAS_PRICE, 'gwei'),
    })
      .on('confirmation', (confirmationNumber, receipt) => {
        if (confirmationNumber > 0) resolve(receipt.transactionHash);
      })
      .on('error', () => {
        reject(new Error('Token could not be approved'));
      });
  });
}

function buyToken(fromToken, toToken, purchaseAmount) {
  return new Promise((resolve, reject) => {
    const amountsIn = web3.utils.toWei(String(purchaseAmount), 'ether');
    pancakeswap.methods.getAmountsOut(amountsIn, [fromToken, toToken]).call({ from: process.env.WALLET_ADDRESS })
      .then((amountsOut) => {
        const amountsOutMin = web3.utils.toBN(amountsOut[1] * (1 - process.env.SLIPPAGE / 100));
        pancakeswap.methods.swapExactTokensForTokens(
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
          .on('confirmation', (confirmationNumber, receipt) => {
            if (confirmationNumber > 0) resolve(receipt.transactionHash);
          })
          .on('error', () => {
            reject(new Error('Buy token failed'));
          });
      });
  });
}

function buyTokenWithBNB(toToken, purchaseAmount) {
  return new Promise((resolve, reject) => {
    const amountsIn = web3.utils.toWei(String(purchaseAmount), 'ether');
    pancakeswap.methods.getAmountsOut(amountsIn, [process.env.WBNB_ADDRESS, toToken]).call({ from: process.env.WALLET_ADDRESS })
      .then((amountsOut) => {
        const amountsOutMin = web3.utils.toBN(amountsOut[1] * (1 - process.env.SLIPPAGE / 100));
        pancakeswap.methods
          .swapExactETHForTokens(
            amountsOutMin,
            [process.env.WBNB_ADDRESS, toToken],
            process.env.WALLET_ADDRESS,
            Date.now() + 1000 * 60 * process.env.DEADLINE,
          )
          .send({
            from: process.env.WALLET_ADDRESS,
            value: web3.utils.toWei(String(purchaseAmount), 'ether'),
            gas: process.env.GAS_LIMIT,
            gasPrice: web3.utils.toWei(process.env.GAS_PRICE, 'gwei'),
          })
          .on('confirmation', (confirmationNumber, receipt) => {
            if (confirmationNumber > 0) resolve(receipt.transactionHash);
          })
          .on('error', () => {
            reject(new Error('Buy token failed'));
          });
      });
  });
}

function scanningMempool(tokenAddress) {
  return new Promise((resolve, reject) => {
    mempool.on('data', (txHash) => {
      web3.eth.getTransaction(txHash, async (error, transaction) => {
        if (error) reject(new Error(error));

        if (transaction && transaction.to === process.env.PANCAKE_ROUTER) {
          if (addLiquidityETH.hex.test(transaction.input)) {
            const decodedAddLiquidityETH = web3.eth.abi.decodeParameters(
              addLiquidityETH.parameters,
              transaction.input.slice(10),
            );
            if (decodedAddLiquidityETH.token === tokenAddress) {
              resolve(transaction.transactionHash);
            }
          }

          if (addLiquidity.hex.test(transaction.input)) {
            const decodedAddLiquidity = web3.eth.abi.decodeParameters(
              addLiquidity.parameters,
              transaction.input.slice(10),
            );

            if (decodedAddLiquidity.tokenA === tokenAddress || decodedAddLiquidity.tokenB === tokenAddress) {
              resolve(transaction.transactionHash);
            }
          }
        }
      });
    });
  });
}

async function init() {
  console.log(`
 ██████╗██╗   ██╗██████╗ ███████╗██████╗        ██████╗ ███╗   ██╗██╗
██╔════╝╚██╗ ██╔╝██╔══██╗██╔════╝██╔══██╗      ██╔═══██╗████╗  ██║██║
██║      ╚████╔╝ ██████╔╝█████╗  ██████╔╝█████╗██║   ██║██╔██╗ ██║██║
██║       ╚██╔╝  ██╔══██╗██╔══╝  ██╔══██╗╚════╝██║   ██║██║╚██╗██║██║
╚██████╗   ██║   ██████╔╝███████╗██║  ██║      ╚██████╔╝██║ ╚████║██║
 ╚═════╝   ╚═╝   ╚═════╝ ╚══════╝╚═╝  ╚═╝       ╚═════╝ ╚═╝  ╚═══╝╚═╝ v${version}\n`);

  const tasks = new Listr([
    {
      title: colors.green('Initiating Sniper BOT...!'),
      task: () => new Listr([
        {
          title: 'Token address ?',
          task: async (ctx, task) => {
            ctx.tokenAddress = await task.prompt({
              type: 'input',
              message: 'Input token address want to snipe',
              required: true,
            });
          },
        },
        {
          title: 'Token pair ?',
          task: async (ctx, task) => {
            ctx.tokenPair = await task.prompt({
              type: 'select',
              message: 'Choose token pair',
              choices: ['BNB', 'BUSD', 'USDT'],
            });
          },
        },
        {
          title: 'How much BNB/BUSD/USDT will you use to buy the token ?',
          task: async (ctx, task) => {
            ctx.purchaseAmount = await task.prompt({
              type: 'numeral',
              message: 'Input WBNB/BUSD/USDT amount',
              initial: 0.1,
            });
          },
        },
      ], { concurrent: false }),
    },
    {
      title: 'Approving BUSD/USDT token',
      skip: (ctx) => ctx.tokenPair === 'BNB',
      task: async (ctx, task) => {
        const tokenPairAddress = ctx.tokenPair === 'BUSD' ? process.env.BUSD_ADDRESS : process.env.USDT_ADDRESS;
        const txHash = await approveToken(tokenPairAddress, ctx.purchaseAmount);
        task.title = `Approving BUSD/USDT token: ${colors.green(`https://bscscan.com/tx/${txHash}`)}`;
      },
    },
    {
      title: 'Scanning mempool...',
      skip: () => true,
      task: async (ctx, task) => {
        const txHash = await scanningMempool(ctx.tokenAddress);
        task.title = `Sniping the token: ${txHash}`;
        mempool.unsubscribe();
      },
    },
    {
      title: 'Sniping the token',
      task: async (ctx, task) => {
        switch (ctx.tokenPair) {
          case 'BNB': {
            const txHash = await buyTokenWithBNB(ctx.tokenAddress, ctx.purchaseAmount);
            task.title = `Sniping the token: ${colors.green(`https://bscscan.com/tx/${txHash}`)}`;
            break;
          }
          default: {
            const tokenPairAddress = ctx.tokenPair === 'BUSD' ? process.env.BUSD_ADDRESS : process.env.USDT_ADDRESS;
            const txHash = await buyToken(tokenPairAddress, ctx.tokenAddress, ctx.purchaseAmount);
            task.title = `Sniping the token: ${colors.green(`https://bscscan.com/tx/${txHash}`)}`;
          }
        }
      },
    },
  ]);

  tasks.run();
}

init();
