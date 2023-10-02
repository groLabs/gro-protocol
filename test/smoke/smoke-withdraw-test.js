const { newController } = require('../utils/factory/controller');
const RebasingGToken = artifacts.require('RebasingGToken');
const { BN, toBN } = require('web3-utils');
const {
  expect,
} = require('../utils/common-utils');
const {
  stableCoinsRatios,
  getSystemInfo,
  getUserInfo,
  printSystemInfo,
  printUserInfo,
  compareSystemInfo,
  compareUserStableCoins,
  compareUserGTokens,
  compareAdapters,
} = require('../utils/system-utils');

const { mintToken, burnToken, setBalance } = require('../utils/token-utils');
const { distributeProfit, userPnL } = require('../utils/pnl-utils');
const { constants } = require('../utils/constants');

const mainnet = network.config.forking !== undefined;
console.log(mainnet)

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
  mockDAIAlphaStrategy,
  mockDAIBetaStrategy,
  pool,
  buoy,
  lifeguard,
  curve, withdrawHandler;

contract('Small & Whale Withdrawal', function (accounts) {
  const deployer = accounts[0],
    governance = deployer,
    investor1 = accounts[1],
    investor2 = accounts[2],
    reward = accounts[9]

  async function calculateAllVaultsWithdrawAmounts(vaults, decimals, withdrawUsd, percents, buoy) {
    let totalAssets = toBN(0);
    const vaultAssets = [];
    for (let i = 0; i < vaults.length; i++) {
      vaultAssets[i] = vaults[i].mul(baseNum).div(decimals[i]);
      totalAssets = totalAssets.add(vaultAssets[i]);
    }
    totalAssets = totalAssets.sub(withdrawUsd);
    const result = [];
    let totalDelta = toBN(0);
    for (let i = 0; i < vaults.length; i++) {
      const target = totalAssets.mul(percents[i]).div(percentFactor);
      if (vaultAssets[i] > target) {
        result[i] = vaultAssets[i].sub(target);
        totalDelta = totalDelta.add(result[i]);
      }
    }
    let percent = percentFactor;
    for (let i = 0; i < vaults.length - 1; i++) {
      if (result[i] > 0) {
        result[i] = result[i].mul(percentFactor).div(totalDelta);
        percent = percent.sub(result[i]);
      }
    }
    result[vaults.length - 1] = percent;
    for (let i = 0; i < vaults.length; i++) {
      if (result[i] > 0) {
        result[i] = result[i].mul(withdrawUsd).div(percentFactor);
        result[i] = toBN(await buoy.singleStableFromUsd(result[i], i));
      } else {
        result[i] = toBN(0);
      }
    }
    return result;
  }

  beforeEach('Initialize the system contracts', async function () {
    controller = await newController(mainnet)
      ;[DAI, USDC, USDT] = controller.underlyingTokens
    withdrawHandler = controller.withdrawHandler;
    gvt = controller.gvt
    pwrd = controller.pwrd
    pnl = controller.pnl
    lifeguard = controller.lifeguard;
    buoy = lifeguard.buoy;
    insurance = controller.insurance;
    exposure = insurance.exposure;
    allocation = insurance.allocation;
    [DAIVaultAdaptor, USDCVaultAdaptor, USDTVaultAdaptor] = controller.vaults;
    [
      mockDAIAlphaStrategy,
      mockDAIBetaStrategy,
    ] = DAIVaultAdaptor.strategies;

    await insurance.batchSetUnderlyingTokensPercents([
      daiPercent,
      usdcPercent,
      usdtPercent,
    ])

    await buoy.updateRatios();
    daiBaseNum = new BN(10).pow(DAI.detailed.decimals)
    usdcBaseNum = new BN(10).pow(USDC.detailed.decimals)
    usdtBaseNum = new BN(10).pow(USDT.detailed.decimals)

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
    await controller.setBigFishThreshold(1000, toBN(200).mul(daiBaseNum));
    const deposit0 = [
      toBN(50).mul(daiBaseNum),
      toBN(50).mul(usdcBaseNum),
      toBN(50).mul(usdtBaseNum),
    ]

    await controller.depositGvt(
      deposit0,
      investor1,
    )
    await controller.depositGvt(
      deposit0,
      investor1,
    )

    await insurance.setWhaleThresholdDeposit(2000);
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
    let postUserAssetState = await getUserInfo(controller, investor1)

    // // printSystemInfo(postSystemAssetState)
    // // printUserInfo(postUserAssetState)
  })

  describe('revert', function () {
    it('should revert when GVT < PWRD', async function () {
      const deposit1 = [
        toBN(20000).mul(daiBaseNum),
        toBN(20000).mul(usdcBaseNum),
        toBN(20000).mul(usdtBaseNum),
      ]
      await controller.depositPwrd(
        deposit1,
        investor2,
      )

      await controller.setBigFishThreshold(100, 100);
      await insurance.setWhaleThresholdWithdraw(10);

      return expect(
        controller.withdrawByStablecoinGvt(
          0,
          toBN(50000).mul(baseNum),
          investor1,
        ),
      ).to.eventually.be.rejected;
    });

    it('should revert when token shares exceed', async function () {
      return expect(
        controller.withdrawByStablecoinGvt(
          0,
          toBN(10000).mul(baseNum),
          investor2,
        ),
      ).to.eventually.be.rejected;
    });

    it('should not be possible to withdraw more than system total Assets', async function () {
      await controller.depositGvt(
        [
          toBN(30000).mul(daiBaseNum),
          toBN(30000).mul(usdcBaseNum),
          toBN(30000).mul(usdtBaseNum),
        ],
        investor2,
      )

      let withdrawAmountUsd = toBN(250000).mul(daiBaseNum);

      return expect(controller.withdrawByLPTokenGvt(
        withdrawAmountUsd,
        investor1,
      )).to.eventually.be.rejectedWith('totalAssets < withdrawalUsd');
    });

    // this test only works on fork
    it.skip('should revert when safety check false', async function () {
      const deposit1 = [
        toBN(100).mul(daiBaseNum),
        toBN(100).mul(usdcBaseNum),
        toBN(100).mul(usdtBaseNum),
      ]
      await controller.depositPwrd(
        deposit1,
        investor1,
      )
      const pool = lifeguard.pool;
      let daiBalance = await pool.balances(0);
      daiBalance = daiBalance.mul(toBN(10));

      console.log('health ' + await buoy.safetyCheck())
      await setBalance('dai', deployer, '100000000');
      const largeAmount = toBN('100000000').mul(toBN(1E18));

      //await DAI.mint(deployer, daiBalance);
      // await mintToken(DAI, deployer, daiBalance, mainnet);
      await DAI.approve(pool.address, largeAmount);
      await pool.add_liquidity([largeAmount, 0, 0], 0);
      console.log('health ' + await buoy.safetyCheck())

      return expect(controller.withdrawByStablecoinPwrd(
          toBN(0),
          toBN(100).mul(baseNum),
          investor1,
      )).to.eventually.be.rejectedWith('!safetyCheck');
    })
  })

  describe('Withdrawals', function () {
    beforeEach('Inject initial assets into the system', async function () {
      await insurance.setWhaleThresholdDeposit(2000);
      await insurance.setWhaleThresholdWithdraw(2000);
      await controller.setBigFishThreshold(1000, toBN(200).mul(daiBaseNum));

      const deposit0 = [
        toBN(50).mul(daiBaseNum),
        toBN(50).mul(usdcBaseNum),
        toBN(50).mul(usdtBaseNum),
      ]

      await controller.depositGvt(
        deposit0,
        investor1,
      )

      await controller.depositGvt(
        deposit0,
        investor1,
      )

      await insurance.setCurveVaultPercent(1000);
      const deposit1 = [
        toBN(30000).mul(daiBaseNum),
        toBN(30000).mul(usdcBaseNum),
        toBN(30000).mul(usdtBaseNum),
      ]

      const deposit2 = [
        toBN(20000).mul(daiBaseNum),
        toBN(20000).mul(usdcBaseNum),
        toBN(20000).mul(usdtBaseNum),
      ]

      await controller.depositGvt(
        deposit1,
        investor1,
      )

      await controller.depositPwrd(
        deposit2,
        investor1,
      )

      // await harvestStratgies(controller);
      // Check whether the initial state is correct
      const deposit3 = [
        toBN(120).mul(daiBaseNum),
        toBN(120).mul(usdcBaseNum),
        toBN(120).mul(usdtBaseNum),
      ]
      const deposit4 = [
        toBN(100).mul(daiBaseNum),
        toBN(100).mul(usdcBaseNum),
        toBN(100).mul(usdtBaseNum),
      ]
      await controller.depositGvt(
        deposit3,
        investor2,
      )
      await controller.depositPwrd(
        deposit4,
        investor2,
      )
    })

    it('sardine withdraw', async function () {
      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor1)

      const withdrawUsd = toBN(100).mul(baseNum)
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const bonus = withdrawUsd.mul(withdrawFee).div(percentFactor);
      const withdrawUsdWithoutFee = withdrawUsd.sub(bonus);
      const lastGvtAssets = preSystemAssetState.gvtAsset;
      const lastPwrdAssets = preSystemAssetState.pwrdAsset;
      const gvtBonus = bonus.mul(lastGvtAssets).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const pwrdBonus = bonus.mul(lastPwrdAssets.sub(withdrawUsd)).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const withdrawDAI = await buoy.singleStableFromUsd(withdrawUsdWithoutFee, 0);

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)

      await controller.withdrawByStablecoinPwrd(
        toBN(0),
        withdrawUsd,
        investor1,
      );

      const postSystemAssetState = await getSystemInfo(controller)
      const postUserAssetState = await getUserInfo(controller, investor1)

      const allGvtBalance = await gvt.totalSupplyBase();
      const allPwrdBalance = await pwrd.totalSupplyBase();
      const investor1GvtBalance = await gvt.balanceOfBase(investor1);
      const investor1PwrdBalance = await pwrd.balanceOfBase(investor1);
      const investor1GvtBonus = gvtBonus.mul(investor1GvtBalance).div(allGvtBalance);
      const investor1PwrdBonus = pwrdBonus.mul(investor1PwrdBalance).div(allPwrdBalance);

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        0,
        withdrawUsdWithoutFee,
        gvtBonus,
        withdrawUsd.sub(pwrdBonus),
      ]);
      compareAdapters(preSystemAssetState, postSystemAssetState, [withdrawDAI.add(daiBaseNum), 0, 0]);

      compareUserStableCoins(preUserAssetState, postUserAssetState, [withdrawDAI.add(toBN(1)), 0, 0]);
      compareUserGTokens(preUserAssetState, postUserAssetState, [investor1GvtBonus.add(toBN(1e10)), withdrawUsd.sub(investor1PwrdBonus)]);

      return;
    })

    it('tuna withdraw', async function () {
      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)

      await controller.setBigFishThreshold(1, 1);
      await insurance.setWhaleThresholdWithdraw(2000);
      // Adjust stable coin ratio to make usdc most
      await insurance.batchSetUnderlyingTokensPercents([
        daiPercent.add(toBN(500)),
        usdcPercent.sub(toBN(1000)),
        usdtPercent.add(toBN(500)),
      ]);

      const withdrawUsd = toBN(1000).mul(baseNum);
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const bonus = withdrawUsd.mul(withdrawFee).div(percentFactor);
      const withdrawUsdWithoutFee = withdrawUsd.sub(bonus);
      const lastGvtAssets = preSystemAssetState.gvtAsset;
      const lastPwrdAssets = preSystemAssetState.pwrdAsset;
      const gvtBonus = bonus.mul(lastGvtAssets).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const pwrdBonus = bonus.mul(lastPwrdAssets.sub(withdrawUsd)).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));

      await controller.withdrawByStablecoinPwrd(
        toBN(0),
        withdrawUsd,
        investor1,
      );

      postSystemAssetState = await getSystemInfo(controller)
      postUserAssetState = await getUserInfo(controller, investor1)

      // // // printSystemInfo(postSystemAssetState)
      // // // printUserInfo(postUserAssetState)

      const allGvtBalance = await gvt.totalSupplyBase();
      const allPwrdBalance = await pwrd.totalSupplyBase();
      const investor1GvtBalance = await gvt.balanceOfBase(investor1);
      const investor1PwrdBalance = await pwrd.balanceOfBase(investor1);
      const investor1GvtBonus = gvtBonus.mul(investor1GvtBalance).div(allGvtBalance);
      const investor1PwrdBonus = pwrdBonus.mul(investor1PwrdBalance).div(allPwrdBalance);

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        toBN(1).mul(baseNum),
        withdrawUsdWithoutFee,
        gvtBonus,
        withdrawUsd.sub(pwrdBonus),
      ]);

      compareAdapters(preSystemAssetState, postSystemAssetState, [
        0,
        await buoy.singleStableFromUsd(withdrawUsdWithoutFee, 1),
        0,
      ]);

      compareUserStableCoins(preUserAssetState, postUserAssetState,
        [await buoy.singleStableFromUsd(withdrawUsdWithoutFee, 0), 0, 0]);
      compareUserGTokens(preUserAssetState, postUserAssetState, [investor1GvtBonus.add(toBN(1e10)), withdrawUsd.sub(investor1PwrdBonus)]);

      return;
    })

    it('whale withdraw', async function () {
      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)

      await controller.setBigFishThreshold(1, 1);
      await insurance.setWhaleThresholdWithdraw(10);

      const withdrawUsd = toBN(1000).mul(baseNum);
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const bonus = withdrawUsd.mul(withdrawFee).div(percentFactor);
      const withdrawUsdWithoutFee = withdrawUsd.sub(bonus);
      const lastGvtAssets = preSystemAssetState.gvtAsset;
      const lastPwrdAssets = preSystemAssetState.pwrdAsset;
      const gvtBonus = bonus.mul(lastGvtAssets).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const pwrdBonus = bonus.mul(lastPwrdAssets.sub(withdrawUsd)).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));

      const withdrawAmounts = await calculateAllVaultsWithdrawAmounts(
        [preSystemAssetState.daiAdapterTotalAsset, preSystemAssetState.usdcAdapterTotalAsset, preSystemAssetState.usdtAdapterTotalAsset],
        [daiBaseNum, usdcBaseNum, usdtBaseNum],
        withdrawUsdWithoutFee,
        [daiPercent, usdcPercent, usdtPercent],
        buoy);


      await controller.withdrawByStablecoinPwrd(
        toBN(0),
        withdrawUsd,
        investor1,
      );

      postSystemAssetState = await getSystemInfo(controller)
      postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      const allGvtBalance = await gvt.totalSupplyBase();
      const allPwrdBalance = await pwrd.totalSupplyBase();
      const investor1GvtBalance = await gvt.balanceOfBase(investor1);
      const investor1PwrdBalance = await pwrd.balanceOfBase(investor1);
      const investor1GvtBonus = gvtBonus.mul(investor1GvtBalance).div(allGvtBalance);
      const investor1PwrdBonus = pwrdBonus.mul(investor1PwrdBalance).div(allPwrdBalance);

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        toBN(1).mul(baseNum),
        withdrawUsdWithoutFee.add(toBN(1E18)),
        gvtBonus,
        withdrawUsd.sub(pwrdBonus),
      ]);
      compareAdapters(preSystemAssetState, postSystemAssetState,
        [
          withdrawAmounts[0].add(toBN(1).mul(daiBaseNum)),
          withdrawAmounts[1].add(toBN(1).mul(usdcBaseNum)),
          withdrawAmounts[2].add(toBN(1).mul(usdtBaseNum))
        ]);

      const daiAmount = await buoy.singleStableFromUsd(withdrawUsdWithoutFee, 0)
      compareUserStableCoins(preUserAssetState, postUserAssetState,
        [daiAmount.add(toBN(1).mul(daiBaseNum)), 0, 0]);
      compareUserGTokens(preUserAssetState, postUserAssetState, [investor1GvtBonus.add(toBN(1e10)), withdrawUsd.sub(investor1PwrdBonus)]);
      return;
    })

    it('Should be possible to withdraw < 100 % but more than 99%', async function () {
      let preSystemAssetState = await getSystemInfo(controller)
      let preUserAssetState = await getUserInfo(controller, investor1)
      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)
      const investor2PWRDAssets = await pwrd.balanceOf(investor2);
      const investor1PWRDAssets = await pwrd.balanceOf(investor1);
      const defaultSlippagePercent = toBN(3), defaultSlippageBaseNum = toBN(1000);

      withdrawUsd = '59941042216378299036917';
      await controller.withdrawByStablecoinPwrd(
        toBN(0),
        withdrawUsd,
        investor1,
      )
      postSystemAssetState = await getSystemInfo(controller)
      postSystemAssetState = await getSystemInfo(controller)
      // expect(preSystemAssetState.pwrdFactor.sub(postSystemAssetState.pwrdFactor))
      //   .to.be.a.bignumber.closeTo(toBN(0), baseNum.div(toBN(100)));
      // expect(preSystemAssetState.gvtFactor)
      //   .to.be.a.bignumber.greaterThan(postSystemAssetState.gvtFactor);
      return;
    })

    it('Withdrawal fees should not affect pwrd if rebasing is turned off', async function () {
      let preSystemAssetState = await getSystemInfo(controller)
      let preUserAssetState = await getUserInfo(controller, investor1)
      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)
      const investor2PWRDAssets = await pwrd.balanceOf(investor2);
      const investor1PWRDAssets = await pwrd.balanceOf(investor1);
      const defaultSlippagePercent = toBN(3), defaultSlippageBaseNum = toBN(1000);

      withdrawUsd = toBN('59941042216378299036917');
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const bonus = withdrawUsd.mul(withdrawFee).div(percentFactor);
      const withdrawUsdWithoutFee = withdrawUsd.sub(bonus);

      await pnl.setRebase(false);
      await controller.withdrawByStablecoinPwrd(
        toBN(0),
        withdrawUsd,
        investor1,
      )
      postSystemAssetState = await getSystemInfo(controller)
      postSystemAssetState = await getSystemInfo(controller)

      expect(preSystemAssetState.pwrdFactor.sub(postSystemAssetState.pwrdFactor))
        .to.be.a.bignumber.equal(toBN(0));
      expect(postSystemAssetState.gvtAsset.sub(preSystemAssetState.gvtAsset))
        .to.be.a.bignumber.closeTo(bonus, toBN(1));
      expect(preSystemAssetState.pwrdAsset.sub(postSystemAssetState.pwrdAsset))
        .to.be.a.bignumber.closeTo(withdrawUsd, toBN(1));
      return;
    })

    it('Should be possible to withdraw by single (small amount)', async function () {
      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor1)

      const withdrawUsd = toBN(200).mul(baseNum)
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const bonus = withdrawUsd.mul(withdrawFee).div(percentFactor);
      const withdrawUsdWithoutFee = withdrawUsd.sub(bonus);
      const lastGvtAssets = preSystemAssetState.gvtAsset;
      const lastPwrdAssets = preSystemAssetState.pwrdAsset;
      const gvtBonus = bonus.mul(lastGvtAssets).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const pwrdBonus = bonus.mul(lastPwrdAssets.sub(withdrawUsd)).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const withdrawUSDT = await buoy.singleStableFromUsd(withdrawUsdWithoutFee, 2);

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)

      await controller.setBigFishThreshold(1000, toBN(1000).mul(baseNum));

      await controller.withdrawByStablecoinPwrd(
        2,
        withdrawUsd,
        investor1,
      )
      const postSystemAssetState = await getSystemInfo(controller)
      const postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      const allGvtBalance = await gvt.totalSupplyBase();
      const allPwrdBalance = await pwrd.totalSupplyBase();
      const investor1GvtBalance = await gvt.balanceOfBase(investor1);
      const investor1PwrdBalance = await pwrd.balanceOfBase(investor1);
      const investor1GvtBonus = gvtBonus.mul(investor1GvtBalance).div(allGvtBalance);
      const investor1PwrdBonus = pwrdBonus.mul(investor1PwrdBalance).div(allPwrdBalance);

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        0,
        withdrawUsdWithoutFee,
        gvtBonus,
        withdrawUsd.sub(pwrdBonus),
      ])
      compareAdapters(preSystemAssetState, postSystemAssetState, [
        0,
        0,
        withdrawUSDT,
      ])

      compareUserStableCoins(preUserAssetState, postUserAssetState, [
        0,
        0,
        withdrawUSDT,
      ])
      compareUserGTokens(preUserAssetState, postUserAssetState, [investor1GvtBonus.add(toBN(1e9)), withdrawUsd.sub(investor1PwrdBonus)])
      return;
    })

    it('Should be possible to withdraw by single (large amount)', async function () {
      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)

      const withdrawUsd = toBN(2500).mul(baseNum)
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const bonus = withdrawUsd.mul(withdrawFee).div(percentFactor);
      const withdrawUsdWithoutFee = withdrawUsd.sub(bonus);
      const lastGvtAssets = preSystemAssetState.gvtAsset;
      const lastPwrdAssets = preSystemAssetState.pwrdAsset;
      const gvtBonus = bonus.mul(lastGvtAssets).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const pwrdBonus = bonus.mul(lastPwrdAssets.sub(withdrawUsd)).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const withdrawUSDC = await buoy.singleStableFromUsd(withdrawUsdWithoutFee, 1);

      await controller.setBigFishThreshold(1, 1);
      await insurance.setWhaleThresholdWithdraw(2000);
      // Adjust stable coin ratio to make usdc most
      await insurance.batchSetUnderlyingTokensPercents([
        daiPercent.add(toBN(500)),
        usdcPercent.add(toBN(500)),
        usdtPercent.sub(toBN(1000)),
      ]);

      await controller.withdrawByStablecoinPwrd(
        1,
        withdrawUsd,
        investor1,
      )
      const postSystemAssetState = await getSystemInfo(controller)
      const postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      const allGvtBalance = await gvt.totalSupplyBase();
      const allPwrdBalance = await pwrd.totalSupplyBase();
      const investor1GvtBalance = await gvt.balanceOfBase(investor1);
      const investor1PwrdBalance = await pwrd.balanceOfBase(investor1);
      const investor1GvtBonus = gvtBonus.mul(investor1GvtBalance).div(allGvtBalance);
      const investor1PwrdBonus = pwrdBonus.mul(investor1PwrdBalance).div(allPwrdBalance);

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        baseNum,
        withdrawUsdWithoutFee,
        gvtBonus,
        withdrawUsd.sub(pwrdBonus),
      ])
      compareAdapters(preSystemAssetState, postSystemAssetState,
        [
          0, 0, await buoy.singleStableFromUsd(withdrawUsdWithoutFee, 2)
        ]);

      compareUserStableCoins(preUserAssetState, postUserAssetState,
        [0, withdrawUSDC, 0]);
      compareUserGTokens(preUserAssetState, postUserAssetState, [investor1GvtBonus.add(toBN(1e9)), withdrawUsd.sub(investor1PwrdBonus)]);
      return;
    })

    it('Should be possible to withdraw by lp (small amount)', async function () {
      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)

      await controller.setBigFishThreshold(1000, toBN(1000).mul(baseNum));

      const withdrawUsd = toBN(300).mul(baseNum);
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const bonus = withdrawUsd.mul(withdrawFee).div(percentFactor);
      const withdrawUsdWithoutFee = withdrawUsd.sub(bonus);
      const lastGvtAssets = preSystemAssetState.gvtAsset;
      const lastPwrdAssets = preSystemAssetState.pwrdAsset;
      const gvtBonus = bonus.mul(lastGvtAssets).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const pwrdBonus = bonus.mul(lastPwrdAssets.sub(withdrawUsd)).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));

      const withdrawAmounts = await calculateAllVaultsWithdrawAmounts(
        [preSystemAssetState.daiAdapterTotalAsset, preSystemAssetState.usdcAdapterTotalAsset, preSystemAssetState.usdtAdapterTotalAsset],
        [daiBaseNum, usdcBaseNum, usdtBaseNum],
        withdrawUsdWithoutFee,
        [daiPercent, usdcPercent, usdtPercent],
        buoy);

      await controller.withdrawByLPTokenPwrd(withdrawUsd, investor1);

      const postSystemAssetState = await getSystemInfo(controller)
      const postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      const allGvtBalance = await gvt.totalSupplyBase();
      const allPwrdBalance = await pwrd.totalSupplyBase();
      const investor1GvtBalance = await gvt.balanceOfBase(investor1);
      const investor1PwrdBalance = await pwrd.balanceOfBase(investor1);
      const investor1GvtBonus = gvtBonus.mul(investor1GvtBalance).div(allGvtBalance);
      const investor1PwrdBonus = pwrdBonus.mul(investor1PwrdBalance).div(allPwrdBalance);

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        0,
        withdrawUsdWithoutFee,
        gvtBonus,
        withdrawUsd.sub(pwrdBonus),
      ])
      compareAdapters(preSystemAssetState, postSystemAssetState, [
        withdrawAmounts[0].add(toBN(1).mul(daiBaseNum)),
        withdrawAmounts[1].add(toBN(1).mul(usdcBaseNum)),
        withdrawAmounts[2].add(toBN(1).mul(usdtBaseNum))
      ]);

      compareUserStableCoins(preUserAssetState, postUserAssetState,
        [
          withdrawAmounts[0].add(toBN(1).mul(daiBaseNum)),
          withdrawAmounts[1].add(toBN(1).mul(usdcBaseNum)),
          withdrawAmounts[2].add(toBN(1).mul(usdtBaseNum))
        ]
      )

      compareUserGTokens(preUserAssetState, postUserAssetState
        , [investor1GvtBonus.add(toBN(1e9)), withdrawUsd.sub(investor1PwrdBonus)])
      return;
    })

    it('Should be possible to withdraw by lp (large amount)', async function () {
      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)

      await controller.setBigFishThreshold(1, 1);

      const withdrawUsd = toBN(3000).mul(baseNum);
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const bonus = withdrawUsd.mul(withdrawFee).div(percentFactor);
      const withdrawUsdWithoutFee = withdrawUsd.sub(bonus);
      const lastGvtAssets = preSystemAssetState.gvtAsset;
      const lastPwrdAssets = preSystemAssetState.pwrdAsset;
      const gvtBonus = bonus.mul(lastGvtAssets).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const pwrdBonus = bonus.mul(lastPwrdAssets.sub(withdrawUsd)).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));

      const withdrawAmounts = await calculateAllVaultsWithdrawAmounts(
        [preSystemAssetState.daiAdapterTotalAsset, preSystemAssetState.usdcAdapterTotalAsset, preSystemAssetState.usdtAdapterTotalAsset],
        [daiBaseNum, usdcBaseNum, usdtBaseNum],
        withdrawUsdWithoutFee,
        [daiPercent, usdcPercent, usdtPercent],
        buoy);

      await controller.withdrawByLPTokenPwrd(withdrawUsd, investor1);

      const postSystemAssetState = await getSystemInfo(controller)
      const postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      const allGvtBalance = await gvt.totalSupplyBase();
      const allPwrdBalance = await pwrd.totalSupplyBase();
      const investor1GvtBalance = await gvt.balanceOfBase(investor1);
      const investor1PwrdBalance = await pwrd.balanceOfBase(investor1);
      const investor1GvtBonus = gvtBonus.mul(investor1GvtBalance).div(allGvtBalance);
      const investor1PwrdBonus = pwrdBonus.mul(investor1PwrdBalance).div(allPwrdBalance);

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        0,
        withdrawUsdWithoutFee,
        gvtBonus,
        withdrawUsd.sub(pwrdBonus),
      ])
      compareAdapters(preSystemAssetState, postSystemAssetState, [
        withdrawAmounts[0].add(toBN(1).mul(daiBaseNum)),
        withdrawAmounts[1].add(toBN(1).mul(usdcBaseNum)),
        withdrawAmounts[2].add(toBN(1).mul(usdtBaseNum))
      ]);

      compareUserStableCoins(preUserAssetState, postUserAssetState,
        [
          withdrawAmounts[0].add(toBN(1).mul(daiBaseNum)),
          withdrawAmounts[1].add(toBN(1).mul(usdcBaseNum)),
          withdrawAmounts[2].add(toBN(1).mul(usdtBaseNum))
        ]
      )

      compareUserGTokens(preUserAssetState, postUserAssetState
        , [investor1GvtBonus.add(toBN(1e9)), withdrawUsd.sub(investor1PwrdBonus)])
      return;
    })

    it('Should be possible to withdraw all by single (small amount)', async function () {
      let preSystemAssetState = await getSystemInfo(controller)
      let preUserAssetState = await getUserInfo(controller, investor2)

      // // // printSystemInfo(preSystemAssetState)
      // // // printUserInfo(preUserAssetState)

      await controller.setBigFishThreshold(10000, toBN(100000).mul(baseNum));

      const withdrawUsd = await pwrd.balanceOf(investor2);
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const bonus = withdrawUsd.mul(withdrawFee).div(percentFactor);
      const withdrawUsdWithoutFee = withdrawUsd.sub(bonus);
      const lastGvtAssets = preSystemAssetState.gvtAsset;
      const lastPwrdAssets = preSystemAssetState.pwrdAsset;
      const gvtBonus = bonus.mul(lastGvtAssets).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const pwrdBonus = bonus.mul(lastPwrdAssets.sub(withdrawUsd)).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const withdrawUSDT = await buoy.singleStableFromUsd(withdrawUsdWithoutFee, 2);

      await controller.withdrawAllSinglePwrd(
        2,
        0,
        investor2
      );

      const postSystemAssetState = await getSystemInfo(controller)
      const postUserAssetState = await getUserInfo(controller, investor2)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      const allGvtBalance = await gvt.totalSupplyBase();
      const allPwrdBalance = await pwrd.totalSupplyBase();
      const investorGvtBalance = await gvt.balanceOfBase(investor2);
      const investorPwrdBalance = await pwrd.balanceOfBase(investor2);
      const investorGvtBonus = gvtBonus.mul(investorGvtBalance).div(allGvtBalance);
      const investorPwrdBonus = pwrdBonus.mul(investorPwrdBalance).div(allPwrdBalance);

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        0,
        withdrawUsdWithoutFee,
        gvtBonus,
        withdrawUsd.sub(pwrdBonus),
      ])
      compareAdapters(preSystemAssetState, postSystemAssetState, [
        0, 0, withdrawUSDT
      ]);

      compareUserStableCoins(preUserAssetState, postUserAssetState,
        [
          0, 0, withdrawUSDT
        ]
      )

      compareUserGTokens(preUserAssetState, postUserAssetState
        , [investorGvtBonus.add(toBN(1e7)), withdrawUsd.sub(investorPwrdBonus)])
      return;
    })

    it('Should be possible to withdraw all by single (large amount)', async function () {
      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)

      await controller.setBigFishThreshold(1, 1);
      await insurance.setWhaleThresholdWithdraw(9000);
      // Adjust stable coin ratio to make usdc most
      await insurance.batchSetUnderlyingTokensPercents([
        daiPercent.sub(toBN(1000)),
        usdcPercent.add(toBN(500)),
        usdtPercent.add(toBN(500)),
      ]);

      const withdrawUsd = await pwrd.getAssets(investor1);
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const bonus = withdrawUsd.mul(withdrawFee).div(percentFactor);
      const withdrawUsdWithoutFee = withdrawUsd.sub(bonus);
      const lastGvtAssets = preSystemAssetState.gvtAsset;
      const lastPwrdAssets = preSystemAssetState.pwrdAsset;
      const gvtBonus = bonus.mul(lastGvtAssets).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const pwrdBonus = bonus.mul(lastPwrdAssets.sub(withdrawUsd)).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const withdrawDAI = await buoy.singleStableFromUsd(withdrawUsdWithoutFee, 0);

      await controller.withdrawAllSinglePwrd(
        0,
        0,
        investor1
      );

      const postSystemAssetState = await getSystemInfo(controller)
      const postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(preUserAssetState)

      const allGvtBalance = await gvt.totalSupplyBase();
      const allPwrdBalance = await pwrd.totalSupplyBase();
      const investorGvtBalance = await gvt.balanceOfBase(investor1);
      const investorPwrdBalance = await pwrd.balanceOfBase(investor1);
      const investorGvtBonus = gvtBonus.mul(investorGvtBalance).div(allGvtBalance);
      const investorPwrdBonus = pwrdBonus.mul(investorPwrdBalance).div(allPwrdBalance);

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        baseNum,
        withdrawUsdWithoutFee,
        gvtBonus,
        withdrawUsd.sub(pwrdBonus),
      ]);

      compareAdapters(preSystemAssetState, postSystemAssetState, [
        withdrawDAI,
        0,
        0,
      ]);

      compareUserStableCoins(preUserAssetState, postUserAssetState,
        [withdrawDAI, 0, 0]);
      compareUserGTokens(preUserAssetState, postUserAssetState, [investorGvtBonus.add(toBN(1e8)), withdrawUsd.sub(investorPwrdBonus)]);

      return;
    })

    it('Should be possible to withdraw all balanced (small amount)', async function () {
      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor2)

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)

      await controller.setBigFishThreshold(1000, toBN(1000).mul(baseNum));

      const withdrawUsd = await pwrd.getAssets(investor2);
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const bonus = withdrawUsd.mul(withdrawFee).div(percentFactor);
      const withdrawUsdWithoutFee = withdrawUsd.sub(bonus);
      const lastGvtAssets = preSystemAssetState.gvtAsset;
      const lastPwrdAssets = preSystemAssetState.pwrdAsset;
      const gvtBonus = bonus.mul(lastGvtAssets).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const pwrdBonus = bonus.mul(lastPwrdAssets.sub(withdrawUsd)).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));

      const withdrawAmounts = await calculateAllVaultsWithdrawAmounts(
        [preSystemAssetState.daiAdapterTotalAsset, preSystemAssetState.usdcAdapterTotalAsset, preSystemAssetState.usdtAdapterTotalAsset],
        [daiBaseNum, usdcBaseNum, usdtBaseNum],
        withdrawUsdWithoutFee,
        [daiPercent, usdcPercent, usdtPercent],
        buoy);

      await controller.withdrawAllBalancedPwrd(
        0,
        investor2,
      );

      const postSystemAssetState = await getSystemInfo(controller)
      const postUserAssetState = await getUserInfo(controller, investor2)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      const allGvtBalance = await gvt.totalSupplyBase();
      const allPwrdBalance = await pwrd.totalSupplyBase();
      const investorGvtBalance = await gvt.balanceOfBase(investor2);
      const investorPwrdBalance = await pwrd.balanceOfBase(investor2);
      const investorGvtBonus = gvtBonus.mul(investorGvtBalance).div(allGvtBalance);
      const investorPwrdBonus = pwrdBonus.mul(investorPwrdBalance).div(allPwrdBalance);

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        0,
        withdrawUsdWithoutFee,
        gvtBonus,
        withdrawUsd.sub(pwrdBonus),
      ])
      compareAdapters(preSystemAssetState, postSystemAssetState, [
        withdrawAmounts[0].add(toBN(1).mul(daiBaseNum)),
        withdrawAmounts[1].add(toBN(1).mul(usdcBaseNum)),
        withdrawAmounts[2].add(toBN(1).mul(usdtBaseNum)),
      ]);

      compareUserStableCoins(preUserAssetState, postUserAssetState,
        [
          withdrawAmounts[0].add(toBN(1).mul(daiBaseNum)),
          withdrawAmounts[1].add(toBN(1).mul(usdcBaseNum)),
          withdrawAmounts[2].add(toBN(1).mul(usdtBaseNum)),
        ]
      )
      compareUserGTokens(preUserAssetState, postUserAssetState
        , [investorGvtBonus.add(toBN(1e7)), withdrawUsd.sub(investorPwrdBonus)])
      return;
    })

    it('Should be possible to withdraw all balanced (large amount)', async function () {
      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)

      await controller.setBigFishThreshold(1, 1);

      const withdrawUsd = await pwrd.getAssets(investor1);
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const bonus = withdrawUsd.mul(withdrawFee).div(percentFactor);
      const withdrawUsdWithoutFee = withdrawUsd.sub(bonus);
      const lastGvtAssets = preSystemAssetState.gvtAsset;
      const lastPwrdAssets = preSystemAssetState.pwrdAsset;
      const gvtBonus = bonus.mul(lastGvtAssets).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));
      const pwrdBonus = bonus.mul(lastPwrdAssets.sub(withdrawUsd)).div(lastGvtAssets.add(lastPwrdAssets).sub(withdrawUsd));

      const withdrawAmounts = await calculateAllVaultsWithdrawAmounts(
        [preSystemAssetState.daiAdapterTotalAsset, preSystemAssetState.usdcAdapterTotalAsset, preSystemAssetState.usdtAdapterTotalAsset],
        [daiBaseNum, usdcBaseNum, usdtBaseNum],
        withdrawUsdWithoutFee,
        [daiPercent, usdcPercent, usdtPercent],
        buoy);

      await controller.withdrawAllBalancedPwrd(
        0,
        investor1
      );

      const postSystemAssetState = await getSystemInfo(controller)
      const postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      const allGvtBalance = await gvt.totalSupplyBase();
      const allPwrdBalance = await pwrd.totalSupplyBase();
      const investorGvtBalance = await gvt.balanceOfBase(investor1);
      const investorPwrdBalance = await pwrd.balanceOfBase(investor1);
      const investorGvtBonus = gvtBonus.mul(investorGvtBalance).div(allGvtBalance);
      const investorPwrdBonus = pwrdBonus.mul(investorPwrdBalance).div(allPwrdBalance);

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        0,
        withdrawUsdWithoutFee,
        gvtBonus,
        withdrawUsd.sub(pwrdBonus),
      ])
      compareAdapters(preSystemAssetState, postSystemAssetState, [
        withdrawAmounts[0].add(daiBaseNum),
        withdrawAmounts[1].add(usdcBaseNum),
        withdrawAmounts[2].add(usdtBaseNum),
      ]);

      compareUserStableCoins(preUserAssetState, postUserAssetState,
        [
          withdrawAmounts[0].add(daiBaseNum),
          withdrawAmounts[1].add(usdcBaseNum),
          withdrawAmounts[2].add(usdtBaseNum),
        ]
      )
      compareUserGTokens(preUserAssetState, postUserAssetState
        , [investorGvtBonus.add(toBN(1e8)), withdrawUsd.sub(investorPwrdBonus)])
      return;
    })

    it.skip('Whale withdraw when loss', async function () {
      const losses = [
        toBN(1000).mul(daiBaseNum),
        toBN(1000).mul(usdcBaseNum),
        toBN(1000).mul(usdtBaseNum)
      ];
      await burnToken(DAI, DAIVaultAdaptor.address, losses[0], mainnet);
      await burnToken(USDC, USDCVaultAdaptor.address, losses[1], mainnet);
      await burnToken(USDT, USDTVaultAdaptor.address, losses[2], mainnet);

      let preSystemAssetState = await getSystemInfo(controller)
      let preUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)
      expect(await pnl.totalAssetsChangeTrigger()).equal(true);

      const lossesUsd = await buoy.stableToUsd(losses, true);
      const investor1GvtLoss = await userPnL(lossesUsd, gvt, investor1);
      const withdrawUsd = await pwrd.getAssets(investor1);
      let withdrawFee = await withdrawHandler.withdrawalFee(true);
      const withdrawUsdWithoutFee = withdrawUsd.sub(withdrawUsd.mul(withdrawFee).div(percentFactor));
      let withdrawAmounts = await calculateAllVaultsWithdrawAmounts(
        [preSystemAssetState.daiAdapterTotalAsset, preSystemAssetState.usdcAdapterTotalAsset, preSystemAssetState.usdtAdapterTotalAsset],
        [daiBaseNum, usdcBaseNum, usdtBaseNum],
        withdrawUsdWithoutFee,
        [daiPercent, usdcPercent, usdtPercent],
        buoy);

      await controller.withdrawAllBalancedPwrd(
        0,
        investor1
      );

      // withdrawFee = toBN(300).mul(baseNum).mul(toBN(4)).div(percentFactor)
      postSystemAssetState = await getSystemInfo(controller)
      postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      expect(await pnl.pnlTrigger()).equal(false);

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        0,
        withdrawUsdWithoutFee,
        lossesUsd.add(toBN(1).mul(baseNum)),
        withdrawUsd.add(toBN(1).mul(baseNum))
      ])
      compareAdapters(preSystemAssetState, postSystemAssetState, [
        withdrawAmounts[0].add(baseNum),
        withdrawAmounts[1],
        withdrawAmounts[2],
      ]);

      compareUserStableCoins(preUserAssetState, postUserAssetState,
        [
          withdrawAmounts[0].add(baseNum),
          withdrawAmounts[1],
          withdrawAmounts[2],
        ]
      )
      compareUserGTokens(preUserAssetState, postUserAssetState
        , [investor1GvtLoss.add(baseNum), withdrawUsd])

      await lifeguard.investToCurveVault()

      const deposit1 = [
        toBN(10000).mul(daiBaseNum),
        toBN(10000).mul(usdcBaseNum),
        toBN(10000).mul(usdtBaseNum),
      ]
      await controller.depositGvt(
        deposit1,
        investor2,
      )
      preSystemAssetState = await getSystemInfo(controller);
      preUserAssetState = await getUserInfo(controller, investor1);
      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)

      const amountUsd = await gvt.getAssets(investor1);
      withdrawFee = await withdrawHandler.withdrawalFee(true);
      const amountUsdWithoutFee = amountUsd.sub(amountUsd.mul(withdrawFee).div(percentFactor));
      withdrawAmounts = await calculateAllVaultsWithdrawAmounts(
        [preSystemAssetState.daiAdapterTotalAsset, preSystemAssetState.usdcAdapterTotalAsset, preSystemAssetState.usdtAdapterTotalAsset],
        [daiBaseNum, usdcBaseNum, usdtBaseNum],
        amountUsdWithoutFee,
        [daiPercent, usdcPercent, usdtPercent],
        buoy);

      await controller.withdrawAllBalancedGvt(
        0,
        investor1
      );

      postSystemAssetState = await getSystemInfo(controller)
      postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        0,
        amountUsdWithoutFee,
        amountUsd,
        0,
        toBN(1e8), 0
      ])
      compareAdapters(preSystemAssetState, postSystemAssetState, [
        withdrawAmounts[0].add(daiBaseNum),
        withdrawAmounts[1],
        withdrawAmounts[2],
      ]);

      compareUserStableCoins(preUserAssetState, postUserAssetState,
        [
          withdrawAmounts[0].add(daiBaseNum),
          withdrawAmounts[1],
          withdrawAmounts[2],
        ]
      )
      compareUserGTokens(preUserAssetState, postUserAssetState
        , [amountUsd, 0])

      return;
    })

    it.skip('Whale withdraw when gain and performance in (0, 100)', async function () {
      await DAIVaultAdaptor.invest();
      // console.log(await DAIVaultAdaptor.strategyHarvestTrigger(0, '10000000'));
      const profits = [
        toBN(10000).mul(daiBaseNum),
        0,
        0
      ]

      // console.log('dai vault total: ' + await DAIVaultAdaptor.totalAssets());
      await mintToken(DAI, mockDAIAlphaStrategy.address, profits[0], mainnet);
      await mintToken(DAI, mockDAIBetaStrategy.address, profits[0], mainnet);
      // console.log('dai vault total: ' + await DAIVaultAdaptor.totalAssets());

      const tvl = await pnl.calcPnL();

      // console.log(tvl[0].toString(), tvl[1].toString())
      // console.log(await DAIVaultAdaptor.strategyHarvestTrigger(0, '10000000'));

      await DAIVaultAdaptor.strategyHarvest(0);

      // console.log(tvl[0].toString(), tvl[1].toString())
      // console.log('dai vault total: ' + await DAIVaultAdaptor.totalAssets());
      let preSystemAssetState = await getSystemInfo(controller)
      let preUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)


      await insurance.setWhaleThresholdDeposit(1);
      await pnl.setPerformanceFee(2000);

      const profitsUsd = await lifeguard.buoy.stableToUsd(profits, true);
      const performanceFee = await pnl.performanceFee();
      const feeProfit = profitsUsd.mul(performanceFee).div(percentFactor);

      let amountUsd = await pwrd.getAssets(investor1);

      const distResult = distributeProfit(profitsUsd.sub(feeProfit), preSystemAssetState.gvtAsset, preSystemAssetState.pwrdAsset);
      const investor1GvtPost = await userPnL(distResult[2], gvt, investor1);
      const investor1PwrdPost = await userPnL(distResult[3], pwrd, investor1);

      amountUsd = amountUsd.add(investor1PwrdPost);
      let withdrawFee = await withdrawHandler.withdrawalFee(true);
      let amountUsdWithoutFee = amountUsd.sub(amountUsd.mul(withdrawFee).div(percentFactor));

      let withdrawAmounts = await calculateAllVaultsWithdrawAmounts(
        [preSystemAssetState.daiAdapterTotalAsset, preSystemAssetState.usdcAdapterTotalAsset, preSystemAssetState.usdtAdapterTotalAsset],
        [daiBaseNum, usdcBaseNum, usdtBaseNum],
        amountUsdWithoutFee,
        [daiPercent, usdcPercent, usdtPercent],
        buoy);

      await controller.withdrawAllBalancedPwrd(
        0,
        investor1
      );

      let postSystemAssetState = await getSystemInfo(controller)
      let postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      const rewardGvt = await gvt.getAssets(reward);

      // expect(await pnl.pnlTrigger()).equal(false);
      // expect(rewardGvt).to.be.a.bignumber.closeTo(feeProfit, baseNum);

      // compareSystemInfo(preSystemAssetState, postSystemAssetState, [
      //   0,
      //   amountUsdWithoutFee,
      //   distResult[2].add(feeProfit),
      //   amountUsd, // this difference is origin amountUsd-investor2PwrdPost actually
      // ])
      // compareAdapters(preSystemAssetState, postSystemAssetState, [
      //   withdrawAmounts[0].add(daiBaseNum), withdrawAmounts[1], withdrawAmounts[2]
      // ]);

      // compareUserStableCoins(preUserAssetState, postUserAssetState,
      //   [
      //     withdrawAmounts[0].add(daiBaseNum),
      //     withdrawAmounts[1],
      //     withdrawAmounts[2],
      //   ]
      // )
      // compareUserGTokens(preUserAssetState, postUserAssetState
      //   , [investor1GvtPost, amountUsd])

      const deposit1 = [
        toBN(10000).mul(daiBaseNum),
        toBN(10000).mul(usdcBaseNum),
        toBN(10000).mul(usdtBaseNum),
      ]
      await controller.depositGvt(
        deposit1,
        investor2,
      )

      await lifeguard.investToCurveVault()

      // preSystemAssetState = await getSystemInfo(controller);
      // preUserAssetState = await getUserInfo(controller, investor1);

      // // // printSystemInfo(preSystemAssetState)
      // // // printUserInfo(preUserAssetState)

      // amountUsd = await gvt.getAssets(investor1);
      // withdrawFee = await withdrawHandler.withdrawalFee(true);
      // amountUsdWithoutFee = amountUsd.sub(amountUsd.mul(withdrawFee).div(percentFactor));
      // withdrawAmounts = await calculateAllVaultsWithdrawAmounts(
      //   [preSystemAssetState.daiAdapterTotalAsset, preSystemAssetState.usdcAdapterTotalAsset, preSystemAssetState.usdtAdapterTotalAsset],
      //   [daiBaseNum, usdcBaseNum, usdtBaseNum],
      //   amountUsdWithoutFee,
      //   [daiPercent, usdcPercent, usdtPercent],
      //   buoy);

      await controller.withdrawAllBalancedGvt(
        0,
        investor1
      );

      postSystemAssetState = await getSystemInfo(controller)
      postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      // expect(await pnl.pnlTrigger()).equal(false);

      // compareSystemInfo(preSystemAssetState, postSystemAssetState, [
      //   0,
      //   amountUsdWithoutFee,
      //   amountUsd,
      //   0,
      //   toBN(1e8), 0
      // ])
      // compareAdapters(preSystemAssetState, postSystemAssetState, [
      //   withdrawAmounts[0].add(toBN(1).mul(baseNum)),
      //   withdrawAmounts[1],
      //   withdrawAmounts[2],
      // ]);

      // compareUserStableCoins(preUserAssetState, postUserAssetState,
      //   [
      //     withdrawAmounts[0].add(toBN(1).mul(baseNum)),
      //     withdrawAmounts[1],
      //     withdrawAmounts[2],
      //   ]
      // )
      // compareUserGTokens(preUserAssetState, postUserAssetState
      //   , [amountUsd, 0])

      return;
    })

    it.skip('Whale withdraw with gain and performance = 0', async function () {
      const profits = [
        toBN(1000).mul(daiBaseNum),
        toBN(1000).mul(usdcBaseNum),
        toBN(1000).mul(usdtBaseNum),
      ]
      await mintToken(DAI, DAIVaultAdaptor.address, profits[0], mainnet);
      await mintToken(USDC, USDCVaultAdaptor.address, profits[1], mainnet);
      await mintToken(USDT, USDTVaultAdaptor.address, profits[2], mainnet);

      let preSystemAssetState = await getSystemInfo(controller)
      let preUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)
      expect(await pnl.pnlTrigger()).equal(true);

      await insurance.setWhaleThresholdDeposit(1);
      await pnl.setPerformanceFee(0);

      const profitsUsd = await lifeguard.buoy.stableToUsd(profits, true);
      const performanceFee = await pnl.performanceFee();

      let amountUsd = await pwrd.getAssets(investor1);

      const distResult = distributeProfit(profitsUsd, preSystemAssetState.gvtAsset, preSystemAssetState.pwrdAsset);
      const investor1GvtPost = await userPnL(distResult[2], gvt, investor1);
      const investor1PwrdPost = await userPnL(distResult[3], pwrd, investor1);

      amountUsd = amountUsd.add(investor1PwrdPost);
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const amountUsdWithoutFee = amountUsd.sub(amountUsd.mul(withdrawFee).div(percentFactor));

      const withdrawAmounts = await calculateAllVaultsWithdrawAmounts(
        [preSystemAssetState.daiAdapterTotalAsset, preSystemAssetState.usdcAdapterTotalAsset, preSystemAssetState.usdtAdapterTotalAsset],
        [daiBaseNum, usdcBaseNum, usdtBaseNum],
        amountUsdWithoutFee,
        [daiPercent, usdcPercent, usdtPercent],
        buoy);

      await controller.withdrawAllBalancedPwrd(
        0,
        investor1
      );

      // withdrawFee = toBN(300).mul(baseNum).mul(toBN(4)).div(percentFactor)
      let postSystemAssetState = await getSystemInfo(controller)
      let postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      const rewardGvt = await gvt.getAssets(reward);

      expect(await pnl.pnlTrigger()).equal(false);
      expect(rewardGvt).to.be.a.bignumber.equal(toBN(0));

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        0,
        amountUsdWithoutFee,
        distResult[2],
        amountUsd, // this difference is origin amountUsd-investor2PwrdPost actually
      ])
      compareAdapters(preSystemAssetState, postSystemAssetState, [
        withdrawAmounts[0].add(daiBaseNum), withdrawAmounts[1], withdrawAmounts[2]
      ]);

      compareUserStableCoins(preUserAssetState, postUserAssetState,
        [
          withdrawAmounts[0].add(daiBaseNum),
          withdrawAmounts[1].add(usdcBaseNum),
          withdrawAmounts[2].add(usdtBaseNum),
        ]
      )
      compareUserGTokens(preUserAssetState, postUserAssetState
        , [investor1GvtPost, amountUsd])
      return;
    })

    it.skip('Whale withdraw with gain and performance = 0 and pwrd rebase false', async function () {
      const profits = [
        toBN(1000).mul(daiBaseNum),
        toBN(1000).mul(usdcBaseNum),
        toBN(1000).mul(usdtBaseNum),
      ]
      await mintToken(DAI, DAIVaultAdaptor.address, profits[0], mainnet);
      await mintToken(USDC, USDCVaultAdaptor.address, profits[1], mainnet);
      await mintToken(USDT, USDTVaultAdaptor.address, profits[2], mainnet);

      await pnl.setRebase(false);
      let preSystemAssetState = await getSystemInfo(controller)
      let preUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)
      expect(await pnl.pnlTrigger()).equal(true);

      // await insurance.setWhaleThresholdDeposit(1);
      await pnl.setPerformanceFee(0);

      const profitsUsd = await lifeguard.buoy.stableToUsd(profits, true);
      const performanceFee = await pnl.performanceFee();
      const investor1GvtPost = await userPnL(profitsUsd, gvt, investor1);

      const amountUsd = await pwrd.getAssets(investor1);
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const amountUsdWithoutFee = amountUsd.sub(amountUsd.mul(withdrawFee).div(percentFactor));

      const withdrawAmounts = await calculateAllVaultsWithdrawAmounts(
        [preSystemAssetState.daiAdapterTotalAsset, preSystemAssetState.usdcAdapterTotalAsset, preSystemAssetState.usdtAdapterTotalAsset],
        [daiBaseNum, usdcBaseNum, usdtBaseNum],
        amountUsdWithoutFee,
        [daiPercent, usdcPercent, usdtPercent],
        buoy);

      await controller.withdrawAllBalancedPwrd(
        0,
        investor1
      );

      // withdrawFee = toBN(300).mul(baseNum).mul(toBN(4)).div(percentFactor)
      let postSystemAssetState = await getSystemInfo(controller)
      let postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      expect(preSystemAssetState.pwrdFactor.sub(postSystemAssetState.pwrdFactor))
        .to.be.a.bignumber.equal(toBN(0));
      // expect(preSystemAssetState.gvtFactor.sub(postSystemAssetState.gvtFactor))
      //   .to.be.a.bignumber.lt(toBN(0));

      expect(preSystemAssetState.pwrdFactor.sub(postSystemAssetState.pwrdFactor))
        .to.be.a.bignumber.equal(toBN(0));

      const rewardGvt = await gvt.getAssets(reward);

      expect(await pnl.pnlTrigger()).equal(false);
      expect(rewardGvt).to.be.a.bignumber.equal(toBN(0));

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        0,
        amountUsdWithoutFee,
        profitsUsd,
        amountUsd, // this difference is original amountUsd-investor2PwrdPost actually
      ])
      compareAdapters(preSystemAssetState, postSystemAssetState, [
        withdrawAmounts[0].add(daiBaseNum),
        withdrawAmounts[1].add(usdcBaseNum),
        withdrawAmounts[2].add(usdtBaseNum)
      ]);

      compareUserStableCoins(preUserAssetState, postUserAssetState,
        [
          withdrawAmounts[0].add(daiBaseNum),
          withdrawAmounts[1].add(usdcBaseNum),
          withdrawAmounts[2].add(usdtBaseNum),
        ]
      )
      compareUserGTokens(preUserAssetState, postUserAssetState
        , [investor1GvtPost, amountUsd])

      return;
    })

    it.skip('Whale withdraw with gain and performance = 100', async function () {
      const profits = [
        toBN(1000).mul(daiBaseNum),
        toBN(1000).mul(usdcBaseNum),
        toBN(1000).mul(usdtBaseNum),
      ]
      await mintToken(DAI, DAIVaultAdaptor.address, profits[0], mainnet);
      await mintToken(USDC, USDCVaultAdaptor.address, profits[1], mainnet);
      await mintToken(USDT, USDTVaultAdaptor.address, profits[2], mainnet);

      let preSystemAssetState = await getSystemInfo(controller)
      let preUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)
      expect(await pnl.pnlTrigger()).equal(true);

      await insurance.setWhaleThresholdDeposit(1);
      await pnl.setPerformanceFee(10000);

      const profitsUsd = await lifeguard.buoy.stableToUsd(profits, true);

      const amountUsd = await pwrd.getAssets(investor1);
      const withdrawFee = await withdrawHandler.withdrawalFee(true);
      const amountUsdWithoutFee = amountUsd.sub(amountUsd.mul(withdrawFee).div(percentFactor));

      const withdrawAmounts = await calculateAllVaultsWithdrawAmounts(
        [preSystemAssetState.daiAdapterTotalAsset, preSystemAssetState.usdcAdapterTotalAsset, preSystemAssetState.usdtAdapterTotalAsset],
        [daiBaseNum, usdcBaseNum, usdtBaseNum],
        amountUsdWithoutFee,
        [daiPercent, usdcPercent, usdtPercent],
        buoy);

      await controller.withdrawAllBalancedPwrd(
        0,
        investor1
      );

      // withdrawFee = toBN(300).mul(baseNum).mul(toBN(4)).div(percentFactor)
      let postSystemAssetState = await getSystemInfo(controller)
      let postUserAssetState = await getUserInfo(controller, investor1)

      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      const rewardGvt = await gvt.getAssets(reward);

      expect(await pnl.pnlTrigger()).equal(false);
      expect(rewardGvt).to.be.a.bignumber.closeTo(profitsUsd, baseNum.div(toBN(1000)));

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        0,
        amountUsdWithoutFee,
        profitsUsd,
        amountUsd.add(toBN(1).mul(baseNum))
      ])
      compareAdapters(preSystemAssetState, postSystemAssetState, [
        withdrawAmounts[0].add(daiBaseNum),
        withdrawAmounts[1].add(usdcBaseNum),
        withdrawAmounts[2].add(usdtBaseNum),
      ]);

      compareUserStableCoins(preUserAssetState, postUserAssetState, [
        withdrawAmounts[0].add(daiBaseNum),
        withdrawAmounts[1].add(usdcBaseNum),
        withdrawAmounts[2].add(usdtBaseNum),
      ])
      compareUserGTokens(preUserAssetState, postUserAssetState
        , [baseNum, amountUsd])
      return;
    })

    it('Should be possible to withdraw more single coin than is available in the stablecoin vaults', async function () {
      let preSystemAssetState = await getSystemInfo(controller)
      let preUserAssetState = await getUserInfo(controller, investor1)
      await controller.withdrawAllBalancedPwrd(
        0,
        investor1
      );
      await controller.withdrawAllBalancedPwrd(
        0,
        investor2
      );
      // withdrawFee = toBN(300).mul(baseNum).mul(toBN(4)).div(percentFactor)
      postSystemAssetState = await getSystemInfo(controller)
      postUserAssetState = await getUserInfo(controller, investor1)
      await lifeguard.investToCurveVault()
      preSystemAssetState = await getSystemInfo(controller);
      preUserAssetState = await getUserInfo(controller, investor1);
      // console.log('********** withdraw all gvt when loss post **********')
      // // printSystemInfo(preSystemAssetState)
      // // printUserInfo(preUserAssetState)
      // console.log('********** withdraw all gvt when loss post **********')
      const userUsd = await gvt.getAssets(investor1);
      // console.log(userUsd.toString())
      await controller.withdrawAllSingleGvt(
        1,
        0,
        investor1
      );
      postSystemAssetState = await getSystemInfo(controller)
      postUserAssetState = await getUserInfo(controller, investor1)
      // // printSystemInfo(postSystemAssetState)
      // // printUserInfo(postUserAssetState)

      return;
    })
  })

  describe('Emergency states', function () {

        it('Should give correct PnL after recovery', async function () {
            // await DAI.mint(mockDAIAlphaStrategy.address, toBN(100).mul(daiBaseNum));
            await mintToken(DAI, mockDAIAlphaStrategy.address, toBN(100).mul(daiBaseNum), mainnet);
            await DAIVaultAdaptor.strategyHarvest(0);
            const prePnL = await pnl.calcPnL();
            let preSystemAssetState = await getSystemInfo(controller)
            // // printSystemInfo(preSystemAssetState)
            await controller.pause({ from: governance });
            await controller.emergency(0, { from: governance });
            await expect(controller.emergencyState()).to.eventually.be.true;
            const midPnL = await pnl.calcPnL();
            await controller.restart([daiPercent, usdcPercent, usdtPercent], { from: governance });
            const postPnL = await pnl.calcPnL();
            await expect(controller.emergencyState()).to.eventually.be.false;
            await expect(postPnL[0]).to.be.bignumber.closeTo(prePnL[0], toBN(1E18))
            return expect(postPnL[1]).to.be.bignumber.equal(prePnL[1])
        });

        it('Should calculate pnl correctly when entering emergency after a stable coin has failed', async function () {
            const prePnL = await pnl.calcPnL();
            await controller.pause({ from: governance });
            await controller.emergency(0, { from: governance });
            const postPnL = await pnl.calcPnL();
            return expect(postPnL[0]).to.be.bignumber.lessThan(prePnL[0])
        });

        it('Should calculate pnl correctly when entering emergencyi when no stblecoin has failed', async function () {
            const prePnL = await pnl.calcPnL();
            await controller.pause({ from: governance });
            await controller.emergency(0, { from: governance });
            const postPnLSingleFailure = await pnl.calcPnL();
            await controller.restart([daiPercent, usdcPercent, usdtPercent], { from: governance });
            const postPnLRecovery = await pnl.calcPnL();
            await expect(postPnLRecovery[0]).to.be.bignumber.closeTo(prePnL[0], toBN(1E18))
            await expect(postPnLRecovery[1]).to.be.bignumber.equal(prePnL[1])
            await controller.pause({ from: governance });
            await controller.emergency(3, { from: governance });
            const postPnLNoFailure = await pnl.calcPnL();
            await expect(postPnLNoFailure[1]).to.be.bignumber.equal(prePnL[1])
            return expect(postPnLNoFailure[0]).to.be.bignumber.greaterThan(postPnLSingleFailure[0])
        });

    beforeEach('Inject initial assets into the system', async function () {
      await insurance.setWhaleThresholdDeposit(2000);
      await insurance.setWhaleThresholdWithdraw(2000);
      await controller.setBigFishThreshold(1000, toBN(200).mul(daiBaseNum));

      const deposit0 = [
        toBN(50).mul(daiBaseNum),
        toBN(50).mul(usdcBaseNum),
        toBN(50).mul(usdtBaseNum),
      ]

      await controller.depositGvt(
        deposit0,
        investor1,
      )

      await controller.depositGvt(
        deposit0,
        investor1,
      )

      await insurance.setCurveVaultPercent(1000);
      const deposit1 = [
        toBN(30000).mul(daiBaseNum),
        toBN(30000).mul(usdcBaseNum),
        toBN(30000).mul(usdtBaseNum),
      ]

      const deposit2 = [
        toBN(20000).mul(daiBaseNum),
        toBN(20000).mul(usdcBaseNum),
        toBN(20000).mul(usdtBaseNum),
      ]

      await controller.depositGvt(
        deposit1,
        investor1,
      )

      await controller.depositPwrd(
        deposit2,
        investor1,
      )

      // await harvestStratgies(controller);
      // Check whether the initial state is correct
      const deposit3 = [
        toBN(120).mul(daiBaseNum),
        toBN(120).mul(usdcBaseNum),
        toBN(120).mul(usdtBaseNum),
      ]
      const deposit4 = [
        toBN(100).mul(daiBaseNum),
        toBN(100).mul(usdcBaseNum),
        toBN(100).mul(usdtBaseNum),
      ]
      await controller.depositGvt(
        deposit3,
        investor2,
      )
      await controller.depositPwrd(
        deposit4,
        investor2,
      )
    })

    it('Should give correct PnL after emergency', async function () {
      const prePnL = await pnl.calcPnL();
      let preSystemAssetState = await getSystemInfo(controller)
      // // printSystemInfo(preSystemAssetState)
      await controller.pause({ from: governance });
      await controller.emergency(0, { from: governance });
      const postPnL = await pnl.calcPnL();
      return expect(postPnL[0]).to.be.bignumber.lessThan(prePnL[0])
    });

    it('Should give correct PnL after recovery', async function () {
      // await DAI.mint(mockDAIAlphaStrategy.address, toBN(100).mul(daiBaseNum));
      await mintToken(DAI, mockDAIAlphaStrategy.address, toBN(100).mul(daiBaseNum), mainnet);
      await DAIVaultAdaptor.strategyHarvest(0);

      const prePnL = await pnl.calcPnL();
      // console.log('prePnL[0]: ' + prePnL[0]);
      // console.log('prePnL[1]: ' + prePnL[1]);
      let preSystemAssetState = await getSystemInfo(controller)
      // // printSystemInfo(preSystemAssetState)
      await controller.pause({ from: governance });
      await controller.emergency(0, { from: governance });
      await expect(controller.emergencyState()).to.eventually.be.true;
      const midPnL = await pnl.calcPnL();
      // console.log('midPnL[0]: ' + midPnL[0]);
      // console.log('midPnL[1]: ' + midPnL[1]);
      await controller.restart([daiPercent, usdcPercent, usdtPercent], { from: governance });
      const postPnL = await pnl.calcPnL();
      // console.log('postPnL[0]: ' + postPnL[0]);
      // console.log('postPnL[1]: ' + postPnL[1]);
      await expect(controller.emergencyState()).to.eventually.be.false;
      await expect(postPnL[0]).to.be.bignumber.closeTo(prePnL[0], toBN(1E18))
      return expect(postPnL[1]).to.be.bignumber.equal(prePnL[1], toBN(1E18))
    });

    it('Should be possible to withdraw when the system is paused', async () => {
      await controller.pause({ from: governance });
      return expect(controller.withdrawAllBalancedPwrd(
        0,
        investor2
      )).to.eventually.be.fulfilled;
    })

    it('Should be possible to withdraw when the system is paused', async () => {
      await controller.pause({ from: governance });

      // Exceeds utilisation limit
      await expect(controller.withdrawAllBalancedGvt(
        0,
        investor1
      )).to.eventually.be.rejected;

      // All good to withdraw below utilsation limit
      return expect(controller.withdrawAllBalancedGvt(
        0,
        investor2
      )).to.eventually.be.fulfilled;
    })

    it('Should be possible to withdraw when the system is in an emergency state', async () => {
      await controller.pause({ from: governance });
      await controller.emergency(0, { from: governance });

      const userGvtPre = await gvt.balanceOf(investor1);
      const userUSDTPre = await USDT.balanceOf(investor1);

      const usd = toBN(10000).mul(baseNum);

      await controller.withdrawByStablecoinGvt(
        1,
        usd,
        investor1,
        toBN(3), // Check why this slippage is high
        toBN(1000),
        true,
      )

      const userUSDTPost = await USDT.balanceOf(investor1);
      const userGvtPost = await gvt.balanceOf(investor1);

      await expect(userGvtPre).to.be.a.bignumber.greaterThan('0');
      await expect(userGvtPost).to.be.a.bignumber.lessThan(userGvtPre);
      return expect(userUSDTPost.sub(userUSDTPre)).to.be.a.bignumber.closeTo(toBN('9950')
        .mul(usdtBaseNum), toBN(30).mul(usdtBaseNum));
    })

    it('Should fail withdrawals when the withdrawal break the utilisation limit', async () => {
      await controller.pause({ from: governance });
      await controller.emergency(0, { from: governance });
      await controller.setBigFishThreshold(1, 0);

      const userUSDTPre = await USDT.balanceOf(investor1);
      const userGvtPre = await gvt.balanceOf(investor1);

      const usd = toBN(300).mul(baseNum);

      return expect(controller.withdrawAllSingleGvt(
        0,
        0,
        investor1,
      )).to.eventually.be.rejected;
    });

    it('Should be ok to do a whale withdrawal when the system is in an emergency state', async () => {
      await controller.pause({ from: governance });
      await controller.emergency(0, { from: governance });
      await controller.setBigFishThreshold(1, 0);

      const userUSDTPre = await USDT.balanceOf(investor2);
      const userGvtPre = await gvt.balanceOf(investor2);

      await controller.withdrawAllSingleGvt(
        1,
        0,
        investor2,
        toBN(5),
      )

      const userUSDTPost = await USDT.balanceOf(investor2);
      const userGvtPost = await gvt.balanceOf(investor2);

      await expect(userGvtPre).to.be.a.bignumber.greaterThan('0');
      return expect(userGvtPost).to.be.a.bignumber.equal('0');
      return expect(userUSDTPost.sub(userUSDTPre)).to.be.a.bignumber.greaterThan(toBN(0));
    });

    it('Should be ok to do a whale withdrawal when the system is in an emergency state', async () => {
      await controller.pause({ from: governance });
      await controller.emergency(0, { from: governance });

      const userUSDTPre = await USDT.balanceOf(investor1);
      const userPwrdPre = await pwrd.balanceOf(investor1);

      await controller.withdrawAllSinglePwrd(
        1,
        0,
        investor1,
        toBN(5),
      )

      const userUSDTPost = await USDT.balanceOf(investor1);
      const userPwrdPost = await pwrd.balanceOf(investor1);

      await expect(userPwrdPre).to.be.a.bignumber.greaterThan('0');
      await expect(userPwrdPost).to.be.a.bignumber.lessThan(userPwrdPre);
      return expect(userUSDTPost.sub(userUSDTPre)).to.be.a.bignumber.greaterThan(toBN(0));
    })

    // will pass once PROT-1045 is merged in
    it.skip('Should be possible to perform a normal withdrawal after recovering from an emergency state', async () => {
      let preSystemAssetState = await getSystemInfo(controller)
      // // printSystemInfo(preSystemAssetState)
      await controller.pause({ from: governance });
      await controller.emergency(0, { from: governance });
      await controller.restart([daiPercent, usdcPercent, usdtPercent], { from: governance });
      await lifeguard.investToCurveVault()
      const userUSDTPre = await USDT.balanceOf(investor1);
      const userPwrdPre = await pwrd.balanceOf(investor1);

      await controller.withdrawAllSinglePwrd(
        1,
        0,
        investor1
      )

      await controller.withdrawAllBalancedPwrd(
        0,
        investor2
      )

      await controller.withdrawAllSingleGvt(
        0,
        0,
        investor1
      )

      const userUSDTPost = await USDT.balanceOf(investor1);
      const userPwrdPost = await pwrd.balanceOf(investor1);
      const userGvtPost = await gvt.balanceOf(investor1);

      await expect(userPwrdPre).to.be.a.bignumber.greaterThan('0');
      await expect(userPwrdPost).to.be.a.bignumber.lessThan(userPwrdPre);
      await expect(userGvtPost).to.be.a.bignumber.lessThan(userGvtPre);
      return expect(userUSDTPost.sub(userUSDTPre)).to.be.a.bignumber.greaterThan(toBN(0));
    })
  })
})
