'use strict';

require('dotenv').config({ path: './.env' });
require('colors');

const Web3 = require('web3');
const ABI = require('./ABI.json');
const art = require('ascii-art');
const retry = require('async-retry');

const provider = new Web3.providers.WebsocketProvider(process.env.websocket, {
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
});

const web3 = new Web3(provider);
web3.eth.accounts.wallet.add(process.env.privateKey);

const functionHex = new RegExp('^0xf305d719');
const pancakeswap = new web3.eth.Contract(ABI, process.env.pcs_router);
const mempool = web3.eth.subscribe('pendingTransactions', function (err) {
  if (err) console.log(err);
});

const mempoolScanning = () => {
  mempool.on('data', async (txHash) => {
    await web3.eth.getTransaction(txHash, function (err, tx) {
      if (tx && tx.to === process.env.pcs_router) {
        if (functionHex.test(tx.input)) {
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
            tx.input.slice(10)
          );

          if (decodeInput.token === process.env.purchaseToken) {
            console.log(`\nA liquidity added event has been found: ${tx.hash}`);

            buyToken();

            mempool.unsubscribe((err) => {
              if (err) console.log(err);
            });
          }
        }
      }
    });
  });
};

const buyToken = async () => {
  const amountsIn = web3.utils.toWei(process.env.purchaseAmount);
  const amountsOut = await pancakeswap.methods
    .getAmountsOut(amountsIn, [
      process.env.wbnbAddress,
      process.env.purchaseToken,
    ])
    .call();
  const amountsOutMin = web3.utils.toBN(
    amountsOut[1] * (1 - process.env.slippage / 100)
  );

  await retry(
    async () => {
      await pancakeswap.methods
        .swapExactETHForTokens(
          amountsOutMin,
          [process.env.wbnbAddress, process.env.purchaseToken],
          process.env.walletAddress,
          Date.now() + 1000 * 60 * process.env.deadline
        )
        .send({
          from: process.env.walletAddress,
          value: web3.utils.toWei(process.env.purchaseAmount, 'ether'),
          gas: Number(process.env.gasLimit),
          gasPrice: web3.utils.toWei(process.env.gasPrice, 'gwei'),
        })
        .on('transactionHash', (txHash) => {
          console.log(
            `\nYour token purchase transaction hash: ${txHash}`.green
          );
          console.log(`Waiting for your transaction to confirmed`.yellow);
        })
        .on('confirmation', (confirmation, receipt) => {
          if (confirmation > 0) {
            console.log(
              `\nYour transaction has been confirmed: ${receipt.transactionHash}`
                .green
            );
            process.exit();
          }
        })
        .on('error', (error) => {
          console.log(error);
        });
    },
    {
      retries: 5,
      onRetry: (err, number) => {
        console.log(`Purchase Failed - Retrying ${number}`);
        if (number === 5) {
          console.log('Sniping has failed...');
          process.exit();
        }
      },
    }
  );
};

const init = () => {
  art.font('DEX-Snipe', 'Doom', (err, ascii) => {
    if (err) throw err;

    const rendered = art.style(ascii, 'cyan+overline+bold+italic', true);
    console.log(rendered);
    console.log('Starting PancakeSwap Bot Snipe!');
  });

  setTimeout(() => {
    console.log('\nScanning blockchain mempool...'.bgBlue);
    mempoolScanning();
  }, 3000);
};

init();
