const MockStrategy = artifacts.require('TestStrategy');

const newMockXPoolStrategy = async (adaptor, vault) => {
    const strategy = await MockStrategy.new(vault.address)
    await strategy.setKeeper(adaptor.address)
    return strategy
}

const newMockGenericLendingStrategy = async (adaptor, vault) => {
    const strategy = await MockStrategy.new(vault.address)
    await strategy.setKeeper(adaptor.address)
    return strategy
}

const newMockHarvestStrategy = async (adaptor, vault) => {
    const strategy = await MockStrategy.new(vault.address)
    await strategy.setKeeper(adaptor.address)
    return strategy
}

module.exports = {
    newMockXPoolStrategy,
    newMockGenericLendingStrategy,
    newMockHarvestStrategy,
}