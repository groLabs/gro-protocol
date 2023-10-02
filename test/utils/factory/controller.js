const Controller = artifacts.require('Controller');
const WithdrawHandler = artifacts.require('WithdrawHandler');
const DepositHandler = artifacts.require('DepositHandler');
const EmergencyHandler = artifacts.require('EmergencyHandler');
const { newPwrdToken, newGvtToken } = require('./gtoken');
const { newPnL } = require('./pnl');
const { newInsurance } = require('./insurance');
const { newLifeGuard } = require('./lifeguard');
const {
    newStablecoinVaultAdaptor,
    initStablecoinVaultAdaptor,
    newCurveVaultAdaptor,
    initCurveVaultAdaptor
} = require('./vault-adaptor');
const { toBN } = require('web3-utils');
const { newMockTokens } = require('./dependency/local/stablecoins');
const { contractInheritHandler } = require('./internal-utils');
const {
    convertInputToContractAddr,
    batchApprove, slipping,
    defaultSlippagePercent, defaultSlippageBaseNum,
} = require('../contract-utils');
const { ZERO } = require('../common-utils');
const { getDetailed } = require('../token-utils');
const { constants } = require('../constants');
const decimals = ['1000000000000000000', '1000000', '1000000']

const newWithdrawHandler = async (controller, pwrd, gvt, emh, tokens, adaptors) => {
    const governance = await controller.owner();
    const withdrawHandler = await WithdrawHandler.new(adaptors, tokens, decimals);
    await withdrawHandler.setController(controller.address, { from: governance });
    return withdrawHandler;
}

const newDepositHandler = async (controller, pwrd, gvt, tokens, adaptors) => {
    const governance = await controller.owner();
    const depositHandler = await DepositHandler.new(adaptors, tokens, decimals);
    await depositHandler.setController(controller.address, { from: governance });
    return depositHandler;
}

const newEmergencyHandler = async (controller, pwrd, gvt, chainPrice, tokens, adaptors) => {
    const governance = await controller.owner();
    const emergencyHandler = await EmergencyHandler.new(pwrd, gvt, chainPrice, adaptors, tokens, decimals);
    await emergencyHandler.setController(controller.address, { from: governance });
    return emergencyHandler;
}

const newController = async (mainnet = false, upgradable = false) => {
    const accounts = await web3.eth.getAccounts();
    const deployer = accounts[0];
    const governance = deployer;

    const gvt = await newGvtToken(governance, upgradable);
    const pwrd = await newPwrdToken(governance, upgradable);
    // set underlying tokens
    let tokens;
    if (mainnet)
        tokens = await newTokens();
    else {
        tokens = await newMockTokens();
    };
    let tokenAddresses = [];
    for (let i = 0; i < tokens.length; i++) {
        tokenAddresses[i] = tokens[i].address;
    }

    const adaptors = [];
    const adaptorAddresses = [];
    const vaults = [];
    // set stablecoin vaults
    for (let i = 0; i < tokenAddresses.length; i++) {
        [adaptors[i], vaults[i]] = await newStablecoinVaultAdaptor(governance, tokens[i].detailed);
        adaptorAddresses[i] = adaptors[i].address;
    }
    const controller = await Controller.new(pwrd.address, gvt.address, tokenAddresses, decimals);
    await pwrd.setController(controller.address);
    await gvt.setController(controller.address);

    await controller.addToWhitelist(governance);

    const depositHandler = await newDepositHandler(
        controller,
        pwrd.address,
        gvt.address,
        tokenAddresses,
        adaptorAddresses
    );
    await controller.setDepositHandler(depositHandler.address, { from: governance });
    await controller.setUtilisationRatioLimitPwrd(toBN(10000), { from: governance });
    await controller.addToWhitelist(depositHandler.address, { from: governance });

    const lifeguard = await newLifeGuard(controller, tokens, mainnet);
    const chainPrice = lifeguard.chainPrice;

    const emergencyHandler = await newEmergencyHandler(
        controller,
        pwrd.address,
        gvt.address,
        chainPrice.address,
        tokenAddresses,
        adaptorAddresses
    );

    const withdrawHandler = await newWithdrawHandler(
        controller,
        pwrd.address,
        gvt.address,
        emergencyHandler.address,
        tokenAddresses,
        adaptorAddresses
    );

    await controller.setWithdrawHandler(withdrawHandler.address, emergencyHandler.address, { from: governance });
    await controller.setUtilisationRatioLimitGvt(toBN(10000), { from: governance });
    await controller.setWithdrawalFee(false, 50, { from: governance });
    await controller.setWithdrawalFee(true, 50, { from: governance });
    await controller.addToWhitelist(withdrawHandler.address, { from: governance });
    // set gvt
    await gvt.addToWhitelist(controller.address, { from: governance });

    // set pwrd
    await pwrd.addToWhitelist(controller.address, { from: governance });

    // set pnl
    const pnl = await newPnL(controller, pwrd.address, gvt.address);
    await controller.setPnL(pnl.address, { from: governance });
    await controller.addToWhitelist(pnl.address, { from: governance });
    await gvt.addToWhitelist(pnl.address, { from: governance });

    // set performanceFee
    await pnl.setPerformanceFee(toBN(2000), { from: governance });

    // set insurance
    const insurance = await newInsurance(controller);
    //await insurance.setWithdrawHandler(withdrawHandler.address);
    await controller.setInsurance(insurance.address, { from: governance });

    // set lifeguard
    const buoy = lifeguard.buoy;
    await buoy.setCurveTolerance(350);
    await buoy.updateRatios();
    await buoy.setController(controller.address);
    await controller.setLifeGuard(lifeguard.address, { from: governance });

    const vaultAdaptors = [];
    for (let i = 0; i < tokenAddresses.length; i++) {
        vaultAdaptors[i] = await initStablecoinVaultAdaptor(
            controller,
            adaptors[i],
            vaults[i],
            tokens[i].detailed,
            mainnet
        );
        await controller.setVault(i, vaultAdaptors[i].address, { from: governance });
        await lifeguard.approveVaults(i, { from: governance });
    }
    // set curve vault
    const lptAddress = await lifeguard.lpToken();
    const index = vaultAdaptors.length;
    [adaptors[index], vaults[index]] = await newCurveVaultAdaptor(governance, await getDetailed(lptAddress));
    vaultAdaptors[index] = await initCurveVaultAdaptor(
        controller,
        adaptors[index],
        vaults[index],
        await getDetailed(lptAddress),
        mainnet
    );
    await controller.setCurveVault(vaultAdaptors[index].address, { from: governance });
    await lifeguard.approveVaults(index, { from: governance });

    await withdrawHandler.setDependencies();
    await depositHandler.setDependencies();
    await emergencyHandler.setDependencies();
    await lifeguard.setDependencies();

    const obj = {
        _name: 'Controller',
        _parent: controller,
        parent: () => { return obj._parent; },
        gvt: gvt,
        pwrd: pwrd,
        insurance: insurance,
        pnl: pnl,
        lifeguard: lifeguard,
        buoy: buoy,
        underlyingTokens: tokens,
        vaults: vaultAdaptors,
        withdrawHandler: withdrawHandler,
        depositHandler: depositHandler,

        depositGvt: async (
            investAmounts, investor,
            slippagePercent = defaultSlippagePercent,
            slippageBaseNum = defaultSlippageBaseNum,
        ) => {
            await batchApprove(investor, depositHandler.address, tokens, investAmounts);

            const lp = await buoy.stableToLp(investAmounts, true);
            // need to lower the expected amount by 1 basis point
            // calc_token_amount does not provide an exact value
            // expect to get return somewhere between lp and
            // lpWithSlippage
            const lpWithSlippage = slipping(
                lp, slippagePercent, slippageBaseNum).min;
            const usd2 = await buoy.stableToUsd(investAmounts, true);
            const usd2WithSlippage = slipping(
                usd2, slippagePercent, slippageBaseNum).min;
            const usd = await buoy.lpToUsd(lp);
            const usdWithSlippage = await buoy.lpToUsd(lpWithSlippage);

            await depositHandler.depositGvt(
                investAmounts,
                lpWithSlippage,
                ZERO,
                { from: investor },
            );
            return [usd, usdWithSlippage];
        },

        depositPwrd: async (
            investAmounts, investor,
            slippagePercent = defaultSlippagePercent,
            slippageBaseNum = defaultSlippageBaseNum,
        ) => {
            await batchApprove(investor, depositHandler.address, tokens, investAmounts);

            const lp = await buoy.stableToLp(investAmounts, true);
            // need to lower the expected amount by 1 basis point
            // calc_token_amount does not provide an exact value
            // expect to get return somewhere between lp and
            // lpWithSlippage
            const lpWithSlippage = slipping(
                lp, slippagePercent, slippageBaseNum).min;
            const usd2 = await buoy.stableToUsd(investAmounts, true);
            const usd2WithSlippage = slipping(
                usd2, slippagePercent, slippageBaseNum).min;
            const usd = await buoy.lpToUsd(lp);
            const usdWithSlippage = await buoy.lpToUsd(lpWithSlippage);

            const tx = await depositHandler.depositPwrd(
                investAmounts,
                lpWithSlippage,
                ZERO,
                { from: investor },
            );
            return [usd, usdWithSlippage, tx];
        },

        withdrawByLPTokenGvt: async (withdrawUsd, investor,
            slippagePercent = defaultSlippagePercent,
            slippageBaseNum = defaultSlippageBaseNum,
        ) => {
            const lp = await buoy.usdToLp(withdrawUsd);
            const lpWithdrawalFee = lp.sub(lp.mul(toBN('50')).div(toBN('10000')));
            const withdrawTokens = await withdrawHandler.getVaultDeltas(lpWithdrawalFee);
            const withdrawTokensWithSlippage = [];
            for (let i = 0; i < withdrawTokens.length; i++) {
                withdrawTokensWithSlippage[i] =
                    slipping(withdrawTokens[i], slippagePercent, slippageBaseNum).min;
            }

            await withdrawHandler.withdrawByLPToken(
                false,
                lp, // fixed
                withdrawTokensWithSlippage,
                { from: investor },
            );

            return [withdrawTokens, withdrawTokensWithSlippage];
        },

        withdrawByLPTokenPwrd: async (
            withdrawUsd, investor,
            slippagePercent = defaultSlippagePercent,
            slippageBaseNum = defaultSlippageBaseNum,
        ) => {
            const lp = await buoy.usdToLp(withdrawUsd);
            const lpWithdrawalFee = lp.sub(lp.mul(toBN('50')).div(toBN('10000')));
            const withdrawTokens = await withdrawHandler.getVaultDeltas(lpWithdrawalFee);
            const withdrawTokensWithSlippage = [];
            for (let i = 0; i < withdrawTokens.length; i++) {
                withdrawTokensWithSlippage[i] =
                    slipping(withdrawTokens[i], slippagePercent, slippageBaseNum).min;
            }

            const tx = await withdrawHandler.withdrawByLPToken(
                true,
                lp, // fixed
                withdrawTokensWithSlippage,
                { from: investor },
            );

            return [withdrawTokens, withdrawTokensWithSlippage, tx];
        },

        withdrawByStablecoins: async (
            gToken, withdrawAmounts, investor,
            slippagePercent = defaultSlippagePercent,
            slippageBaseNum = defaultSlippageBaseNum,
        ) => {
            const gTokenAddress = convertInputToContractAddr(gToken);
            const lp = await buoy.stableToLp(withdrawAmounts, false);
            const lpWithdrawalFee = lp.sub(lp.mul(toBN('50')).div(toBN('10000')));
            const lpWithSlippage = slipping(
                lpWithdrawalFee, slippagePercent, slippageBaseNum).max;
            const usd2 = await buoy.stableToUsd(withdrawAmounts, false);
            const usd2WithSlippage = slipping(
                usd2, slippagePercent, slippageBaseNum).max;
            const usd = await buoy.lpToUsd(lp);
            const usdWithSlippage = await buoy.lpToUsd(lpWithSlippage);

            await withdrawHandler.withdrawByStablecoinsGvt(
                withdrawAmounts, // fixed
                lpWithSlippage,
                { from: investor },
            );
            return [usd, usdWithSlippage];
        },

        withdrawByStablecoinGvt: async (
            tokenIndex, withdrawUsd, investor,
            slippagePercent = defaultSlippagePercent,
            slippageBaseNum = defaultSlippageBaseNum,
            emergency = false,
        ) => {
            let lp = await buoy.usdToLp(withdrawUsd);
            const lpWithdrawalFee = lp.sub(lp.mul(toBN('50')).div(toBN('10000')));
            const tokenAmount = await buoy.singleStableFromLp(lpWithdrawalFee, tokenIndex);
            const tokenAmountWithSlippage = slipping(
                tokenAmount, slippagePercent, slippageBaseNum).min;

            if (emergency == true) {
                lp = withdrawUsd;
            }
            await withdrawHandler.withdrawByStablecoin(
                false,
                tokenIndex,
                lp,
                tokenAmountWithSlippage,
                { from: investor },
            );

            return [tokenAmount, tokenAmountWithSlippage];
        },

        withdrawByStablecoinPwrd: async (
            tokenIndex, withdrawUsd, investor,
            slippagePercent = defaultSlippagePercent,
            slippageBaseNum = defaultSlippageBaseNum,
        ) => {
            const lp = await buoy.usdToLp(withdrawUsd);
            const lpWithdrawalFee = lp.sub(lp.mul(toBN('50')).div(toBN('10000')));
            const tokenAmount = await buoy.singleStableFromLp(lpWithdrawalFee, tokenIndex);
            const tokenAmountWithSlippage = slipping(
                tokenAmount, slippagePercent, slippageBaseNum).min;

            await withdrawHandler.withdrawByStablecoin(
                true,
                tokenIndex,
                lp,
                tokenAmountWithSlippage,
                { from: investor },
            );

            return [tokenAmount, tokenAmountWithSlippage];
        },

        withdrawAllSingleGvt: async (
            tokenIndex, withdrawUsd, investor,
            slippagePercent = defaultSlippagePercent,
            slippageBaseNum = defaultSlippageBaseNum,
        ) => {
            if (withdrawUsd === 0) {
                withdrawUsd = await gvt.getAssets(investor);
            }
            const lp = await buoy.usdToLp(withdrawUsd);
            const lpWithdrawalFee = lp.sub(lp.mul(toBN('50')).div(toBN('10000')));
            const tokenAmount = await buoy.singleStableFromLp(lpWithdrawalFee, tokenIndex);
            const tokenAmountWithSlippage = slipping(
                tokenAmount, slippagePercent, slippageBaseNum).min;

            await withdrawHandler.withdrawAllSingle(
                false,
                tokenIndex,
                tokenAmountWithSlippage,
                { from: investor },
            );

            return [tokenAmount, tokenAmountWithSlippage];
        },

        withdrawAllBalancedGvt: async (
            withdrawUsd, investor,
            slippagePercent = defaultSlippagePercent,
            slippageBaseNum = defaultSlippageBaseNum,
        ) => {
            if (withdrawUsd === 0) {
                withdrawUsd = await gvt.getAssets(investor);
            }
            const lp = await buoy.usdToLp(withdrawUsd);
            const lpWithdrawalFee = lp.sub(lp.mul(toBN('50')).div(toBN('10000')));
            const withdrawTokens = await withdrawHandler.getVaultDeltas(lpWithdrawalFee);
            const withdrawTokensWithSlippage = [];
            for (let i = 0; i < withdrawTokens.length; i++) {
                withdrawTokensWithSlippage[i] =
                    slipping(withdrawTokens[i], slippagePercent, slippageBaseNum).min;
            }

            await withdrawHandler.withdrawAllBalanced(
                false,
                withdrawTokensWithSlippage,
                { from: investor },
            );

            return [withdrawTokens, withdrawTokensWithSlippage];
        },

        withdrawAllSinglePwrd: async (
            tokenIndex, withdrawUsd, investor,
            slippagePercent = defaultSlippagePercent,
            slippageBaseNum = defaultSlippageBaseNum,
        ) => {
            if (withdrawUsd === 0) {
                withdrawUsd = await pwrd.getAssets(investor);
            }
            const lp = await buoy.usdToLp(withdrawUsd);
            const lpWithdrawalFee = lp.sub(lp.mul(toBN('50')).div(toBN('10000')));
            const tokenAmount = await buoy.singleStableFromLp(lpWithdrawalFee, tokenIndex);
            const tokenAmountWithSlippage = slipping(
                tokenAmount, slippagePercent, slippageBaseNum).min;

            const tx = await withdrawHandler.withdrawAllSingle(
                true,
                tokenIndex,
                tokenAmountWithSlippage,
                { from: investor },
            );

            return [tokenAmount, tokenAmountWithSlippage, tx];
        },

        withdrawAllBalancedPwrd: async (
            withdrawUsd, investor,
            slippagePercent = defaultSlippagePercent,
            slippageBaseNum = defaultSlippageBaseNum,
        ) => {
            if (withdrawUsd === 0) {
                withdrawUsd = await pwrd.getAssets(investor);
            }
            const lp = await buoy.usdToLp(withdrawUsd);
            const lpWithdrawalFee = lp.sub(lp.mul(toBN('50')).div(toBN('10000')));
            const withdrawTokens = await withdrawHandler.getVaultDeltas(lpWithdrawalFee);
            const withdrawTokensWithSlippage = [];
            for (let i = 0; i < withdrawTokens.length; i++) {
                withdrawTokensWithSlippage[i] =
                    slipping(withdrawTokens[i], slippagePercent, slippageBaseNum).min;
            }

            await withdrawHandler.withdrawAllBalanced(
                true,
                withdrawTokensWithSlippage,
                { from: investor },
            );

            return [withdrawTokens, withdrawTokensWithSlippage];
        },
        setVaults: async (vaults) => {
            vaults = convertInputToContractAddr(vaults);
            for (let i = 0; i < vaults.length; i++) {
                await controller.setVault(i, vaults[i], { from: governance });
                await lifeguard.approveVaults(i, { from: governance });
            }
        },

        emergencyWithdrawal: async (gToken, tokenIndex, investor) => {
            const gTokenAddress = convertInputToContractAddr(gToken);

            const tx = await emergencyHandler.emergencyWithdrawal(
                gTokenAddress,
                tokenIndex,
                lifeguard.address,
                { from: investor },
            );
            return tx;
        },
    };
    return new Proxy(obj, contractInheritHandler);
};

module.exports = {
    newController,
};
