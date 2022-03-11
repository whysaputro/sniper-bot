const addLiquidityETH = {
  hex: /^0xf305d719/,
  parameters: [
    { type: 'address', name: 'token' },
    { type: 'uint256', name: 'amountTokenDesired' },
    { type: 'uint256', name: 'amountTokenMin' },
    { type: 'uint256', name: 'amountETHMin' },
    { type: 'address', name: 'to' },
    { type: 'uint256', name: 'deadline' },
  ],
};

const addLiquidity = {
  hex: /^0xe8e33700/,
  parameters: [
    { type: 'address', name: 'tokenA' },
    { type: 'address', name: 'tokenB' },
    { type: 'uint256', name: 'amountADesired' },
    { type: 'uint256', name: 'amountBDesired' },
    { type: 'uint256', name: 'amountAMin' },
    { type: 'uint256', name: 'amountBMin' },
    { type: 'address', name: 'to' },
    { type: 'uint256', name: 'deadline' },
  ],
};

const finalize = {
  hex: /^0x4bb278f3/,
};

module.exports = { addLiquidityETH, addLiquidity, finalize };
