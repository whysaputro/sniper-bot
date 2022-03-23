/* eslint-disable no-underscore-dangle */
class Token {
  constructor(tokenAddress, tokenABI, web3) {
    this._tokenAddress = tokenAddress;
    this._tokenABI = tokenABI;
    this._web3 = web3;

    this._tokenInstance = new this._web3.eth.Contract(this._tokenABI, this._tokenAddress);
  }

  async name() {
    return this._tokenInstance.methods.name().call();
  }

  async symbol() {
    return this._tokenInstance.methods.symbol().call();
  }

  async decimals() {
    return this._tokenInstance.methods.decimals().call();
  }
}

module.exports = { Token };
