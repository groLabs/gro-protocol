const MockAggregatorC = artifacts.require('MockAggregator')
const MockLPT = artifacts.require('CurveTokenV2');
const CurvePool = artifacts.require('StableSwap3Pool');
const { toBN } = require('web3-utils');

const chainPrice = [toBN('100113015'), toBN('100012144'), toBN('100182073')];

const newMockLPT = async () => {
    return await MockLPT.new('LPT', 'LPT', '18', 0);
}

const newMockCurvePool = async (lpt, tokens) => {
    const [mockDAI, mockUSDC, mockUSDT] = tokens;
    const tokenAddresses = [mockDAI.address, mockUSDC.address, mockUSDT.address];
    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];

    const _owner = deployer;
    const _pool_token = lpt.address;
    const _A = '200';
    const _fee = '4000000';
    const _admin_fee = '5000000000';
    const _coins = tokenAddresses;
    const pool = await CurvePool.new(_owner, _coins, _pool_token, _A, _fee, _admin_fee);
    await lpt.set_minter(pool.address);

    //Move liqudity to 3pool
    const daiAmount = toBN('80680263104350346499142980');
    const usdcAmount = toBN('111455923585020');
    const usdtAmount = toBN('70015480219396');
    await mockDAI.mint(deployer, daiAmount);
    await mockUSDC.mint(deployer, usdcAmount);
    await mockUSDT.mint(deployer, usdtAmount);

    await mockDAI.approve(pool.address, daiAmount);
    await mockUSDC.approve(pool.address, usdcAmount);
    await mockUSDT.approve(pool.address, usdtAmount);

    const am_ = [daiAmount, usdcAmount, usdtAmount];

    await pool.add_liquidity(
        am_, 0, { gas: '6721975' });

    return pool;
}

const newMockChainAgg = async () => {

    const mockDaiEthAgg = await MockAggregatorC.new(chainPrice[0]);
    const mockUsdcEthAgg = await MockAggregatorC.new(chainPrice[1]);
    const mockUsdtEthAgg = await MockAggregatorC.new(chainPrice[2]);

    return [mockDaiEthAgg, mockUsdcEthAgg, mockUsdtEthAgg];
}

module.exports = {
    newMockLPT, newMockCurvePool, newMockChainAgg,
};
