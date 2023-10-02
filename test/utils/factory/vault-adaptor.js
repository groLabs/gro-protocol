const VaultAdaptorYearn = artifacts.require('VaultAdaptorYearnV2_032')
const YearnVault = artifacts.require('Vault')
const MockStrategy = artifacts.require('TestStrategy');
const { contractInheritHandler } = require('./internal-utils');
const { newMockXPoolStrategy, newMockGenericLendingStrategy, newMockHarvestStrategy } = require('./dependency/local/vault');
const { toBN } = require('web3-utils')
const depositLimit = toBN('10000000000')

const newVaultAdaptor = async (governance, token) => {

    const rewards = governance
    const guardian = governance
    const vault = await YearnVault.new()
    await vault.initialize(
        token.address,
        governance,
        token.symbol,
        guardian,
    )
    const adaptor = await VaultAdaptorYearn.new(vault.address, token.address);
    await vault.setManagement(adaptor.address, {
        from: governance,
    })
    await vault.setVaultAdapter(adaptor.address, {
        from: governance,
    })
    const baseNum = toBN(10).pow(token.decimals)
    await vault.setDepositLimit(depositLimit.mul(baseNum), {
        from: governance,
    })
    return [adaptor, vault];
}

const initVaultAdaptor = async (controller, adaptor, vault, token, strategyGen) => {
    const baseNum = toBN(10).pow(token.decimals)

    const governance = await controller.owner()
    const rewards = governance
    const guardian = governance
    const insAddr = await controller.insurance()
    const pnlAddr = await controller.pnl()
    const lifeguardAddr = await controller.lifeGuard()
    const withdrawHandlerAddr = await controller.withdrawHandler()
    // const emhAddr = await controller.emh()
    await adaptor.setController(controller.address, {
        from: governance,
    })
    // await adaptor.setWithdrawHandler(withdrawHandlerAddr, emhAddr, {
    //     from: governance,
    // })
    // await adaptor.setInsurance(insAddr, {
    //     from: governance,
    // })
    // await adaptor.setLifeguard(lifeguardAddr, {
    //     from: governance,
    // })
    await adaptor.addToWhitelist(governance, {
        from: governance,
    })
    await adaptor.addToWhitelist(lifeguardAddr, {
        from: governance,
    })

    const strategyInfos = await strategyGen.func(governance, adaptor, vault, strategyGen.mainnet);
    const strategyCount = strategyInfos[0].length;
    await adaptor.setStrategiesLength(strategyCount, { from: governance })
    // add strategy to vault
    const botLimit = toBN(0)
    const topLimit = toBN(2).pow(toBN(256)).sub(toBN(1));
    const performanceFee = toBN(100);
    for (let i = 0; i < strategyCount; i++) {
        await vault.addStrategy(
            strategyInfos[0][i].address,
            strategyInfos[1][i],
            botLimit, topLimit,
            { from: governance },
        )
    };

    const obj = {
        _name: token.name + 'VaultAdaptor',
        _parent: adaptor,
        parent: () => {
            return obj._parent
        },
        vault: vault,
        strategies: strategyInfos[0],
    }
    return new Proxy(obj, contractInheritHandler)
}

const stablecoinVaultStrategyGen = async (governance, adaptor, vault, mainnet) => {
    let firstStrategy, secondStrategy
    if (mainnet) {
        firstStrategy = await newHarvestStrategy(governance, adaptor, vault);
        secondStrategy = await newGenericLendingStrategy(adaptor, vault);
    } else {
        firstStrategy = await newMockHarvestStrategy(adaptor, vault);
        secondStrategy = await newMockGenericLendingStrategy(adaptor, vault);
    }

    return [[firstStrategy, secondStrategy], [toBN(6000), toBN(4000)]];
}

const curveVaultStrategyGen = async (governance, adaptor, vault, mainnet) => {
    let firstStrategy

    if (mainnet) {
        firstStrategy = await newXPoolStrategy(adaptor, vault);
    } else {
        firstStrategy = await newMockXPoolStrategy(adaptor, vault);
    }

    return [[firstStrategy], [toBN(10000)]];
}

const newStablecoinVaultAdaptor = async (governance, token) => {
    return newVaultAdaptor(governance, token);
}

const initStablecoinVaultAdaptor = async (controller, vaultAdapter, vault, token, mainnet) => {
    return initVaultAdaptor(controller, vaultAdapter, vault, token, { func: stablecoinVaultStrategyGen, mainnet });
}

const newCurveVaultAdaptor = async (governance, token) => {
    return newVaultAdaptor(governance, token);
}

const initCurveVaultAdaptor = async (controller, vaultAdapter, vault, token, mainnet) => {
    return initVaultAdaptor(controller, vaultAdapter, vault, token, { func: curveVaultStrategyGen, mainnet });
}
module.exports = {
    newStablecoinVaultAdaptor,
    initStablecoinVaultAdaptor,
    newCurveVaultAdaptor,
    initCurveVaultAdaptor,
}
