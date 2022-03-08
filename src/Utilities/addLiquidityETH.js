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

module.exports = addLiquidityETH;
