//const ChainLinkOracle = artifacts.require('ChainPrice');
const Buoy = artifacts.require('Buoy3Pool');
const Aggregatorv3 = artifacts.require('AggregatorV3Interface')
const LifeGuard = artifacts.require('LifeGuard3Pool');
const { contractInheritHandler } = require('./internal-utils');
const { newMockLPT, newMockCurvePool, newMockChainAgg } = require('./dependency/local/lifeguard');
const decimals = ['1000000000000000000', '1000000', '1000000']

// tokens = [mockDAI.address, mockUSDC.address, mockUSDT.address];
const initLifeGuard = async (governance, tokens, mainnet) => {
    const [DAI, USDC, USDT] = tokens;
    const tokenAddresses = [DAI.address, USDC.address, USDT.address];

    let lpt, curvePool, aggregators;
    if (mainnet) {
        lpt = await LPT();
        curvePool = await Curve3Pool();
        daiAgg = await Aggregatorv3.at(daiEthAgg);
        usdcAgg = await Aggregatorv3.at(usdcEthAgg);
        usdtAgg = await Aggregatorv3.at(usdtEthAgg);
        aggregators = [daiAgg, usdcAgg, usdtAgg]
    } else {
        lpt = await newMockLPT();
        curvePool = await newMockCurvePool(lpt, tokens);
        aggregators = await newMockChainAgg();
    }

    const buoy = await Buoy.new(
        curvePool.address,
        tokenAddresses,
        decimals,
        [aggregators[0].address, aggregators[1].address, aggregators[2].address]
    );

    const lifeguard = await LifeGuard.new(curvePool.address, lpt.address, buoy.address, tokenAddresses, decimals);
    await lifeguard.addToWhitelist(governance, { from: governance });

    return [lifeguard, curvePool, buoy, lpt, buoy, aggregators];
};

const newLifeGuard = async (controller, tokens, mainnet) => {
    const governance = await controller.owner();
    const insurance = await controller.insurance();
    const [lifeguard, pool, buoy, lpt, chainPrice, aggregators] = await initLifeGuard(governance, tokens, mainnet);
    await lifeguard.setController(controller.address);

    const obj = {
        _name: 'LifeGuard',
        _parent: lifeguard,
        parent: () => { return obj._parent; },
        pool: pool,
        buoy: buoy,
        lpt: lpt,
        chainPrice: chainPrice,
        aggregators: aggregators,
    };
    return new Proxy(obj, contractInheritHandler);
};

module.exports = {
    newLifeGuard,
};
