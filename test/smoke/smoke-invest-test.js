const { newController } = require('../utils/factory/controller');
const { BN, toBN } = require('web3-utils')
const {
    expect,
} = require('../utils/common-utils')
const {
    stableCoinsRatios,
    getSystemInfo,
    printSystemInfo,
} = require('../utils/system-utils')
const { mintToken, burnToken } = require('../utils/token-utils');
const { constants } = require('../utils/constants');

const mainnet = network.config.forking !== undefined;

const daiPercent = stableCoinsRatios.daiRatio,
    usdcPercent = stableCoinsRatios.usdcRatio,
    usdtPercent = stableCoinsRatios.usdtRatio,
    baseNum = constants.DEFAULT_FACTOR,
    percentFactor = constants.PERCENT_FACTOR,
    gvtPrice = toBN(300),
    gvtInitBase = baseNum.div(gvtPrice);

let controller,
    insurance,
    exposure,
    allocation,
    pnl,
    gvt,
    pwrd,
    daiBaseNum,
    usdcBaseNum,
    usdtBaseNum,
    DAI,
    USDC,
    USDT,
    DAIVaultAdaptor,
    USDCVaultAdaptor,
    USDTVaultAdaptor,
    DAIVault,
    USDCVault,
    USDTVault,
    pool,
    buoy,
    lifeguard,
    curve, withdrawHandler

// TODO List
// 1. Perfemance fee & withdraw fee
// 2. Profit distribute to gvt & PWRD
// 3. Special handling process when the system has serious losses

contract('Smoke invest test', function (accounts) {
    const deployer = accounts[0],
        governance = deployer,
        investor1 = accounts[1],
        investor2 = accounts[2],
        reward = accounts[9];

    beforeEach('init contracts', async function () {
        controller = await newController(mainnet)
            ;[DAI, USDC, USDT] = controller.underlyingTokens
        withdrawHandler = controller.withdrawHandler;
        gvt = controller.gvt
        pwrd = controller.pwrd
        pnl = controller.pnl
        lifeguard = controller.lifeguard;
        buoy = lifeguard.buoy;
        insurance = controller.insurance;
        exposure = insurance.exposure
        allocation = insurance.allocation;
        [DAIVaultAdaptor, USDCVaultAdaptor, USDTVaultAdaptor] = controller.vaults;
        [DAIVault, USDCVault, USDTVault] = [
            DAIVaultAdaptor.vault,
            USDCVaultAdaptor.vault,
            USDTVaultAdaptor.vault,
        ];

        await insurance.batchSetUnderlyingTokensPercents([
            daiPercent,
            usdcPercent,
            usdtPercent,
        ]);

        daiBaseNum = new BN(10).pow(DAI.detailed.decimals)
        usdcBaseNum = new BN(10).pow(USDC.detailed.decimals)
        usdtBaseNum = new BN(10).pow(USDT.detailed.decimals)
        await buoy.updateRatios();

        const mintAmount = new BN(200000);
        await mintToken(DAI, investor1, mintAmount.mul(daiBaseNum), mainnet);
        await mintToken(USDC, investor1, mintAmount.mul(usdcBaseNum), mainnet);
        await mintToken(USDT, investor1, mintAmount.mul(usdtBaseNum), mainnet);

        await mintToken(DAI, investor2, mintAmount.mul(daiBaseNum), mainnet);
        await mintToken(USDC, investor2, mintAmount.mul(usdcBaseNum), mainnet);
        await mintToken(USDT, investor2, mintAmount.mul(usdtBaseNum), mainnet);

        // add protocols to system
        pool = lifeguard.pool
        curve = pool.address

        await exposure.setProtocolCount(2)

        controller.setReward(reward)

        await insurance.setWhaleThresholdDeposit(1);
        await controller.setBigFishThreshold(1, 100);
        await insurance.setCurveVaultPercent(1000);
        const deposit1 = [
            toBN(30000).mul(daiBaseNum),
            toBN(30000).mul(usdcBaseNum),
            toBN(30000).mul(usdtBaseNum),
        ]
        await controller.depositGvt(
            deposit1,
            investor1,
        )
        let postSystemAssetState = await getSystemInfo(controller)

        // printSystemInfo(postSystemAssetState)
    });

    describe('vault invest', function () {
        it('ok', async function () {
            const preSystemInfo = await getSystemInfo(controller)
            // printSystemInfo(preSystemInfo)

            await DAIVaultAdaptor.setVaultReserve(100);
            await DAIVaultAdaptor.invest();
            const reserve = await DAIVaultAdaptor.vaultReserve();
            const reserveAssets = preSystemInfo.daiAdapterTotalAsset.mul(reserve).div(percentFactor);
            const vaultAssets = preSystemInfo.daiAdapterTotalAsset.sub(reserveAssets);

            const postSystemInfo = await getSystemInfo(controller)
            // printSystemInfo(postSystemInfo)

            expect(preSystemInfo.daiAdapterTotalAsset).to.be.bignumber.equal(postSystemInfo.daiAdapterTotalAsset);
            expect(postSystemInfo.daiAdapterBalance).to.be.bignumber.equal(reserveAssets);
            expect(postSystemInfo.daiVaultTotalAsset).to.be.bignumber.equal(vaultAssets);
            expect(postSystemInfo.daiVaultStrategy.alphaRatio).to.be.bignumber.equal(percentFactor);
            expect(postSystemInfo.daiVaultStrategy.betaRatio).to.be.bignumber.equal(toBN(0));
            return;
        })

        it('do nothing when balance < investThreshold', async function () {
            const preSystemInfo = await getSystemInfo(controller)
            // printSystemInfo(preSystemInfo)

            await DAIVaultAdaptor.setInvestThreshold(1000000);
            await DAIVaultAdaptor.invest();

            const postSystemInfo = await getSystemInfo(controller)
            // printSystemInfo(postSystemInfo)

            expect(preSystemInfo.daiAdapterTotalAsset).to.be.bignumber.equal(postSystemInfo.daiAdapterTotalAsset);
            expect(postSystemInfo.daiVaultTotalAsset).to.be.bignumber.equal(toBN(0));
            return;
        })

        it('do nothing when balance <= vaultHold', async function () {
            await DAIVaultAdaptor.invest();

            await controller.depositGvt(
                [
                    toBN(5000).mul(daiBaseNum),
                    toBN(5000).mul(usdcBaseNum),
                    toBN(5000).mul(usdtBaseNum),
                ],
                investor1,
            );

            const preSystemInfo = await getSystemInfo(controller)
            // printSystemInfo(preSystemInfo)

            await DAIVaultAdaptor.setVaultReserve(5000);
            await DAIVaultAdaptor.invest();

            const postSystemInfo = await getSystemInfo(controller)
            // printSystemInfo(postSystemInfo)

            expect(preSystemInfo.daiAdapterTotalAsset).to.be.bignumber.equal(postSystemInfo.daiAdapterTotalAsset);
            expect(postSystemInfo.daiVaultTotalAsset).to.be.bignumber.equal(preSystemInfo.daiVaultTotalAsset);
            return;
        })

        it('do nothing when strategy ratio change <= strategyRatioBuffer', async function () {
            const preSystemInfo = await getSystemInfo(controller)
            // printSystemInfo(preSystemInfo)

            await DAIVaultAdaptor.setStrategyRatioBuffer(8000);
            await DAIVaultAdaptor.invest();

            const postSystemInfo = await getSystemInfo(controller)
            // printSystemInfo(postSystemInfo)

            expect(postSystemInfo.daiVaultStrategy.alphaRatio)
                .to.be.bignumber.equal(preSystemInfo.daiVaultStrategy.alphaRatio);
            expect(postSystemInfo.daiVaultStrategy.betaRatio)
                .to.be.bignumber.equal(preSystemInfo.daiVaultStrategy.betaRatio);
            return;
        })
    })

    describe('vault invest trigger', function () {
        it('true', async function () {
            return expect(DAIVaultAdaptor.investTrigger()).to.eventually.equal(true);
        })

        it('false when balance < investThreshold', async function () {
            await DAIVaultAdaptor.setInvestThreshold(1000000);
            return expect(DAIVaultAdaptor.investTrigger()).to.eventually.equal(false);
        })

        it('false when balance <= vaultHold', async function () {
            await DAIVaultAdaptor.invest();

            await controller.depositGvt(
                [
                    toBN(5000).mul(daiBaseNum),
                    toBN(5000).mul(usdcBaseNum),
                    toBN(5000).mul(usdtBaseNum),
                ],
                investor1,
            );

            await DAIVaultAdaptor.setVaultReserve(5000);
            return expect(DAIVaultAdaptor.investTrigger()).to.eventually.equal(false);
        })
    })

    describe('curve', function () {
        it('investToCurveVault', async function () {
            const preSystemInfo = await getSystemInfo(controller)
            // printSystemInfo(preSystemInfo)

            await lifeguard.setInvestToCurveThreshold(1000);
            await lifeguard.investToCurveVault();

            const postSystemInfo = await getSystemInfo(controller)
            // printSystemInfo(postSystemInfo)

            expect(postSystemInfo.lifeguardUsd).to.be.bignumber.equal(toBN(0));
            expect(postSystemInfo.curveAdapterTotalAssetUsd)
                .to.be.bignumber.closeTo(preSystemInfo.lifeguardUsd, baseNum);
            expect(postSystemInfo.curveAdapterTotalAsset)
                .to.be.bignumber.equal(postSystemInfo.curveVaultTotalAsset);
            expect(postSystemInfo.curveAdapterBalance).to.be.bignumber.equal(toBN(0));
            return;
        })

        it('investToCurveVaultTrigger true', async function () {
            return expect(lifeguard.investToCurveVaultTrigger()).to.eventually.equal(true);
        })

        it('investToCurveVaultTrigger false', async function () {
            await lifeguard.setInvestToCurveThreshold(1000000);
            return expect(lifeguard.investToCurveVaultTrigger()).to.eventually.equal(false);
        })

        it('distributeCurveVault', async function () {
            await lifeguard.investToCurveVault();

            const preSystemInfo = await getSystemInfo(controller)
            // printSystemInfo(preSystemInfo)

            const lpAmount = toBN(5000).mul(baseNum);
            const daiDelta = toBN(2000);
            const usdcDelta = toBN(3000);
            const usdtDelta = toBN(5000);

            const daiAssets = await buoy.singleStableFromLp(lpAmount.mul(daiDelta).div(percentFactor), 0);
            const usdcAssets = await buoy.singleStableFromLp(lpAmount.mul(usdcDelta).div(percentFactor), 1);
            const usdtAssets = await buoy.singleStableFromLp(lpAmount.mul(usdtDelta).div(percentFactor), 2);

            await controller.distributeCurveAssets(lpAmount, [daiDelta, usdcDelta, usdtDelta]);

            const postSystemInfo = await getSystemInfo(controller)
            // printSystemInfo(postSystemInfo)

            expect(preSystemInfo.curveAdapterTotalAsset.sub(postSystemInfo.curveAdapterTotalAsset))
                .to.be.bignumber.equal(lpAmount);
            expect(postSystemInfo.daiAdapterTotalAsset.sub(preSystemInfo.daiAdapterTotalAsset))
                .to.be.bignumber.closeTo(daiAssets, daiBaseNum);
            expect(postSystemInfo.usdcAdapterTotalAsset.sub(preSystemInfo.usdcAdapterTotalAsset))
                .to.be.bignumber.closeTo(usdcAssets, usdcBaseNum);
            expect(postSystemInfo.usdtAdapterTotalAsset.sub(preSystemInfo.usdtAdapterTotalAsset))
                .to.be.bignumber.closeTo(usdtAssets, usdtBaseNum);
            return;
        })
    })
});
