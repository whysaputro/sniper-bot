/* eslint-disable prefer-regex-literals, max-len, no-await-in-loop, no-underscore-dangle, no-param-reassign, no-shadow, eqeqeq */
const Web3 = require('web3');
const colors = require('colors/safe');
const axios = require('axios');
const { Listr } = require('listr2');
const { banner } = require('./Libraries/banner');
const { addLiquidityETH, addLiquidity } = require('./Utilities/liquidityEvents');
const { finalize } = require('./Utilities/presaleEvents');
const { BEP20ABI, PancakeRouterABI } = require('./Utilities/ABI');
const { Token } = require('./Class/Token');

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

const websocket = new Web3.providers.WebsocketProvider(process.env.WEBSOCKET, websocketOptions);
const web3 = new Web3(websocket);
const pancakeswap = new web3.eth.Contract(PancakeRouterABI, process.env.PANCAKE_ROUTER);

web3.eth.Contract.handleRevert = true;
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

        checkTokenTax(toToken).then((tax) => {
          if (tax.buyTax > 20 ) {
            reject(new Error('Buy tax more than expected'));
          }
        })

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
            reject(new Error('Snipping failed'));
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

        checkTokenTax(toToken).then((tax) => {
          if (tax.buyTax > 20 ) {
            reject(new Error('Buy tax more than expected'));
          }
        })

        pancakeswap.methods.swapExactETHForTokens(
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
            reject(new Error('Snipping failed'));
          });
      });
  });
}

function checkTokenTax(tokenAddress) {
  return new Promise((resolve, reject) => {
    axios.get('https://api.cyberoni.org/honeypot/', {
      params: {
        address: tokenAddress,
      },
    })
      .then(({ data: { data } }) => {
        resolve(data);
      })
      .catch((err) => {
        reject(new Error(err));
      });
  });
}

function scanningMempool(tokenAddress, mempool) {
  return new Promise((resolve, reject) => {
    mempool.on('data', (txHash) => {
      web3.eth.getTransaction(txHash, (error, transaction) => {
        if (error) reject(new Error(error));

        if (transaction && transaction.to === process.env.PANCAKE_ROUTER) {
          if (addLiquidityETH.hex.test(transaction.input)) {
            const decodedAddLiquidityETH = web3.eth.abi.decodeParameters(
              addLiquidityETH.parameters,
              transaction.input.slice(10),
            );

            if (decodedAddLiquidityETH.token.toLowerCase() == tokenAddress.toLowerCase()) {
              resolve(transaction.hash);
            }
          }

          if (addLiquidity.hex.test(transaction.input)) {
            const decodedAddLiquidity = web3.eth.abi.decodeParameters(
              addLiquidity.parameters,
              transaction.input.slice(10),
            );

            if (decodedAddLiquidity.tokenA.toLowerCase() == tokenAddress.toLowerCase()
              || decodedAddLiquidity.tokenB.toLowerCase() == tokenAddress.toLowerCase()) {
              resolve(transaction.hash);
            }
          }
        }
      });
    });
  });
}

function scanMempoolForPresale(presaleAddress, mempool) {
  return new Promise((resolve, reject) => {
    mempool.on('data', (txHash) => {
      web3.eth.getTransaction(txHash, (error, transaction) => {
        if (error) reject(new Error(error));

        if (transaction && transaction.to === presaleAddress.toLowerCase()) {
          finalize.hex.test(transaction.input) ? resolve(transaction.hash) : reject(new Error('Add liquidity event not found'));
        }
      });
    });
  });
}

async function init() {
  try {
    banner.show();

    const ctx = {};

    const initializeTask = new Listr([
      {
        title: colors.blue('Initiating Sniper BOT...!'),
        task: (_, task) => task.newListr([
          {
            title: 'Token address ?',
            task: async (ctx, task) => {
              ctx.tokenAddress = await task.prompt({
                type: 'input',
                message: 'Input token address want to snipe',
                required: true,
              });

              task.title = `Token Detail:`;

              ctx.tokenInstance = new Token(ctx.tokenAddress, BEP20ABI, web3);

              return task.newListr([
                {
                  title: 'Checking token address',
                  task: async (ctx, task) => {
                    task.title = `Token address: ${ await ctx.tokenAddress }`;
                  }
                },
                {
                  title: 'Checking token name',
                  task: async (ctx, task) => {
                    task.title = `Token name: ${ await ctx.tokenInstance.name() }`;
                  }
                },
                {
                  title: 'Checking token symbol',
                  task: async (ctx, task) => {
                    task.title = `Token symbol: ${ await ctx.tokenInstance.symbol() }`;
                  }
                },
                {
                  title: 'Checking token decimals',
                  task: async (ctx, task) => {
                    task.title = `Token decimals: ${ await ctx.tokenInstance.decimals() }`;
                  }
                },
              ], { concurrent: true })
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

              task.title = `Token pair: ${ctx.tokenPair}`;
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

              task.title = `How much will you buy: ${ctx.purchaseAmount} ${ctx.tokenPair}`;
            },
          },
          {
            title: 'Does the token launch IDO on PinkSale ?',
            task: async (ctx, task) => {
              ctx.pinkSaleIDO = await task.prompt({
                type: 'Toggle',
                message: 'Choose the options',
                initial: true,
              });

              task.title = `Does the token launch IDO on PinkSale: ${ctx.pinkSaleIDO ? 'Yes' : 'No'}`;
            },
          },
        ], { ctx, concurrent: false, rendererOptions: { collapse: false } }),
      }
    ])

    const snipeTokenTask = new Listr([
      {
        title: 'Approving BUSD/USDT token',
        skip: (ctx) => ctx.tokenPair === 'BNB',
        task: async (ctx, task) => {
          const tokenPairAddress = ctx.tokenPair === 'BUSD' ? process.env.BUSD_ADDRESS : process.env.USDT_ADDRESS;
          const txHash = await approveToken(tokenPairAddress, ctx.purchaseAmount);
          task.title = `${colors.green(`${ctx.tokenPair} approved for trade:`)} https://bscscan.com/tx/${txHash}`;
        },
      },
      {
        title: 'Scanning mempool...',
        task: async (ctx, task) => {
          const mempool = web3.eth.subscribe('pendingTransactions');

          if (!ctx.pinkSaleIDO) {
            const txHash = await scanningMempool(ctx.tokenAddress, mempool);
            task.title = `${colors.green('Liquidity transaction detected in mempool:')} https://bscscan.com/tx/${txHash}`;
          } else {
            const txHash = await scanMempoolForPresale(ctx.tokenAddress, mempool);
            task.title = `${colors.green('Liquidity transaction detected in mempool:')} https://bscscan.com/tx/${txHash}`;
          }

          mempool.unsubscribe();
        },
      },
      {
        title: 'Snipping the token',
        task: async (ctx, task) => {
          if (ctx.tokenPair === 'BNB') {
            const txHash = await buyTokenWithBNB(ctx.tokenAddress, ctx.purchaseAmount);
            task.title = `${colors.green('Sniping success:')} https://bscscan.com/tx/${txHash}`;
          }

          if (ctx.tokenPair !== 'BNB') {
            const tokenPairAddress = ctx.tokenPair === 'BUSD' ? process.env.BUSD_ADDRESS : process.env.USDT_ADDRESS;
            const txHash = await buyToken(tokenPairAddress, ctx.tokenAddress, ctx.purchaseAmount);
            task.title = `${colors.green('Sniping success:')} https://bscscan.com/tx/${txHash}`;
          }
        },
        retry: 100,
      },
    ], {
      ctx,
      concurrent: false,
      exitOnError: true,
      registerSignalListeners: false,
    });

    await initializeTask.run({ ctx });
    
    await snipeTokenTask.run({ ctx })
    .then(() => {
      process.exit(0);
    })

  } catch(err) {
    console.error(err);
  }
}

init();
