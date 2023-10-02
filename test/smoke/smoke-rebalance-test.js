const { newController } = require('../utils/factory/controller')
const { BN, toBN } = require('web3-utils')
const {
  expect,
  harvestStratgies,
  investVaults,
} = require('../utils/common-utils')
const { showRebalanceTriggerResult } = require('../utils/common-utils')
const {
  stableCoinsRatios,
  getSystemInfo,
  printSystemInfo,
} = require('../utils/system-utils')
const { constants } = require('../utils/constants');

const baseNum = constants.DEFAULT_FACTOR,
  percentFactor = constants.PERCENT_FACTOR,
  daiPercent = stableCoinsRatios.daiRatio,
  usdcPercent = stableCoinsRatios.usdcRatio,
  usdtPercent = stableCoinsRatios.usdtRatio

let controller,
  insurance,
  exposure,
  allocation,
  pnl,
  gvt,
  pwrd,
  daiBaseNum, usdcBaseNum, usdtBaseNum,
  DAI, USDC, USDT,
  DAIVaultAdaptor, USDCVaultAdaptor, USDTVaultAdaptor, CurveVaultAdaptor,
  DAIVault, USDCVault, USDTVault, CurveVault,
  mockDAIAlphaStrategy,
  mockDAIBetaStrategy,
  mockUSDCAlphaStrategy,
  mockUSDCBetaStrategy,
  mockUSDTAlphaStrategy,
  mockUSDTBetaStrategy,
  mockCurveStrategy,
  pool,
  lifeguard, buoy,
  curve,
  depositHandler,
  withdrawHandler

const buffer = toBN('1000230570117464930489'), // 1000 usd
  bufferThreshold = toBN('500493867625739299698'), // 500 usd
  threshold = toBN('15499927247970299448019') // 15000 usd

// TODO List
// 1. the start-up captial is small and less than investment threshold in lifeguard
// 2. Perfemance fee
// 3. Profit distribute to gvt & PWRD
// 4. Special handling process when the system has serious losses

contract('Rebalance', function (accounts) {
  const deployer = accounts[0],
    governance = deployer,
    investor1 = accounts[1],
    investor2 = accounts[2],
    reward = accounts[9]

  function stablecoinRatios(vaultUsds) {
    let totalUsd = toBN(0);
    for (let i = 0; i < vaultUsds.length; i++) {
      // console.log('i: ' + i);
      // console.log('vaultUsds[i]: ' + vaultUsds[i]);
      totalUsd = totalUsd.add(toBN(vaultUsds[i]));
    }
    const ratios = [];
    for (let i = 0; i < vaultUsds.length; i++) {
      ratios[i] = toBN(vaultUsds[i]).mul(percentFactor).div(totalUsd);
    }
    return ratios;
  }

  function strategyTargetExposures(utilisationRatio, curveRatio) {
    const ratios = [], exposures = [];
    ratios[0] = percentFactor.mul(percentFactor).div(percentFactor.add(utilisationRatio));
    ratios[1] = utilisationRatio.mul(percentFactor).div(percentFactor.add(utilisationRatio));

    // console.log('ratios: ' + ratios);

    exposures[0] = ratios[0].mul(percentFactor.sub(curveRatio)).div(percentFactor);
    exposures[1] = ratios[1].mul(percentFactor.sub(curveRatio)).div(percentFactor);

    // console.log('exposures: ' + exposures);
    return exposures;
  }

  beforeEach('Initialize the system contracts', async function () {
    const mintAmount = new BN(1000000)
    controller = await newController()
      ;[DAI, USDC, USDT] = controller.underlyingTokens
    gvt = controller.gvt
    pwrd = controller.pwrd
    pnl = controller.pnl
    lifeguard = controller.lifeguard
    buoy = lifeguard.buoy
    insurance = controller.insurance
    exposure = insurance.exposure
    withdrawHandler = controller.withdrawHandler
    depositHandler = controller.depositHandler
    allocation = insurance.allocation;
    [DAIVaultAdaptor, USDCVaultAdaptor, USDTVaultAdaptor, CurveVaultAdaptor] = controller.vaults;
    [DAIVault, USDCVault, USDTVault, CurveVault] = [
      DAIVaultAdaptor.vault,
      USDCVaultAdaptor.vault,
      USDTVaultAdaptor.vault,
      CurveVaultAdaptor.vault,
    ];
    [
      mockDAIAlphaStrategy,
      mockDAIBetaStrategy,
    ] = DAIVaultAdaptor.strategies;
    [
      mockUSDCAlphaStrategy,
      mockUSDCBetaStrategy,
    ] = USDCVaultAdaptor.strategies;
    [
      mockUSDTAlphaStrategy,
      mockUSDTBetaStrategy,
    ] = USDTVaultAdaptor.strategies;
    [mockUSDTCompoundStrategy] = CurveVaultAdaptor.strategies;

    await insurance.batchSetUnderlyingTokensPercents([
      daiPercent,
      usdcPercent,
      usdtPercent,
    ])

    daiBaseNum = new BN(10).pow(await DAI.decimals())
    usdcBaseNum = new BN(10).pow(await USDC.decimals())
    usdtBaseNum = new BN(10).pow(await USDT.decimals())
    await buoy.updateRatios();

    await DAI.mint(investor1, mintAmount.mul(daiBaseNum), {
      from: deployer,
    })
    await USDC.mint(investor1, mintAmount.mul(usdcBaseNum), {
      from: deployer,
    })
    await USDT.mint(investor1, mintAmount.mul(usdtBaseNum), {
      from: deployer,
    })
    await DAI.mint(investor2, mintAmount.mul(daiBaseNum), {
      from: deployer,
    })
    await USDC.mint(investor2, mintAmount.mul(usdcBaseNum), {
      from: deployer,
    })
    await USDT.mint(investor2, mintAmount.mul(usdtBaseNum), {
      from: deployer,
    })

    // Add protocols to system
    pool = lifeguard.pool
    curve = pool.address

    await exposure.setProtocolCount(2)

    await allocation.setSwapThreshold(2);

    await controller.setReward(reward);

    await allocation.setCurvePercentThreshold(toBN(1200));
    await insurance.setCurveVaultPercent(toBN(1000));
    await controller.setBigFishThreshold(1, 100);
    await insurance.setWhaleThresholdDeposit(1);
  })

  describe('exposure', function () {
    it('getExactRiskExposure', async function () {
      await controller.setBigFishThreshold(1, 100);
      await insurance.setWhaleThresholdDeposit(1000);
      await exposure.setMakerUSDCExposure(0);

      const skimPercent = await controller.getSkimPercent();

      await controller.depositGvt(
        [
          toBN(1000).mul(daiBaseNum),
          toBN(1000).mul(usdcBaseNum),
          toBN(1000).mul(usdtBaseNum),
        ],
        investor1,
      );

      postSystemAssetState = await getSystemInfo(controller)
      // console.log('********** whale deposit post **********')
      // printSystemInfo(postSystemAssetState)
      // console.log('********** whale deposit post **********')

      const sysState = await insurance.prepareCalculation();
      const expState = await exposure.getExactRiskExposure(sysState);

      // console.log('stablecoinExposure: ' + expState.stablecoinExposure);
      // console.log('curveExposure: ' + expState.curveExposure);

      expect(expState.curveExposure).to.be.a.bignumber.equal(toBN(0));
      expect(expState.stablecoinExposure[0]).to.be.a.bignumber.closeTo(daiPercent, toBN(2));
      expect(expState.stablecoinExposure[1]).to.be.a.bignumber.closeTo(usdcPercent, toBN(2));
      expect(expState.stablecoinExposure[2]).to.be.a.bignumber.closeTo(usdtPercent, toBN(2));

      return;
    })

    it('calcRiskExposure', async function () {
      await controller.setBigFishThreshold(1, 100);
      await insurance.setWhaleThresholdDeposit(1000);
      await exposure.setMakerUSDCExposure(0);

      const skimPercent = await controller.getSkimPercent();

      await controller.depositGvt(
        [
          toBN(1000).mul(daiBaseNum),
          toBN(1000).mul(usdcBaseNum),
          toBN(1000).mul(usdtBaseNum),
        ],
        investor1,
      );

      postSystemAssetState = await getSystemInfo(controller)
      // console.log('********** whale deposit post **********')
      // printSystemInfo(postSystemAssetState)
      // console.log('********** whale deposit post **********')

      const sysState = await insurance.prepareCalculation();
      const expState = await exposure.calcRiskExposure(sysState);

      expect(expState.curveExposure).to.be.a.bignumber.closeTo(skimPercent, toBN(5));
      expect(expState.stablecoinExposure[0]).to.be.a.bignumber.closeTo(
        daiPercent.mul(percentFactor.sub(skimPercent)).div(percentFactor).add(skimPercent), toBN(5)
      );
      expect(expState.stablecoinExposure[1]).to.be.a.bignumber.closeTo(
        usdcPercent.mul(percentFactor.sub(skimPercent)).div(percentFactor).add(skimPercent), toBN(5)
      );
      expect(expState.stablecoinExposure[2]).to.be.a.bignumber.closeTo(
        usdtPercent.mul(percentFactor.sub(skimPercent)).div(percentFactor).add(skimPercent), toBN(5)
      );

      return;
    })
  })

  describe('rebalance', function () {

    it('protocol withdraw', async function () {
      await insurance.batchSetUnderlyingTokensPercents([
        toBN('4100'),
        toBN('2700'),
        toBN('3200'),
      ]);

      await DAIVaultAdaptor.updateStrategyRatio([
        toBN('7500'),
        toBN('2500'),
      ]);
      await USDCVaultAdaptor.updateStrategyRatio([
        toBN('7500'),
        toBN('2500'),
      ]);
      await USDTVaultAdaptor.updateStrategyRatio([
        toBN('7500'),
        toBN('2500'),
      ]);

      const investgvtAmounts = [
        toBN(35000).mul(daiBaseNum),
        toBN(35000).mul(usdcBaseNum),
        toBN(35000).mul(usdtBaseNum),
      ]
      const investPWRDAmounts = [
        toBN(25000).mul(daiBaseNum),
        toBN(25000).mul(usdcBaseNum),
        toBN(25000).mul(usdtBaseNum),
      ]
      await controller.depositGvt(investgvtAmounts, investor1)
      await controller.depositPwrd(investPWRDAmounts, investor2);
      await investVaults(controller);
      await harvestStratgies(controller);

      await insurance.batchSetUnderlyingTokensPercents([
        daiPercent,
        usdcPercent,
        usdtPercent,
      ]);

      await expect(insurance.rebalanceTrigger()).to.eventually.equal(true);
      await insurance.rebalance();
      await expect(insurance.rebalanceTrigger()).to.eventually.equal(false);

      const sysState = await insurance.prepareCalculation();
      const expResult = await exposure.getExactRiskExposure(sysState);

      // console.log('********** rebalance post **********')
      // printSystemInfo(await getSystemInfo(controller))
      // console.log('********** rebalance post **********')

      const ratios = stablecoinRatios(sysState.vaultCurrentAssetsUsd);
      expect(ratios[0]).to.be.a.bignumber.closeTo(daiPercent, toBN(1));
      expect(ratios[1]).to.be.a.bignumber.closeTo(usdcPercent, toBN(1));
      expect(ratios[2]).to.be.a.bignumber.closeTo(usdtPercent, toBN(1));

      const exps = strategyTargetExposures(await pnl.utilisationRatio(), await insurance.curveVaultPercent());
      expect(expResult.protocolExposure[0]).to.be.a.bignumber.most(exps[0]);
      expect(expResult.protocolExposure[1]).to.be.a.bignumber.most(exps[1]);

      return;
    })

    it('vault withdraw', async function () {
      await insurance.batchSetUnderlyingTokensPercents([
        toBN('6500'),
        toBN('1500'),
        toBN('2000'),
      ]);

      await DAIVaultAdaptor.updateStrategyRatio([
        toBN('6500'),
        toBN('3500'),
      ]);
      await USDCVaultAdaptor.updateStrategyRatio([
        toBN('6500'),
        toBN('3500'),
      ]);
      await USDTVaultAdaptor.updateStrategyRatio([
        toBN('6500'),
        toBN('3500'),
      ]);

      const investgvtAmounts = [
        toBN(35000).mul(daiBaseNum),
        toBN(35000).mul(usdcBaseNum),
        toBN(35000).mul(usdtBaseNum),
      ]
      const investPWRDAmounts = [
        toBN(25000).mul(daiBaseNum),
        toBN(25000).mul(usdcBaseNum),
        toBN(25000).mul(usdtBaseNum),
      ]
      await controller.depositGvt(investgvtAmounts, investor1)
      await controller.depositPwrd(investPWRDAmounts, investor2);
      await investVaults(controller);
      await harvestStratgies(controller);

      await insurance.batchSetUnderlyingTokensPercents([
        daiPercent,
        usdcPercent,
        usdtPercent,
      ]);

      await expect(insurance.rebalanceTrigger()).to.eventually.equal(true);
      await insurance.rebalance();
      await expect(insurance.rebalanceTrigger()).to.eventually.equal(false);

      const sysState = await insurance.prepareCalculation();
      const expResult = await exposure.getExactRiskExposure(sysState);

      // console.log('expResult: ' + JSON.stringify(expResult));

      // console.log('********** rebalance post **********')
      // printSystemInfo(await getSystemInfo(controller))
      // console.log('********** rebalance post **********')

      const ratios = stablecoinRatios(sysState.vaultCurrentAssetsUsd);
      expect(ratios[0]).to.be.a.bignumber.closeTo(daiPercent, toBN(1));
      expect(ratios[1]).to.be.a.bignumber.closeTo(usdcPercent, toBN(1));
      expect(ratios[2]).to.be.a.bignumber.closeTo(usdtPercent, toBN(1));

      return;
    })

    it('curve withdraw', async function () {
      await insurance.setCurveVaultPercent(toBN(7000));

      await insurance.batchSetUnderlyingTokensPercents([
        toBN('4500'),
        toBN('2500'),
        toBN('3000'),
      ]);

      await DAIVaultAdaptor.updateStrategyRatio([
        toBN('7000'),
        toBN('3000'),
      ]);
      await USDCVaultAdaptor.updateStrategyRatio([
        toBN('7000'),
        toBN('3000'),
      ]);
      await USDTVaultAdaptor.updateStrategyRatio([
        toBN('7000'),
        toBN('3000'),
      ]);

      const investgvtAmounts = [
        toBN(35000).mul(daiBaseNum),
        toBN(35000).mul(usdcBaseNum),
        toBN(35000).mul(usdtBaseNum),
      ]
      const investPWRDAmounts = [
        toBN(25000).mul(daiBaseNum),
        toBN(25000).mul(usdcBaseNum),
        toBN(25000).mul(usdtBaseNum),
      ]
      await controller.depositGvt(investgvtAmounts, investor1)
      await controller.depositPwrd(investPWRDAmounts, investor2);
      await investVaults(controller);
      await harvestStratgies(controller);

      await insurance.batchSetUnderlyingTokensPercents([
        daiPercent,
        usdcPercent,
        usdtPercent,
      ]);
      await insurance.setCurveVaultPercent(toBN(1000));

      // console.log('********** rebalance pre **********')
      // printSystemInfo(await getSystemInfo(controller))
      // console.log('********** rebalance pre **********')

      await expect(insurance.rebalanceTrigger()).to.eventually.equal(true);
      await insurance.rebalance();
      await expect(insurance.rebalanceTrigger()).to.eventually.equal(false);

      const sysState = await insurance.prepareCalculation();
      const expResult = await exposure.getExactRiskExposure(sysState);

      // console.log('expResult: ' + JSON.stringify(expResult));

      // console.log('********** rebalance post **********')
      // printSystemInfo(await getSystemInfo(controller))
      // console.log('********** rebalance post **********')

      const ratios = stablecoinRatios(sysState.vaultCurrentAssetsUsd);
      expect(ratios[0]).to.be.a.bignumber.closeTo(daiPercent, toBN(1));
      expect(ratios[1]).to.be.a.bignumber.closeTo(usdcPercent, toBN(1));
      expect(ratios[2]).to.be.a.bignumber.closeTo(usdtPercent, toBN(1));
      const curveRatio = await insurance.curveVaultPercent();
      expect(expResult.curveExposure).to.be.a.bignumber.closeTo(curveRatio, toBN(1));

      return;
    })

    it('all withdraw', async function () {
      await insurance.setCurveVaultPercent(toBN(2000));

      await insurance.batchSetUnderlyingTokensPercents([
        toBN('4000'),
        toBN('2800'),
        toBN('3200'),
      ]);

      await DAIVaultAdaptor.updateStrategyRatio([
        toBN('8200'),
        toBN('1800'),
      ]);
      await USDCVaultAdaptor.updateStrategyRatio([
        toBN('8200'),
        toBN('1800'),
      ]);
      await USDTVaultAdaptor.updateStrategyRatio([
        toBN('8200'),
        toBN('1800'),
      ]);

      const investgvtAmounts = [
        toBN(35000).mul(daiBaseNum),
        toBN(35000).mul(usdcBaseNum),
        toBN(35000).mul(usdtBaseNum),
      ]
      const investPWRDAmounts = [
        toBN(25000).mul(daiBaseNum),
        toBN(25000).mul(usdcBaseNum),
        toBN(25000).mul(usdtBaseNum),
      ]
      await controller.depositGvt(investgvtAmounts, investor1)
      await controller.depositPwrd(investPWRDAmounts, investor2);
      await investVaults(controller);
      await harvestStratgies(controller);

      await insurance.batchSetUnderlyingTokensPercents([
        daiPercent,
        usdcPercent,
        usdtPercent,
      ]);
      await insurance.setCurveVaultPercent(toBN(1000));

      // console.log('********** rebalance pre **********')
      // printSystemInfo(await getSystemInfo(controller))
      // console.log('********** rebalance pre **********')

      await expect(insurance.rebalanceTrigger()).to.eventually.equal(true);
      await insurance.rebalance();
      await expect(insurance.rebalanceTrigger()).to.eventually.equal(false);

      const sysState = await insurance.prepareCalculation();
      const expResult = await exposure.getExactRiskExposure(sysState);

      // console.log('expResult: ' + JSON.stringify(expResult));

      // console.log('********** rebalance post **********')
      // printSystemInfo(await getSystemInfo(controller))
      // console.log('********** rebalance post **********')

      const ratios = stablecoinRatios(sysState.vaultCurrentAssetsUsd);
      expect(ratios[0]).to.be.a.bignumber.closeTo(daiPercent, toBN(1));
      expect(ratios[1]).to.be.a.bignumber.closeTo(usdcPercent, toBN(1));
      expect(ratios[2]).to.be.a.bignumber.closeTo(usdtPercent, toBN(1));
      const curveRatio = await insurance.curveVaultPercent();
      expect(expResult.curveExposure).to.be.a.bignumber.closeTo(curveRatio, toBN(1));

      const exps = strategyTargetExposures(await pnl.utilisationRatio(), await insurance.curveVaultPercent());
      expect(expResult.protocolExposure[0]).to.be.a.bignumber.most(exps[0]);
      expect(expResult.protocolExposure[1]).to.be.a.bignumber.most(exps[1]);

      return;
    })
  })

  describe('rebalance trigger', function () {

    it('false', async function () {
      await insurance.batchSetUnderlyingTokensPercents([
        toBN('3900'),
        toBN('2600'),
        toBN('3500'),
      ]);

      await DAIVaultAdaptor.updateStrategyRatio([
        toBN('7000'),
        toBN('3000'),
      ]);
      await USDCVaultAdaptor.updateStrategyRatio([
        toBN('7000'),
        toBN('3000'),
      ]);
      await USDTVaultAdaptor.updateStrategyRatio([
        toBN('7000'),
        toBN('3000'),
      ]);

      const investgvtAmounts = [
        toBN(35000).mul(daiBaseNum),
        toBN(35000).mul(usdcBaseNum),
        toBN(35000).mul(usdtBaseNum),
      ]
      const investPWRDAmounts = [
        toBN(25000).mul(daiBaseNum),
        toBN(25000).mul(usdcBaseNum),
        toBN(25000).mul(usdtBaseNum),
      ]
      await controller.depositGvt(investgvtAmounts, investor1)
      await controller.depositGvt(investgvtAmounts, investor2)
      await controller.depositPwrd(investPWRDAmounts, investor1)
      await controller.depositPwrd(investPWRDAmounts, investor2);
      await investVaults(controller);
      await harvestStratgies(controller);

      return expect(insurance.rebalanceTrigger()).to.eventually.equal(false);
    })

    it('true when protocol exposed', async function () {
      await insurance.batchSetUnderlyingTokensPercents([
        toBN('3900'),
        toBN('2600'),
        toBN('3500'),
      ]);

      await DAIVaultAdaptor.updateStrategyRatio([
        toBN('8000'),
        toBN('2000'),
      ]);
      await USDCVaultAdaptor.updateStrategyRatio([
        toBN('8000'),
        toBN('2000'),
      ]);
      await USDTVaultAdaptor.updateStrategyRatio([
        toBN('8000'),
        toBN('2000'),
      ]);

      const investgvtAmounts = [
        toBN(35000).mul(daiBaseNum),
        toBN(35000).mul(usdcBaseNum),
        toBN(35000).mul(usdtBaseNum),
      ]
      const investPWRDAmounts = [
        toBN(25000).mul(daiBaseNum),
        toBN(25000).mul(usdcBaseNum),
        toBN(25000).mul(usdtBaseNum),
      ]
      await controller.depositGvt(investgvtAmounts, investor1)
      await controller.depositGvt(investgvtAmounts, investor2)
      await controller.depositPwrd(investPWRDAmounts, investor1)
      await controller.depositPwrd(investPWRDAmounts, investor2);
      await investVaults(controller);
      await harvestStratgies(controller);

      // console.log('********** true when protocol exposed post **********')
      // printSystemInfo(await getSystemInfo(controller))
      // console.log('********** true when protocol exposed post **********')

      return expect(insurance.rebalanceTrigger()).to.eventually.equal(true);
    })

    it('true when curve exposed', async function () {
      await insurance.setCurveVaultPercent(toBN(7000));

      await insurance.batchSetUnderlyingTokensPercents([
        toBN('3900'),
        toBN('2600'),
        toBN('3500'),
      ]);

      await DAIVaultAdaptor.updateStrategyRatio([
        toBN('8000'),
        toBN('2000'),
      ]);
      await USDCVaultAdaptor.updateStrategyRatio([
        toBN('8000'),
        toBN('2000'),
      ]);
      await USDTVaultAdaptor.updateStrategyRatio([
        toBN('8000'),
        toBN('2000'),
      ]);

      const investgvtAmounts = [
        toBN(35000).mul(daiBaseNum),
        toBN(35000).mul(usdcBaseNum),
        toBN(35000).mul(usdtBaseNum),
      ]
      const investPWRDAmounts = [
        toBN(25000).mul(daiBaseNum),
        toBN(25000).mul(usdcBaseNum),
        toBN(25000).mul(usdtBaseNum),
      ]
      await controller.depositGvt(investgvtAmounts, investor1)
      await controller.depositGvt(investgvtAmounts, investor2)
      await controller.depositPwrd(investPWRDAmounts, investor1)
      await controller.depositPwrd(investPWRDAmounts, investor2);
      await investVaults(controller);
      await harvestStratgies(controller);

      // console.log('********** true when protocol exposed post **********')
      // printSystemInfo(await getSystemInfo(controller))
      // console.log('********** true when protocol exposed post **********')

      return expect(insurance.rebalanceTrigger()).to.eventually.equal(true);
    })

    it('true when stable coin exposed', async function () {
      await insurance.batchSetUnderlyingTokensPercents([
        toBN('2500'),
        toBN('6000'),
        toBN('1500'),
      ]);

      await DAIVaultAdaptor.updateStrategyRatio([
        toBN('6000'),
        toBN('4000'),
      ]);
      await USDCVaultAdaptor.updateStrategyRatio([
        toBN('6000'),
        toBN('4000'),
      ]);
      await USDTVaultAdaptor.updateStrategyRatio([
        toBN('6000'),
        toBN('4000'),
      ]);

      const investgvtAmounts = [
        toBN(35000).mul(daiBaseNum),
        toBN(35000).mul(usdcBaseNum),
        toBN(35000).mul(usdtBaseNum),
      ]
      const investPWRDAmounts = [
        toBN(25000).mul(daiBaseNum),
        toBN(25000).mul(usdcBaseNum),
        toBN(25000).mul(usdtBaseNum),
      ]
      await controller.depositGvt(investgvtAmounts, investor1)
      await controller.depositGvt(investgvtAmounts, investor2)
      await controller.depositPwrd(investPWRDAmounts, investor1)
      await controller.depositPwrd(investPWRDAmounts, investor2);
      await investVaults(controller);
      await harvestStratgies(controller);

      // console.log('********** true when protocol exposed post **********')
      // printSystemInfo(await getSystemInfo(controller))
      // console.log('********** true when protocol exposed post **********')

      return expect(insurance.rebalanceTrigger()).to.eventually.equal(true);
    })
  })
})
