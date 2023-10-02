const { toBN, BN } = require('web3-utils');
const { newController } = require('../utils/factory/controller');
const PnL = artifacts.require('PnL');
const {
    expect,
    harvestStratgies,
    investVaults,
    decodeLogs,
} = require('../utils/common-utils');
const {
    stableCoinsRatios,
    getSystemInfo,
    getUserInfo,
    printSystemInfo,
    printUserInfo,
} = require('../utils/system-utils');

const thousandBaseNum = toBN(10).pow(toBN(3)),
    millionBaseNum = toBN(10).pow(toBN(6)),
    billionBaseNum = toBN(10).pow(toBN(8));

const { defaultDollarApproxFactor } = require('../utils/contract-utils');
const { distributeProfit } = require('../utils/pnl-utils');
const { advanceSpecialBlock } = require('../utils/contract-web3-utils');
const timeMachine = require('ganache-time-traveler');
const truffleAssert = require('truffle-assertions');
const { constants } = require('../utils/constants');

contract('Smoke pnl test', function (accounts) {
    const deployer = accounts[0],
        governance = deployer,
        investor1 = accounts[1],
        investor2 = accounts[2],
        reward = accounts[9];
    const baseNum = constants.DEFAULT_FACTOR,
        percentFactor = constants.PERCENT_FACTOR;

    let tokens, vaults;

    let controller, pnl, insurance, allocation, lifeguard,
        gvt, pwrd, buoy, pool, withdrawHandler,
        daiBaseNum, usdcBaseNum, usdtBaseNum,
        DAI, USDC, USDT,
        DAIVaultAdaptor, USDCVaultAdaptor, USDTVaultAdaptor;

    async function prepareTokenAndInvest(investments, investors) {
        const gTokens = [gvt, pwrd];

        for (let i = 0; i < gTokens.length; i++) {
            for (let j = 0; j < investors.length; j++) {
                if (gTokens[i] === gvt) {
                    await controller.depositGvt(investments[i][j], investors[j]);
                }
                if (gTokens[i] === pwrd) {
                    await controller.depositPwrd(investments[i][j], investors[j]);
                }
            }
        }
    }

    async function calculateRealAssets(gvtAssets, pwrdAssets) {
        const inputTotalAssets = gvtAssets.add(pwrdAssets);
        const realTotalAssets = await controller.totalAssets();
        if (realTotalAssets.gt(inputTotalAssets)) {
            return [
                gvtAssets.add(realTotalAssets.sub(inputTotalAssets)),
                pwrdAssets
            ];
        } else if (realTotalAssets.lt(inputTotalAssets)) {
            const loss = inputTotalAssets.sub(realTotalAssets);
            if (loss.gt(gvtAssets)) {
                return [
                    baseNum,
                    pwrdAssets.sub(loss.add(baseNum).sub(gvtAssets))
                ];
            } else {
                return [
                    gvtAssets.sub(loss),
                    pwrdAssets
                ];
            }
        }

    }

    beforeEach('init contract', async function () {
        controller = await newController();
        tokens = controller.underlyingTokens;
        [DAI, USDC, USDT] = tokens;
        gvt = controller.gvt;
        pwrd = controller.pwrd;
        pnl = controller.pnl;
        lifeguard = controller.lifeguard;
        buoy = lifeguard.buoy;
        pool = lifeguard.pool;
        insurance = controller.insurance;
        allocation = insurance.allocation;
        withdrawHandler = controller.withdrawHandler;

        controller.setReward(reward);

        vaults = controller.vaults;
        [DAIVaultAdaptor, USDCVaultAdaptor, USDTVaultAdaptor] = vaults;

        await insurance.batchSetUnderlyingTokensPercents(
            [3000, 4000, 3000],
        );
        await controller.withdrawHandler.setDependencies();

        daiBaseNum = new BN(10).pow(await DAI.decimals());
        usdcBaseNum = new BN(10).pow(await USDC.decimals());
        usdtBaseNum = new BN(10).pow(await USDT.decimals());
        await buoy.updateRatios();

        const investment = toBN(100).mul(millionBaseNum);
        await DAI.mint(investor1, investment.mul(daiBaseNum), { from: deployer });
        await USDC.mint(investor1, investment.mul(usdcBaseNum), { from: deployer });
        await USDT.mint(investor1, investment.mul(usdtBaseNum), { from: deployer });
        await DAI.mint(investor2, investment.mul(daiBaseNum), { from: deployer });
        await USDC.mint(investor2, investment.mul(usdcBaseNum), { from: deployer });
        await USDT.mint(investor2, investment.mul(usdtBaseNum), { from: deployer });

        deposit = controller.deposit;
        withdrawByLPToken = controller.withdrawByLPToken;
        withdrawByStablecoins = controller.withdrawByStablecoins;
        withdrawByStablecoin = controller.withdrawByStablecoin;
        withdrawAll = controller.withdrawAllSingle;
        withdrawAllBalanced = controller.withdrawAllBalanced;

        await allocation.setCurvePercentThreshold(toBN(1200));
        await insurance.setCurveVaultPercent(toBN(1000));
        await controller.setBigFishThreshold(1, 100);
        await insurance.setWhaleThresholdDeposit(1);
        await buoy.setCurveTolerance(2000);
    });

    describe('distributeHodlerBonus', function () {
        it('distribute withdraw bonus with pwrd rebase=true', async () => {
            await controller.depositGvt(
                [
                    toBN(1).mul(millionBaseNum).mul(daiBaseNum),
                    toBN(1).mul(millionBaseNum).mul(usdcBaseNum),
                    toBN(1).mul(millionBaseNum).mul(usdtBaseNum),
                ],
                investor1,
            );

            await controller.depositPwrd(
                [
                    toBN(600).mul(thousandBaseNum).mul(daiBaseNum),
                    toBN(600).mul(thousandBaseNum).mul(usdcBaseNum),
                    toBN(600).mul(thousandBaseNum).mul(usdtBaseNum),
                ],
                investor1,
            );

            const withdrawUsd = toBN(1).mul(millionBaseNum).mul(baseNum);
            const withdrawFee = await withdrawHandler.withdrawalFee(true);
            const withdrawFeeUsd = withdrawUsd.mul(withdrawFee).div(percentFactor);

            const [, , tx] = await controller.withdrawByLPTokenPwrd(withdrawUsd, investor1);
            const logs = decodeLogs(tx.receipt.rawLogs, PnL, null, 'LogPnLExecution');
            // console.log('logs: ' + JSON.stringify(logs));
            expect(logs.length).equal(1);

            const withdrawalBonus = toBN(logs[0].args.withdrawalBonus);
            const beforeGvtAssets = toBN(logs[0].args.beforeGvtAssets);
            const beforePwrdAssets = toBN(logs[0].args.beforePwrdAssets);
            const afterGvtAssets = toBN(logs[0].args.afterGvtAssets);
            const afterPwrdAssets = toBN(logs[0].args.afterPwrdAssets);
            const totalPnL = toBN(logs[0].args.totalPnL);

            const gvtWithdrawalBonus = withdrawalBonus.mul(beforeGvtAssets).div(beforeGvtAssets.add(beforePwrdAssets));
            const pwrdWithdrawalBonus = withdrawalBonus.mul(beforePwrdAssets).div(beforeGvtAssets.add(beforePwrdAssets));

            expect(withdrawalBonus).to.be.a.bignumber.closeTo(totalPnL, toBN(100));
            expect(withdrawalBonus).to.be.a.bignumber.closeTo(withdrawFeeUsd, toBN(100));
            expect(afterGvtAssets.sub(beforeGvtAssets)).to.be.a.bignumber.closeTo(gvtWithdrawalBonus, toBN(100));
            expect(afterPwrdAssets.sub(beforePwrdAssets)).to.be.a.bignumber.closeTo(pwrdWithdrawalBonus, toBN(100));

            await expect(gvt.totalAssets()).to.eventually.be.a.bignumber.closeTo(
                afterGvtAssets, defaultDollarApproxFactor), 'gvt.totalAssets';
            await expect(pwrd.totalSupply()).to.eventually.be.a.bignumber.closeTo(
                afterPwrdAssets, defaultDollarApproxFactor, 'pwrd.totalSupply');

            return;
        })

        it('distribute withdraw bonus with pwrd rebase=false', async () => {
            await controller.depositGvt(
                [
                    toBN(1).mul(millionBaseNum).mul(daiBaseNum),
                    toBN(1).mul(millionBaseNum).mul(usdcBaseNum),
                    toBN(1).mul(millionBaseNum).mul(usdtBaseNum),
                ],
                investor1,
            );

            await controller.depositPwrd(
                [
                    toBN(600).mul(thousandBaseNum).mul(daiBaseNum),
                    toBN(600).mul(thousandBaseNum).mul(usdcBaseNum),
                    toBN(600).mul(thousandBaseNum).mul(usdtBaseNum),
                ],
                investor1,
            );

            const withdrawUsd = toBN(1).mul(millionBaseNum).mul(baseNum);
            const withdrawFee = await withdrawHandler.withdrawalFee(true);
            const withdrawFeeUsd = withdrawUsd.mul(withdrawFee).div(percentFactor);

            await pnl.setRebase(false);
            const [, , tx] = await controller.withdrawByLPTokenPwrd(withdrawUsd, investor1);
            const logs = decodeLogs(tx.receipt.rawLogs, PnL, null, 'LogPnLExecution');
            // console.log('logs: ' + JSON.stringify(logs));
            expect(logs.length).equal(1);

            const withdrawalBonus = toBN(logs[0].args.withdrawalBonus);
            const beforeGvtAssets = toBN(logs[0].args.beforeGvtAssets);
            const beforePwrdAssets = toBN(logs[0].args.beforePwrdAssets);
            const afterGvtAssets = toBN(logs[0].args.afterGvtAssets);
            const afterPwrdAssets = toBN(logs[0].args.afterPwrdAssets);
            const totalPnL = toBN(logs[0].args.totalPnL);

            expect(withdrawalBonus).to.be.a.bignumber.closeTo(totalPnL, toBN(1));
            expect(withdrawalBonus).to.be.a.bignumber.closeTo(withdrawFeeUsd, toBN(1));
            expect(afterGvtAssets.sub(beforeGvtAssets)).to.be.a.bignumber.closeTo(withdrawalBonus, toBN(1));
            expect(afterPwrdAssets.sub(beforePwrdAssets)).to.be.a.bignumber.closeTo(toBN(0), toBN(1));

            await expect(gvt.totalAssets()).to.eventually.be.a.bignumber.closeTo(
                afterGvtAssets, defaultDollarApproxFactor), 'gvt.totalAssets';
            await expect(pwrd.totalSupply()).to.eventually.be.a.bignumber.closeTo(
                afterPwrdAssets, defaultDollarApproxFactor, 'pwrd.totalSupply');

            return;
        })
    });

    describe('distributeStrategyGainLoss', function () {

        it('distribute invest profit when ratio < 80% without price change and rebase=false', async function () {
            // prepare data
            // 45 million
            const gvtDAIInvestor1 = toBN(4).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor1 = toBN(8).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor1 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor1 = toBN(2).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor1 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor1 = toBN(2).mul(millionBaseNum).mul(usdtBaseNum);

            const gvtDAIInvestor2 = toBN(6).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor2 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor2 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor2 = toBN(3).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor2 = toBN(2).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor2 = toBN(2).mul(millionBaseNum).mul(usdtBaseNum);
            const investments = [
                [
                    // gvt investor1  [dai. usdc, usdt]
                    [gvtDAIInvestor1, gvtUSDCInvestor1, gvtUSDTInvestor1],
                    // gvt investor2  [dai, usdc, usdt]
                    [gvtDAIInvestor2, gvtUSDCInvestor2, gvtUSDTInvestor2],
                ],
                [
                    // pwrd investor1  [dai, usdc, usdt]
                    [pwrdDAIInvestor1, pwrdUSDCInvestor1, pwrdUSDTInvestor1],
                    // pwrd investor2  [dai, usdc, usdt]
                    [pwrdDAIInvestor2, pwrdUSDCInvestor2, pwrdUSDTInvestor2],
                ],
            ];
            await prepareTokenAndInvest(investments, [investor1, investor2]);
            await investVaults(controller);
            await harvestStratgies(controller);
            await lifeguard.aggregators[1].setPrice(1);
            await pnl.setRebase(false);

            const lastGvtAssets = await pnl.lastGvtAssets();
            const lastPWRDAssets = await pnl.lastPwrdAssets();

            // mock profit
            const profitToken = toBN(1).mul(millionBaseNum).mul(daiBaseNum);
            const [
                mockDAIAlphaStrategy,
                mockDAIBetaStrategy,
            ] = DAIVaultAdaptor.strategies;
            await DAI.mint(mockDAIAlphaStrategy.address, profitToken);
            const profit = await buoy.singleStableToUsd(profitToken, 0);
            // console.log('profit: ' + profit);
            const performanceFee = await pnl.performanceFee();
            // console.log('performanceFee: ' + performanceFee);
            const profitFeeUsd = profit.mul(performanceFee).div(percentFactor);

            const expectGVTAssets = lastGvtAssets.add(profit);
            const expectPWRDAssets = lastPWRDAssets;

            const tx = await DAIVaultAdaptor.strategyHarvest(0);
            const logs = decodeLogs(tx.receipt.rawLogs, PnL, null, 'LogPnLExecution');
            // console.log('logs: ' + JSON.stringify(logs));
            expect(logs.length).equal(1);

            const performanceBonus = toBN(logs[0].args.performanceBonus);
            const investPnL = toBN(logs[0].args.investPnL);
            const afterGvtAssets = toBN(logs[0].args.afterGvtAssets);
            const afterPwrdAssets = toBN(logs[0].args.afterPwrdAssets);

            expect(investPnL).to.be.a.bignumber.equal(profit);
            expect(performanceBonus).to.be.a.bignumber.equal(profitFeeUsd);
            expect(afterGvtAssets).to.be.a.bignumber.equal(expectGVTAssets);
            expect(afterPwrdAssets).to.be.a.bignumber.equal(expectPWRDAssets);

            await expect(gvt.totalAssets()).to.eventually.be.a.bignumber.closeTo(
                afterGvtAssets, defaultDollarApproxFactor), 'gvt.totalAssets';
            await expect(pwrd.totalSupply()).to.eventually.be.a.bignumber.closeTo(
                afterPwrdAssets, defaultDollarApproxFactor, 'pwrd.totalSupply');
            await expect(gvt.getAssets(reward)).to.eventually.be.a.bignumber.closeTo(
                performanceBonus, defaultDollarApproxFactor, 'performanceBonus');

            return;
        });

        it('distribute invest profit when ratio < 80% without price change', async function () {
            // prepare data
            // 45 million
            const gvtDAIInvestor1 = toBN(4).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor1 = toBN(8).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor1 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor1 = toBN(2).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor1 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor1 = toBN(2).mul(millionBaseNum).mul(usdtBaseNum);

            const gvtDAIInvestor2 = toBN(6).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor2 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor2 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor2 = toBN(3).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor2 = toBN(2).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor2 = toBN(2).mul(millionBaseNum).mul(usdtBaseNum);
            const investments = [
                [
                    // gvt investor1  [dai. usdc, usdt]
                    [gvtDAIInvestor1, gvtUSDCInvestor1, gvtUSDTInvestor1],
                    // gvt investor2  [dai, usdc, usdt]
                    [gvtDAIInvestor2, gvtUSDCInvestor2, gvtUSDTInvestor2],
                ],
                [
                    // pwrd investor1  [dai, usdc, usdt]
                    [pwrdDAIInvestor1, pwrdUSDCInvestor1, pwrdUSDTInvestor1],
                    // pwrd investor2  [dai, usdc, usdt]
                    [pwrdDAIInvestor2, pwrdUSDCInvestor2, pwrdUSDTInvestor2],
                ],
            ];
            await prepareTokenAndInvest(investments, [investor1, investor2]);
            await investVaults(controller);
            await harvestStratgies(controller);
            await lifeguard.aggregators[1].setPrice(1);

            // console.log('********** pnl pre **********');
            // printSystemInfo(await getSystemInfo(controller));
            // console.log('********** pnl pre **********');

            const lastGvtAssets = await pnl.lastGvtAssets();
            const lastPWRDAssets = await pnl.lastPwrdAssets();

            // mock profit
            const profitToken = toBN(1).mul(millionBaseNum).mul(daiBaseNum);
            const [
                mockDAIAlphaStrategy,
                mockDAIBetaStrategy,
            ] = DAIVaultAdaptor.strategies;
            await DAI.mint(mockDAIAlphaStrategy.address, profitToken);
            const profit = await buoy.singleStableToUsd(profitToken, 0);
            // console.log('profit: ' + profit);
            const performanceFee = await pnl.performanceFee();
            // console.log('performanceFee: ' + performanceFee);
            const profitFeeUsd = profit.mul(performanceFee).div(percentFactor);

            const [expectGVTAssets, expectPWRDAssets] = distributeProfit(
                profit.sub(profitFeeUsd), lastGvtAssets, lastPWRDAssets);
            const expectAssets = expectGVTAssets.add(expectPWRDAssets);

            const tx = await DAIVaultAdaptor.strategyHarvest(0);
            const logs = decodeLogs(tx.receipt.rawLogs, PnL, null, 'LogPnLExecution');
            // console.log('logs: ' + JSON.stringify(logs));
            expect(logs.length).equal(1);

            // console.log('********** pnl post **********');
            // printSystemInfo(await getSystemInfo(controller));
            // console.log('********** pnl post **********');

            const performanceBonus = toBN(logs[0].args.performanceBonus);
            const investPnL = toBN(logs[0].args.investPnL);
            const afterGvtAssets = toBN(logs[0].args.afterGvtAssets);
            const afterPwrdAssets = toBN(logs[0].args.afterPwrdAssets);

            expect(investPnL).to.be.a.bignumber.equal(profit);
            expect(performanceBonus).to.be.a.bignumber.equal(profitFeeUsd);
            expect(afterGvtAssets).to.be.a.bignumber.equal(expectGVTAssets.add(profitFeeUsd));
            expect(afterPwrdAssets).to.be.a.bignumber.equal(expectPWRDAssets);

            return;
        });

        it('distribute invest profit when ratio < 80% with price change', async function () {
            // prepare data
            // 45 million
            const gvtDAIInvestor1 = toBN(4).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor1 = toBN(8).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor1 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor1 = toBN(2).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor1 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor1 = toBN(2).mul(millionBaseNum).mul(usdtBaseNum);

            const gvtDAIInvestor2 = toBN(6).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor2 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor2 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor2 = toBN(3).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor2 = toBN(2).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor2 = toBN(2).mul(millionBaseNum).mul(usdtBaseNum);
            const investments = [
                [
                    // gvt investor1  [dai. usdc, usdt]
                    [gvtDAIInvestor1, gvtUSDCInvestor1, gvtUSDTInvestor1],
                    // gvt investor2  [dai, usdc, usdt]
                    [gvtDAIInvestor2, gvtUSDCInvestor2, gvtUSDTInvestor2],
                ],
                [
                    // pwrd investor1  [dai, usdc, usdt]
                    [pwrdDAIInvestor1, pwrdUSDCInvestor1, pwrdUSDTInvestor1],
                    // pwrd investor2  [dai, usdc, usdt]
                    [pwrdDAIInvestor2, pwrdUSDCInvestor2, pwrdUSDTInvestor2],
                ],
            ];
            await prepareTokenAndInvest(investments, [investor1, investor2]);
            await investVaults(controller);
            await harvestStratgies(controller);

            // console.log('********** pnl pre **********');
            // printSystemInfo(await getSystemInfo(controller));
            // console.log('********** pnl pre **********');

            const lastGvtAssets = await pnl.lastGvtAssets();
            const lastPWRDAssets = await pnl.lastPwrdAssets();
            const investor1GVTSupply = await gvt.balanceOf(investor1);
            const investor1GVTAssets = await gvt.getAssets(investor1);
            const investor1PWRDAssets = await pwrd.balanceOf(investor1);
            const investor2GVTSupply = await gvt.balanceOf(investor2);
            const investor2GVTAssets = await gvt.getAssets(investor2);
            const investor2PWRDAssets = await pwrd.balanceOf(investor2);

            // mock profit
            const profitToken = toBN(1).mul(millionBaseNum).mul(daiBaseNum);
            const [
                mockDAIAlphaStrategy,
                mockDAIBetaStrategy,
            ] = DAIVaultAdaptor.strategies;
            await DAI.mint(mockDAIAlphaStrategy.address, profitToken);
            const profit = await buoy.singleStableToUsd(profitToken, 0);
            // console.log('profit: ' + profit);
            const performanceFee = await pnl.performanceFee();
            // console.log('performanceFee: ' + performanceFee);
            const profitFeeUsd = profit.mul(performanceFee).div(percentFactor);

            const [expectGVTAssets, expectPWRDAssets] = distributeProfit(
                profit.sub(profitFeeUsd), lastGvtAssets, lastPWRDAssets);
            const expectAssets = expectGVTAssets.add(expectPWRDAssets);

            const tx = await DAIVaultAdaptor.strategyHarvest(0);
            const logs = decodeLogs(tx.receipt.rawLogs, PnL, null, 'LogPnLExecution');
            // console.log('logs: ' + JSON.stringify(logs));
            expect(logs.length).equal(2);

            // console.log('********** pnl post **********');
            // printSystemInfo(await getSystemInfo(controller));
            // console.log('********** pnl post **********');

            const performanceBonus = toBN(logs[0].args.performanceBonus);
            const investPnL = toBN(logs[0].args.investPnL);
            let afterGvtAssets = toBN(logs[0].args.afterGvtAssets);
            let afterPwrdAssets = toBN(logs[0].args.afterPwrdAssets);

            const [realGVTAssets, realPWRDAssets] = await calculateRealAssets(
                expectGVTAssets, expectPWRDAssets);
            const realAssets = realGVTAssets.add(realPWRDAssets);
            // console.log('realGVTAssets: ' + realGVTAssets);
            // console.log('realPWRDAssets: ' + realPWRDAssets);

            expect(investPnL).to.be.a.bignumber.equal(profit);
            expect(performanceBonus).to.be.a.bignumber.equal(profitFeeUsd);
            expect(afterGvtAssets).to.be.a.bignumber.equal(expectGVTAssets.add(profitFeeUsd));
            expect(afterPwrdAssets).to.be.a.bignumber.equal(expectPWRDAssets);

            const beforeGvtAssets = toBN(logs[1].args.beforeGvtAssets);
            const beforePwrdAssets = toBN(logs[1].args.beforePwrdAssets);
            const pricePnL = toBN(logs[1].args.pricePnL);
            expect(beforeGvtAssets).to.be.a.bignumber.equal(afterGvtAssets);
            expect(beforePwrdAssets).to.be.a.bignumber.equal(afterPwrdAssets);
            afterGvtAssets = toBN(logs[1].args.afterGvtAssets);
            afterPwrdAssets = toBN(logs[1].args.afterPwrdAssets);
            expect(afterGvtAssets).to.be.a.bignumber.equal(beforeGvtAssets.add(pricePnL));
            expect(afterPwrdAssets).to.be.a.bignumber.equal(beforePwrdAssets);

            await expect(gvt.totalAssets()).to.eventually.be.a.bignumber.closeTo(
                afterGvtAssets, defaultDollarApproxFactor), 'gvt.totalAssets';
            await expect(pwrd.totalSupply()).to.eventually.be.a.bignumber.closeTo(
                afterPwrdAssets, defaultDollarApproxFactor, 'pwrd.totalSupply');

            await expect(controller.totalAssets()).to.eventually.be.a.bignumber.closeTo(
                realAssets, defaultDollarApproxFactor, 'controller.totalAssets');
            await expect(gvt.totalAssets()).to.eventually.be.a.bignumber.closeTo(
                realGVTAssets, defaultDollarApproxFactor), 'gvt.totalAssets';
            await expect(pwrd.totalSupply()).to.eventually.be.a.bignumber.closeTo(
                realPWRDAssets, defaultDollarApproxFactor, 'pwrd.totalSupply');
            await expect(gvt.getAssets(investor1)).to.eventually.be.a.bignumber.closeTo(
                investor1GVTAssets.mul(realGVTAssets.sub(profitFeeUsd)).div(lastGvtAssets),
                defaultDollarApproxFactor, 'gvt.balanceOf(investor1)'
            );
            await expect(pwrd.balanceOf(investor1)).to.eventually.be.a.bignumber.closeTo(
                investor1PWRDAssets.mul(realPWRDAssets).div(lastPWRDAssets),
                defaultDollarApproxFactor,
            );
            await expect(gvt.getAssets(investor2)).to.eventually.be.a.bignumber.closeTo(
                investor2GVTAssets.mul(realGVTAssets.sub(profitFeeUsd)).div(lastGvtAssets),
                defaultDollarApproxFactor,
            );
            return expect(pwrd.balanceOf(investor2)).to.eventually.be.a.bignumber.closeTo(
                investor2PWRDAssets.mul(realPWRDAssets).div(lastPWRDAssets),
                defaultDollarApproxFactor,
            );
        });

        it('distribute invest profit when ratio >= 80% without price change', async function () {
            // prepare data
            // 60 million
            const gvtDAIInvestor1 = toBN(4).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor1 = toBN(8).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor1 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor1 = toBN(4).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor1 = toBN(7).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor1 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const gvtDAIInvestor2 = toBN(6).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor2 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor2 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor2 = toBN(5).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor2 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor2 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);
            const investments = [
                [
                    [gvtDAIInvestor1, gvtUSDCInvestor1, gvtUSDTInvestor1], // gvt investor1  [dai. usdc, usdt]
                    [gvtDAIInvestor2, gvtUSDCInvestor2, gvtUSDTInvestor2], // gvt investor2  [dai, usdc, usdt]
                ],
                [
                    [pwrdDAIInvestor1, pwrdUSDCInvestor1, pwrdUSDTInvestor1], // pwrd investor1  [dai, usdc, usdt]
                    [pwrdDAIInvestor2, pwrdUSDCInvestor2, pwrdUSDTInvestor2], // pwrd investor2  [dai, usdc, usdt]
                ],
            ];
            await prepareTokenAndInvest(investments, [investor1, investor2]);
            await investVaults(controller);
            await harvestStratgies(controller);
            await lifeguard.aggregators[1].setPrice(1);

            const lastGvtAssets = await pnl.lastGvtAssets();
            const lastPWRDAssets = await pnl.lastPwrdAssets();

            // mock profit
            const profitToken = toBN(1).mul(millionBaseNum).mul(daiBaseNum);
            const [
                mockDAIAlphaStrategy,
                mockDAIBetaStrategy,
            ] = DAIVaultAdaptor.strategies;
            await DAI.mint(mockDAIAlphaStrategy.address, profitToken);
            const profit = await buoy.singleStableToUsd(profitToken, 0);
            const performanceFee = await pnl.performanceFee();
            const profitFeeUsd = profit.mul(performanceFee).div(percentFactor);

            const [expectGVTAssets, expectPWRDAssets] = distributeProfit(
                profit.sub(profitFeeUsd), lastGvtAssets, lastPWRDAssets);
            const expectAssets = expectGVTAssets.add(expectPWRDAssets);

            const tx = await DAIVaultAdaptor.strategyHarvest(0);
            const logs = decodeLogs(tx.receipt.rawLogs, PnL, null, 'LogPnLExecution');
            // console.log('logs: ' + JSON.stringify(logs));
            expect(logs.length).equal(1);

            const performanceBonus = toBN(logs[0].args.performanceBonus);
            const investPnL = toBN(logs[0].args.investPnL);
            const afterGvtAssets = toBN(logs[0].args.afterGvtAssets);
            const afterPwrdAssets = toBN(logs[0].args.afterPwrdAssets);

            expect(investPnL).to.be.a.bignumber.equal(profit);
            expect(performanceBonus).to.be.a.bignumber.equal(profitFeeUsd);
            expect(afterGvtAssets).to.be.a.bignumber.equal(expectGVTAssets.add(profitFeeUsd));
            expect(afterPwrdAssets).to.be.a.bignumber.equal(expectPWRDAssets);

            return;
        });

        it('distribute invest profit when ratio >= 80% with price change', async function () {
            // prepare data
            // 60 million
            const gvtDAIInvestor1 = toBN(4).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor1 = toBN(8).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor1 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor1 = toBN(4).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor1 = toBN(7).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor1 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const gvtDAIInvestor2 = toBN(6).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor2 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor2 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor2 = toBN(5).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor2 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor2 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);
            const investments = [
                [
                    [gvtDAIInvestor1, gvtUSDCInvestor1, gvtUSDTInvestor1], // gvt investor1  [dai. usdc, usdt]
                    [gvtDAIInvestor2, gvtUSDCInvestor2, gvtUSDTInvestor2], // gvt investor2  [dai, usdc, usdt]
                ],
                [
                    [pwrdDAIInvestor1, pwrdUSDCInvestor1, pwrdUSDTInvestor1], // pwrd investor1  [dai, usdc, usdt]
                    [pwrdDAIInvestor2, pwrdUSDCInvestor2, pwrdUSDTInvestor2], // pwrd investor2  [dai, usdc, usdt]
                ],
            ];
            await prepareTokenAndInvest(investments, [investor1, investor2]);
            await investVaults(controller);
            await harvestStratgies(controller);

            const investor1GVTSupply = await gvt.balanceOf(investor1);
            const investor1GVTAssets = await gvt.getAssets(investor1);
            const investor1PWRDAssets = await pwrd.balanceOf(investor1);
            const investor2GVTSupply = await gvt.balanceOf(investor2);
            const investor2GVTAssets = await gvt.getAssets(investor2);
            const investor2PWRDAssets = await pwrd.balanceOf(investor2);

            const lastGvtAssets = await pnl.lastGvtAssets();
            const lastPWRDAssets = await pnl.lastPwrdAssets();

            // mock profit
            const profitToken = toBN(1).mul(millionBaseNum).mul(daiBaseNum);
            const [
                mockDAIAlphaStrategy,
                mockDAIBetaStrategy,
            ] = DAIVaultAdaptor.strategies;
            await DAI.mint(mockDAIAlphaStrategy.address, profitToken);
            const profit = await buoy.singleStableToUsd(profitToken, 0);
            const performanceFee = await pnl.performanceFee();
            const profitFeeUsd = profit.mul(performanceFee).div(percentFactor);

            const [expectGVTAssets, expectPWRDAssets] = distributeProfit(
                profit.sub(profitFeeUsd), lastGvtAssets, lastPWRDAssets);
            const expectAssets = expectGVTAssets.add(expectPWRDAssets);

            const tx = await DAIVaultAdaptor.strategyHarvest(0);
            const logs = decodeLogs(tx.receipt.rawLogs, PnL, null, 'LogPnLExecution');
            // console.log('logs: ' + JSON.stringify(logs));
            expect(logs.length).equal(2);

            const performanceBonus = toBN(logs[0].args.performanceBonus);
            const investPnL = toBN(logs[0].args.investPnL);
            const afterGvtAssets = toBN(logs[0].args.afterGvtAssets);
            const afterPwrdAssets = toBN(logs[0].args.afterPwrdAssets);

            const [realGVTAssets, realPWRDAssets] = await calculateRealAssets(
                expectGVTAssets, expectPWRDAssets);
            const realAssets = realGVTAssets.add(realPWRDAssets);

            expect(investPnL).to.be.a.bignumber.equal(profit);
            expect(performanceBonus).to.be.a.bignumber.equal(profitFeeUsd);
            expect(afterGvtAssets).to.be.a.bignumber.equal(expectGVTAssets.add(profitFeeUsd));
            expect(afterPwrdAssets).to.be.a.bignumber.equal(expectPWRDAssets);

            await expect(controller.totalAssets()).to.eventually.be.a.bignumber.closeTo(
                realAssets, defaultDollarApproxFactor);
            await expect(gvt.totalAssets()).to.eventually.be.a.bignumber.closeTo(
                realGVTAssets, defaultDollarApproxFactor);
            await expect(pwrd.totalSupply()).to.eventually.be.a.bignumber.closeTo(
                realPWRDAssets, defaultDollarApproxFactor);

            await expect(gvt.getAssets(investor1)).to.eventually.be.a.bignumber.closeTo(
                investor1GVTAssets.mul(realGVTAssets.sub(profitFeeUsd)).div(lastGvtAssets),
                defaultDollarApproxFactor,
            );
            await expect(pwrd.balanceOf(investor1)).to.eventually.be.a.bignumber.closeTo(
                investor1PWRDAssets.mul(realPWRDAssets).div(lastPWRDAssets),
                defaultDollarApproxFactor,
            );
            await expect(gvt.getAssets(investor2)).to.eventually.be.a.bignumber.closeTo(
                investor2GVTAssets.mul(realGVTAssets.sub(profitFeeUsd)).div(lastGvtAssets),
                defaultDollarApproxFactor,
            );
            return expect(pwrd.balanceOf(investor2)).to.eventually.be.a.bignumber.closeTo(
                investor2PWRDAssets.mul(realPWRDAssets).div(lastPWRDAssets),
                defaultDollarApproxFactor,
            );
        });

        it('distribute invest loss when loss <= gvt assets with price change', async function () {
            // prepare data
            // 45 million
            const gvtDAIInvestor1 = toBN(4).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor1 = toBN(8).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor1 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor1 = toBN(2).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor1 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor1 = toBN(2).mul(millionBaseNum).mul(usdtBaseNum);

            const gvtDAIInvestor2 = toBN(6).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor2 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor2 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor2 = toBN(3).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor2 = toBN(2).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor2 = toBN(2).mul(millionBaseNum).mul(usdtBaseNum);
            const investments = [
                [
                    [gvtDAIInvestor1, gvtUSDCInvestor1, gvtUSDTInvestor1], // gvt investor1  [dai. usdc, usdt]
                    [gvtDAIInvestor2, gvtUSDCInvestor2, gvtUSDTInvestor2], // gvt investor2  [dai, usdc, usdt]
                ],
                [
                    [pwrdDAIInvestor1, pwrdUSDCInvestor1, pwrdUSDTInvestor1], // pwrd investor1  [dai, usdc, usdt]
                    [pwrdDAIInvestor2, pwrdUSDCInvestor2, pwrdUSDTInvestor2], // pwrd investor2  [dai, usdc, usdt]
                ],
            ];
            await prepareTokenAndInvest(investments, [investor1, investor2]);
            await investVaults(controller);
            await harvestStratgies(controller);

            const investor1GVTSupply = await gvt.balanceOf(investor1);
            const investor1GVTAssets = await gvt.getAssets(investor1);
            const investor1PWRDAssets = await pwrd.balanceOf(investor1);
            const investor2GVTSupply = await gvt.balanceOf(investor2);
            const investor2GVTAssets = await gvt.getAssets(investor2);
            const investor2PWRDAssets = await pwrd.balanceOf(investor2);

            const lastGvtAssets = await pnl.lastGvtAssets();
            const lastPWRDAssets = await pnl.lastPwrdAssets();

            // mock loss
            const lossToken = toBN(1).mul(millionBaseNum).mul(daiBaseNum);
            const [
                mockDAIAlphaStrategy,
                mockDAIBetaStrategy,
            ] = DAIVaultAdaptor.strategies;
            await DAI.burn(mockDAIAlphaStrategy.address, lossToken);
            const loss = await buoy.singleStableToUsd(lossToken, 0);

            const expectGVTAssets = lastGvtAssets.sub(loss);
            const expectPWRDAssets = lastPWRDAssets;
            const expectAssets = expectGVTAssets.add(expectPWRDAssets);

            const tx = await DAIVaultAdaptor.strategyHarvest(0);
            const logs = decodeLogs(tx.receipt.rawLogs, PnL, null, 'LogPnLExecution');
            expect(logs.length).equal(2);

            const investPnL = toBN(logs[0].args.investPnL);
            const afterGvtAssets = toBN(logs[0].args.afterGvtAssets);
            const afterPwrdAssets = toBN(logs[0].args.afterPwrdAssets);

            const [realGVTAssets, realPWRDAssets] = await calculateRealAssets(
                expectGVTAssets, expectPWRDAssets);
            const realAssets = realGVTAssets.add(realPWRDAssets);

            expect(investPnL).to.be.a.bignumber.equal(loss.mul(toBN(-1)));
            expect(afterGvtAssets).to.be.a.bignumber.equal(expectGVTAssets);
            expect(afterPwrdAssets).to.be.a.bignumber.equal(expectPWRDAssets);

            await expect(controller.totalAssets()).to.eventually.be.a.bignumber.closeTo(
                realAssets, defaultDollarApproxFactor);
            await expect(gvt.totalAssets()).to.eventually.be.a.bignumber.closeTo(
                realGVTAssets, defaultDollarApproxFactor);
            await expect(pwrd.totalSupply()).to.eventually.be.a.bignumber.closeTo(
                realPWRDAssets, defaultDollarApproxFactor);

            await expect(gvt.getAssets(investor1)).to.eventually.be.a.bignumber.closeTo(
                investor1GVTAssets.mul(realGVTAssets).div(lastGvtAssets),
                defaultDollarApproxFactor,
            );
            await expect(pwrd.balanceOf(investor1)).to.eventually.be.a.bignumber.closeTo(
                investor1PWRDAssets.mul(realPWRDAssets).div(lastPWRDAssets),
                defaultDollarApproxFactor,
            );
            await expect(gvt.getAssets(investor2)).to.eventually.be.a.bignumber.closeTo(
                investor2GVTAssets.mul(realGVTAssets).div(lastGvtAssets),
                defaultDollarApproxFactor,
            );
            return expect(pwrd.balanceOf(investor2)).to.eventually.be.a.bignumber.closeTo(
                investor2PWRDAssets.mul(realPWRDAssets).div(lastPWRDAssets),
                defaultDollarApproxFactor,
            );
        });

        it('distribute invest loss when loss > gvt assets with price change', async function () {
            // prepare data
            // 60 million
            const gvtDAIInvestor1 = toBN(4).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor1 = toBN(8).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor1 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor1 = toBN(4).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor1 = toBN(7).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor1 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const gvtDAIInvestor2 = toBN(6).mul(millionBaseNum).mul(daiBaseNum);
            const gvtUSDCInvestor2 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const gvtUSDTInvestor2 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);

            const pwrdDAIInvestor2 = toBN(5).mul(millionBaseNum).mul(daiBaseNum);
            const pwrdUSDCInvestor2 = toBN(4).mul(millionBaseNum).mul(usdcBaseNum);
            const pwrdUSDTInvestor2 = toBN(4).mul(millionBaseNum).mul(usdtBaseNum);
            const investments = [
                [
                    [gvtDAIInvestor1, gvtUSDCInvestor1, gvtUSDTInvestor1], // gvt investor1  [dai. usdc, usdt]
                    [gvtDAIInvestor2, gvtUSDCInvestor2, gvtUSDTInvestor2], // gvt investor2  [dai, usdc, usdt]
                ],
                [
                    [pwrdDAIInvestor1, pwrdUSDCInvestor1, pwrdUSDTInvestor1], // pwrd investor1  [dai, usdc, usdt]
                    [pwrdDAIInvestor2, pwrdUSDCInvestor2, pwrdUSDTInvestor2], // pwrd investor2  [dai, usdc, usdt]
                ],
            ];
            await insurance.setCurveVaultPercent(toBN(100));
            await insurance.batchSetUnderlyingTokensPercents(
                [9500, 200, 300],
            );
            await DAIVaultAdaptor.updateStrategyRatio([
                9500,
                500,
            ]);
            await buoy.setOracleTolerance(10000);
            await buoy.setCurveTolerance(10000);
            await prepareTokenAndInvest(investments, [investor1, investor2]);
            await investVaults(controller);
            await harvestStratgies(controller);

            const gvtAssets = await controller.gTokenTotalAssets({ from: gvt.address });
            const pwrdAssets = await controller.gTokenTotalAssets({ from: pwrd.address });
            const investor1GVTSupply = await gvt.balanceOf(investor1);
            const investor1GVTAssets = await gvt.getAssets(investor1);
            const investor1PWRDAssets = await pwrd.balanceOf(investor1);
            const investor2GVTSupply = await gvt.balanceOf(investor2);
            const investor2GVTAssets = await gvt.getAssets(investor2);
            const investor2PWRDAssets = await pwrd.balanceOf(investor2);

            const lastGvtAssets = await pnl.lastGvtAssets();
            const lastPWRDAssets = await pnl.lastPwrdAssets();

            // mock loss
            // mock loss
            const lossToken = toBN(33).mul(millionBaseNum).mul(daiBaseNum);
            const [
                mockDAIAlphaStrategy,
                mockDAIBetaStrategy,
            ] = DAIVaultAdaptor.strategies;
            await DAI.burn(mockDAIAlphaStrategy.address, lossToken);
            const loss = await buoy.singleStableToUsd(lossToken, 0);

            const expectGVTAssets = baseNum;
            const expectPWRDAssets = lastPWRDAssets.sub(loss.sub(lastGvtAssets).add(baseNum));
            const expectAssets = expectGVTAssets.add(expectPWRDAssets);

            const tx = await DAIVaultAdaptor.strategyHarvest(0);
            const logs = decodeLogs(tx.receipt.rawLogs, PnL, null, 'LogPnLExecution');
            // console.log("logs: " + JSON.stringify(logs));
            expect(logs.length).equal(2);

            const investPnL = toBN(logs[0].args.investPnL);
            const afterGvtAssets = toBN(logs[0].args.afterGvtAssets);
            const afterPwrdAssets = toBN(logs[0].args.afterPwrdAssets);

            const [realGVTAssets, realPWRDAssets] = await calculateRealAssets(
                expectGVTAssets, expectPWRDAssets);
            const realAssets = realGVTAssets.add(realPWRDAssets);

            expect(investPnL).to.be.a.bignumber.equal(loss.mul(toBN(-1)));
            expect(afterGvtAssets).to.be.a.bignumber.equal(expectGVTAssets);
            expect(afterPwrdAssets).to.be.a.bignumber.equal(expectPWRDAssets);

            await expect(controller.totalAssets()).to.eventually.be.a.bignumber.closeTo(
                realAssets, defaultDollarApproxFactor);
            await expect(gvt.totalAssets()).to.eventually.be.a.bignumber.closeTo(
                realGVTAssets, defaultDollarApproxFactor);
            await expect(pwrd.totalSupply()).to.eventually.be.a.bignumber.closeTo(
                realPWRDAssets, defaultDollarApproxFactor);

            await expect(gvt.getAssets(investor1)).to.eventually.be.a.bignumber.closeTo(
                investor1GVTAssets.mul(realGVTAssets).div(lastGvtAssets),
                defaultDollarApproxFactor,
            );
            await expect(pwrd.balanceOf(investor1)).to.eventually.be.a.bignumber.closeTo(
                investor1PWRDAssets.mul(realPWRDAssets).div(lastPWRDAssets),
                defaultDollarApproxFactor,
            );
            await expect(gvt.getAssets(investor2)).to.eventually.be.a.bignumber.closeTo(
                investor2GVTAssets.mul(realGVTAssets).div(lastGvtAssets),
                defaultDollarApproxFactor,
            );
            return expect(pwrd.balanceOf(investor2)).to.eventually.be.a.bignumber.closeTo(
                investor2PWRDAssets.mul(realPWRDAssets).div(lastPWRDAssets),
                defaultDollarApproxFactor,
            );
        });
    })

    describe.skip('execPnL', function () {

        it.skip('distribute price change', async function () {
            await controller.depositGvt(
                [
                    toBN(1).mul(millionBaseNum).mul(daiBaseNum),
                    toBN(1).mul(millionBaseNum).mul(usdcBaseNum),
                    toBN(1).mul(millionBaseNum).mul(usdtBaseNum),
                ],
                investor1,
            );

            await controller.depositPwrd(
                [
                    toBN(600).mul(thousandBaseNum).mul(daiBaseNum),
                    toBN(600).mul(thousandBaseNum).mul(usdcBaseNum),
                    toBN(600).mul(thousandBaseNum).mul(usdtBaseNum),
                ],
                investor1,
            );

            const preTotalAssets = await controller.totalAssets();

            let daiBalance = await pool.balances(0);
            daiBalance = daiBalance.mul(toBN(10));

            await DAI.mint(deployer, daiBalance);
            await DAI.approve(pool.address, daiBalance);
            await pool.add_liquidity([daiBalance, 0, 0], 0);

            const postTotalAssets = await controller.totalAssets();
            const priceChange = postTotalAssets.sub(preTotalAssets);

            const tx = await pnl.execPnL(0);

            const withdrawalBonus = toBN(tx.logs[0].args.withdrawalBonus);
            const beforeGvtAssets = toBN(tx.logs[0].args.beforeGvtAssets);
            const beforePwrdAssets = toBN(tx.logs[0].args.beforePwrdAssets);
            const afterGvtAssets = toBN(tx.logs[0].args.afterGvtAssets);
            const afterPwrdAssets = toBN(tx.logs[0].args.afterPwrdAssets);
            const pricePnL = toBN(tx.logs[0].args.pricePnL);
            const totalPnL = toBN(tx.logs[0].args.totalPnL);


            expect(totalPnL).to.be.a.bignumber.equal(pricePnL);
            expect(pricePnL).to.be.a.bignumber.closeTo(priceChange, toBN(2).mul(baseNum));
            expect(afterGvtAssets.sub(beforeGvtAssets)).to.be.a.bignumber.closeTo(pricePnL, toBN(100));
            expect(afterPwrdAssets.sub(beforePwrdAssets)).to.be.a.bignumber.closeTo(toBN(0), toBN(100));
            expect(afterPwrdAssets.add(afterGvtAssets)).to.be.a.bignumber.equal(await controller.totalAssets());
            return;
        });
    })

});
