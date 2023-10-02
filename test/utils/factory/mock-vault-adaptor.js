const MockVaultAdaptor = artifacts.require('MockVaultAdaptor');
const TestStrategy = artifacts.require('TestStrategy');
const { convertInputToContractAddr } = require('../contract-utils');
const { contractInheritHandler } = require('./internal-utils');

const newMockDAIVaultAdaptor = async (controller, daiAddress) => {
    const governance = await controller.owner();
    const mockDAIVaultAdaptor = await MockVaultAdaptor.new();
    await mockDAIVaultAdaptor.setUnderlyingToken(daiAddress, { from: governance });
    const lifeguardAddr = await controller.lifeGuard();
    //await mockDAIVaultAdaptor.addToWhitelist(lifeguardAddr, { from: governance })
    const obj = {
        _parent: mockDAIVaultAdaptor,
        _name: 'MockDAIVaultAdaptor',
        parent: () => { return obj._parent; },
    };
    return new Proxy(obj, contractInheritHandler);
};

const newMockUSDCVaultAdaptor = async (controller, usdcAddress) => {
    const governance = await controller.owner();
    const mockUSDCVaultAdaptor = await MockVaultAdaptor.new();
    await mockUSDCVaultAdaptor.setUnderlyingToken(usdcAddress, { from: governance });
    const lifeguardAddr = await controller.lifeGuard();
    //await mockUSDCVaultAdaptor.addToWhitelist(lifeguardAddr, { from: governance })
    const obj = {
        _parent: mockUSDCVaultAdaptor,
        _name: 'MockUSDCVaultAdaptor',
        parent: () => { return obj._parent; },
    };
    return new Proxy(obj, contractInheritHandler);
};

const newMockUSDTVaultAdaptor = async (controller, usdtAddress) => {
    const governance = await controller.owner();
    const mockUSDTVaultAdaptor = await MockVaultAdaptor.new();
    await mockUSDTVaultAdaptor.setUnderlyingToken(usdtAddress, { from: governance });
    const lifeguardAddr = await controller.lifeGuard();
    //await mockUSDTVaultAdaptor.addToWhitelist(lifeguardAddr, { from: governance })
    const obj = {
        _parent: mockUSDTVaultAdaptor,
        _name: 'MockUSDTVaultAdaptor',
        parent: () => { return obj._parent; },
    };
    return new Proxy(obj, contractInheritHandler);
};

const newMockVaultAdaptors = async (controller) => {
    const tokens = await controller.stablecoins();
    return [
        await newMockDAIVaultAdaptor(controller, tokens[0]),
        await newMockUSDCVaultAdaptor(controller, tokens[1]),
        await newMockUSDTVaultAdaptor(controller, tokens[2]),
    ];
};

module.exports = {
    newMockDAIVaultAdaptor,
    newMockUSDCVaultAdaptor,
    newMockUSDTVaultAdaptor,
    newMockVaultAdaptors,
};
