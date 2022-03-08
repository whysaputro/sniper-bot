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

module.exports = addLiquidity;
