const MockDAI = artifacts.require('MockDAI');
const MockUSDC = artifacts.require('MockUSDC');
const MockUSDT = artifacts.require('MockUSDT');
const { contractInheritHandler } = require('../../internal-utils');

async function getDetailed(mockToken) {
    const name = await mockToken.name();
    const symbol = await mockToken.symbol();
    const decimals = await mockToken.decimals();

    return { address: mockToken.address, name, symbol, decimals };
}

const newMockDAI = async () => {
    const mockDAI = await MockDAI.new();

    const obj = {
        _parent: mockDAI,
        _name: 'MockDAI',
        parent: () => { return obj._parent; },
        detailed: await getDetailed(mockDAI),
    };
    return new Proxy(obj, contractInheritHandler);
};

const newMockUSDC = async () => {
    const mockUSDC = await MockUSDC.new();

    const obj = {
        _parent: mockUSDC,
        _name: 'mockUSDC',
        parent: () => { return obj._parent; },
        detailed: await getDetailed(mockUSDC),
    };
    return new Proxy(obj, contractInheritHandler);
};

const newMockUSDT = async () => {
    mockUSDT = await MockUSDT.new();

    const obj = {
        _parent: mockUSDT,
        _name: 'mockUSDT',
        parent: () => { return obj._parent; },
        detailed: await getDetailed(mockUSDT),
    };
    return new Proxy(obj, contractInheritHandler);
};

const newMockTokens = async () => {
    return [
        await newMockDAI(),
        await newMockUSDC(),
        await newMockUSDT()
    ]
}

module.exports = {
    newMockDAI,
    newMockUSDC,
    newMockUSDT,
    newMockTokens
};