const { newController } = require('../utils/factory/controller')
const { BN, toBN } = require('web3-utils')
const {
  expect,
} = require('../utils/common-utils')
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
  lifeguard, buoy;

contract('Small & Whale deposit', function (accounts) {
  const deployer = accounts[0],
    governance = deployer,
    investor1 = accounts[1],
    investor2 = accounts[2],
    reward = accounts[9]

  beforeEach('Initialize the system contracts', async function () {
    // console.log('mainnet' + mainnet);
    controller = await newController(mainnet)
      ;[DAI, USDC, USDT] = controller.underlyingTokens
    gvt = controller.gvt
    pwrd = controller.pwrd
    pnl = controller.pnl
    lifeguard = controller.lifeguard
    buoy = lifeguard.buoy;
    insurance = controller.insurance
    exposure = insurance.exposure
    allocation = insurance.allocation;
    [DAIVaultAdaptor, USDCVaultAdaptor, USDTVaultAdaptor] = controller.vaults;

    await insurance.batchSetUnderlyingTokensPercents([
      daiPercent,
      usdcPercent,
      usdtPercent,
    ])

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

    // printSystemInfo(postSystemAssetState)
    // printUserInfo(postUserAssetState)
  })

  describe('revert', function () {
    it('should revert when invest PWRD > GVT', function () {
      const investment = [new BN(5000000).mul(daiBaseNum), 0, 0];
      return expect(controller.depositPwrd(investment, investor1)).to.eventually.be.rejected;
    });

    // this test only works on fork
    it.skip('should revert when safety check false', async function () {
      const pool = lifeguard.pool;
      // console.log(pool.address);

      console.log('health ' + await buoy.safetyCheck())
      await setBalance('dai', deployer, '100000000');
      const largeAmount = toBN('100000000').mul(toBN(1E18));
      await DAI.approve(pool.address, largeAmount);
      await pool.add_liquidity([largeAmount, 0, 0], 0);

      return expect(controller.depositGvt([new BN(1000).mul(daiBaseNum), 0, 0], investor1)).to.eventually.be.rejectedWith(
        '!safetyCheck');
    })
  })

  describe('ok', function () {

    it.skip('gvt deposit for gas cost', async function () {
      // first deposit not trigger invest
      const investAmounts1 = [
        toBN(200).mul(daiBaseNum),
        toBN(300).mul(usdcBaseNum),
        toBN(500).mul(usdtBaseNum),
      ]
      await controller.depositGvt(investAmounts1, investor2)
    })

    it('sardine deposit', async function () {
      await controller.setBigFishThreshold(1000, 100);

      let preSystemAssetState = await getSystemInfo(controller)
      let preUserAssetState = await getUserInfo(controller, investor1)

      // printSystemInfo(preSystemAssetState)
      // printUserInfo(preUserAssetState)

      const depositUsdc = toBN(100).mul(usdcBaseNum);
      const smallDeposit1 = [
        toBN(0).mul(daiBaseNum),
        depositUsdc,
        toBN(0).mul(usdtBaseNum),
      ]
      const depositUsd = await buoy.stableToUsd(smallDeposit1, true);

      await controller.depositGvt(
        smallDeposit1,
        investor1,
      )
      let postSystemAssetState = await getSystemInfo(controller)
      let postUserAssetState = await getUserInfo(controller, investor1)

      // printSystemInfo(postSystemAssetState)
      // printUserInfo(postUserAssetState)

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        0,
        depositUsd.add(baseNum),
        depositUsd.add(baseNum), 0,
        0, 0,
      ]);
      compareAdapters(preSystemAssetState, postSystemAssetState, [0, depositUsdc, 0]);

      compareUserStableCoins(
        preUserAssetState,
        postUserAssetState,
        [0, depositUsdc, 0]
      )
      compareUserGTokens(preUserAssetState, postUserAssetState, [depositUsd.add(toBN(100)), 0])
    })

    it('tuna deposit', async function () {
      await controller.setBigFishThreshold(1, 1);
      await insurance.setWhaleThresholdDeposit(5000);
      // Adjust stable coin ratio to make usdt least
      await insurance.batchSetUnderlyingTokensPercents([
        daiPercent.sub(toBN(500)),
        usdcPercent.sub(toBN(100)),
        usdtPercent.add(toBN(600)),
      ]);

      preSystemAssetState = await getSystemInfo(controller)
      preUserAssetState = await getUserInfo(controller, investor1)

      // printSystemInfo(preSystemAssetState)
      // printUserInfo(preUserAssetState)

      const depositDai = toBN(500).mul(daiBaseNum);
      const depositUsdc = toBN(500).mul(usdcBaseNum);
      const depositUsdt = toBN(500).mul(usdtBaseNum);
      const tunaDeposit = [
        depositDai,
        depositUsdc,
        depositUsdt,
      ]
      const depositUsd = await buoy.stableToUsd(tunaDeposit, true);
      const skimPercent = await controller.getSkimPercent();
      const skimUsd = depositUsd.mul(skimPercent).div(percentFactor);
      const daiUsd = await buoy.singleStableToUsd(depositDai, 0);
      const usdtFromDai = await buoy.singleStableFromUsd(daiUsd, 2);
      const usdtAmount = depositUsdt.add(usdtFromDai);

      await controller.depositGvt(
        tunaDeposit,
        investor1,
      )

      postSystemAssetState = await getSystemInfo(controller)
      postUserAssetState = await getUserInfo(controller, investor1)

      // printSystemInfo(postSystemAssetState)
      // printUserInfo(postUserAssetState)

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        skimUsd,
        depositUsd.add(baseNum),
        depositUsd.add(baseNum), 0,
        0, 0,
      ]);
      compareAdapters(preSystemAssetState, postSystemAssetState,
        [
          0,
          depositUsdc.sub(depositUsdc.mul(skimPercent).div(percentFactor)),
          usdtAmount.sub(usdtAmount.mul(skimPercent).div(percentFactor)),
        ]);

      compareUserStableCoins(
        preUserAssetState,
        postUserAssetState,
        tunaDeposit
      );
      compareUserGTokens(preUserAssetState, postUserAssetState, [depositUsd, 0]);
    })

    it('whale deposit', async function () {
      await controller.setBigFishThreshold(100, 100);
      await insurance.setWhaleThresholdDeposit(100);

      preSystemAssetState = await getSystemInfo(controller)
      preUserAssetState = await getUserInfo(controller, investor1)

      // printSystemInfo(preSystemAssetState)
      // printUserInfo(preUserAssetState)

      const depositDai = toBN(1000).mul(daiBaseNum);
      const depositUsdc = toBN(1000).mul(usdcBaseNum);
      const depositUsdt = toBN(1000).mul(usdtBaseNum);
      const whaleDeposit = [
        depositDai,
        depositUsdc,
        depositUsdt,
      ]
      const depositUsd = await buoy.stableToUsd(whaleDeposit, true);
      const skimPercent = await controller.getSkimPercent();
      const skimUsd = depositUsd.mul(skimPercent).div(percentFactor);

      await controller.depositPwrd(
        whaleDeposit,
        investor1,
      )

      postSystemAssetState = await getSystemInfo(controller)
      postUserAssetState = await getUserInfo(controller, investor1)

      // printSystemInfo(postSystemAssetState)
      // printUserInfo(postUserAssetState)

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        skimUsd,
        depositUsd.add(baseNum),
        0, depositUsd.add(baseNum),
        0, 0,
      ]);

      const vaultsAssets = postSystemAssetState.totalAsset.sub(preSystemAssetState.totalAsset)
        .sub(postSystemAssetState.lifeguardUsd.sub(preSystemAssetState.lifeguardUsd));
      expect(postSystemAssetState.daiAdapterTotalAssetUsd.sub(preSystemAssetState.daiAdapterTotalAssetUsd))
        .to.be.a.bignumber.closeTo(
          vaultsAssets.mul(daiPercent).div(percentFactor), toBN(10).mul(baseNum)
        );
      expect(postSystemAssetState.usdcAdapterTotalAssetUsd.sub(preSystemAssetState.usdcAdapterTotalAssetUsd))
        .to.be.a.bignumber.closeTo(
          vaultsAssets.mul(usdcPercent).div(percentFactor), toBN(10).mul(baseNum)
        );
      expect(postSystemAssetState.usdtAdapterTotalAssetUsd.sub(preSystemAssetState.usdtAdapterTotalAssetUsd))
        .to.be.a.bignumber.closeTo(
          vaultsAssets.mul(usdtPercent).div(percentFactor), toBN(10).mul(baseNum)
        );

      compareUserStableCoins(
        preUserAssetState,
        postUserAssetState,
        whaleDeposit
      );
      compareUserGTokens(preUserAssetState, postUserAssetState, [0, depositUsd]);
    })

    it.skip('Whale deposit with gain and performance in (0, 100)', async function () {
      await controller.depositPwrd(
        [
          toBN(500).mul(daiBaseNum),
          toBN(500).mul(usdcBaseNum),
          toBN(500).mul(usdtBaseNum),
        ],
        investor1,
      );

      await controller.depositGvt(
        [
          toBN(500).mul(daiBaseNum),
          toBN(500).mul(usdcBaseNum),
          toBN(500).mul(usdtBaseNum),
        ],
        investor2,
      );

      await controller.depositPwrd(
        [
          toBN(20000).mul(daiBaseNum),
          toBN(20000).mul(usdcBaseNum),
          toBN(20000).mul(usdtBaseNum),
        ],
        investor2,
      );

      const profits = [
        toBN(2000).mul(daiBaseNum),
        toBN(2000).mul(usdcBaseNum),
        toBN(2000).mul(usdtBaseNum),
      ]

      await mintToken(DAI, DAIVaultAdaptor.address, profits[0], mainnet);
      await mintToken(USDC, USDCVaultAdaptor.address, profits[1], mainnet);
      await mintToken(USDT, USDTVaultAdaptor.address, profits[2], mainnet);

      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor1)
      // printSystemInfo(preSystemAssetState)
      // printUserInfo(preUserAssetState)
      expect(await pnl.totalAssetsChangeTrigger()).equal(true);

      await insurance.setWhaleThresholdDeposit(1);
      await pnl.setPerformanceFee(toBN(2000));

      const profitsUsd = await buoy.stableToUsd(profits, true);
      const performanceFee = await pnl.performanceFee();
      const feeProfit = profitsUsd.mul(performanceFee).div(percentFactor);
      const distResult = distributeProfit(profitsUsd.sub(feeProfit), preSystemAssetState.gvtAsset, preSystemAssetState.pwrdAsset);
      const investor1GvtPost = await userPnL(distResult[2], gvt, investor1);
      const investor1PwrdPost = await userPnL(distResult[3], pwrd, investor1);

      const depositDai = toBN(1000).mul(daiBaseNum);
      const depositUsdc = toBN(1000).mul(usdcBaseNum);
      const depositUsdt = toBN(1000).mul(usdtBaseNum);
      const amounts = [
        depositDai,
        depositUsdc,
        depositUsdt,
      ];
      const amountsUsd = await buoy.stableToUsd(amounts, true);
      const skimPercent = await controller.getSkimPercent();
      const skimUsd = amountsUsd.mul(skimPercent).div(percentFactor);

      await controller.depositGvt(amounts, investor1);

      const postSystemAssetState = await getSystemInfo(controller)
      const postUserAssetState = await getUserInfo(controller, investor1)
      // printSystemInfo(postSystemAssetState)
      // printUserInfo(postUserAssetState)

      const rewardGvt = await gvt.getAssets(reward);

      expect(await pnl.pnlTrigger()).equal(false);
      expect(rewardGvt).to.be.a.bignumber.closeTo(feeProfit, baseNum.div(toBN(1000)));
      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        skimUsd,
        amountsUsd,
        distResult[2].add(feeProfit).add(amountsUsd),
        distResult[3].add(baseNum)
      ]);

      compareUserStableCoins(
        preUserAssetState,
        postUserAssetState,
        amounts
      );
      compareUserGTokens(preUserAssetState, postUserAssetState,
        [investor1GvtPost.add(amountsUsd), investor1PwrdPost.add(baseNum)]);
    })

    it.skip('Whale deposit with gain and performance = 0', async function () {
      await controller.depositPwrd(
        [
          toBN(500).mul(daiBaseNum),
          toBN(500).mul(usdcBaseNum),
          toBN(500).mul(usdtBaseNum),
        ],
        investor1,
      );

      await controller.depositGvt(
        [
          toBN(500).mul(daiBaseNum),
          toBN(500).mul(usdcBaseNum),
          toBN(500).mul(usdtBaseNum),
        ],
        investor2,
      );

      await controller.depositPwrd(
        [
          toBN(20000).mul(daiBaseNum),
          toBN(20000).mul(usdcBaseNum),
          toBN(20000).mul(usdtBaseNum),
        ],
        investor2,
      );

      const profits = [
        toBN(2000).mul(daiBaseNum),
        toBN(2000).mul(usdcBaseNum),
        toBN(2000).mul(usdtBaseNum),
      ]

      await mintToken(DAI, DAIVaultAdaptor.address, profits[0], mainnet);
      await mintToken(USDC, USDCVaultAdaptor.address, profits[1], mainnet);
      await mintToken(USDT, USDTVaultAdaptor.address, profits[2], mainnet);

      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor1)
      // printSystemInfo(preSystemAssetState)
      // printUserInfo(preUserAssetState)
      expect(await pnl.totalAssetsChangeTrigger()).equal(true);

      await insurance.setWhaleThresholdDeposit(1);
      await pnl.setPerformanceFee(0);

      const profitsUsd = await buoy.stableToUsd(profits, true);
      const performanceFee = await pnl.performanceFee();
      const feeProfit = profitsUsd.mul(performanceFee).div(percentFactor);
      const distResult = distributeProfit(profitsUsd, preSystemAssetState.gvtAsset, preSystemAssetState.pwrdAsset);
      const investor1GvtPost = await userPnL(distResult[2], gvt, investor1);
      const investor1PwrdPost = await userPnL(distResult[3], pwrd, investor1);

      const depositDai = toBN(1000).mul(daiBaseNum);
      const depositUsdc = toBN(1000).mul(usdcBaseNum);
      const depositUsdt = toBN(1000).mul(usdtBaseNum);
      const amounts = [
        depositDai,
        depositUsdc,
        depositUsdt,
      ];
      const amountsUsd = await buoy.stableToUsd(amounts, true);
      const skimPercent = await controller.getSkimPercent();
      const skimUsd = amountsUsd.mul(skimPercent).div(percentFactor);

      await controller.depositGvt(amounts, investor1);

      const postSystemAssetState = await getSystemInfo(controller)
      const postUserAssetState = await getUserInfo(controller, investor1)
      // printSystemInfo(postSystemAssetState)
      // printUserInfo(postUserAssetState)

      const rewardGvt = await gvt.getAssets(reward);

      expect(await pnl.pnlTrigger()).equal(false);
      expect(rewardGvt).to.be.a.bignumber.equals(toBN(0));
      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        skimUsd,
        amountsUsd,
        distResult[2].add(amountsUsd),
        distResult[3].add(baseNum),
      ]);

      compareUserStableCoins(
        preUserAssetState,
        postUserAssetState,
        amounts
      );
      compareUserGTokens(preUserAssetState, postUserAssetState,
        [investor1GvtPost.add(amountsUsd), investor1PwrdPost.add(baseNum)]);
    })

    it.skip('Whale deposit with gain and performance = 100', async function () {
      await controller.depositPwrd(
        [
          toBN(500).mul(daiBaseNum),
          toBN(500).mul(usdcBaseNum),
          toBN(500).mul(usdtBaseNum),
        ],
        investor1,
      );

      await controller.depositGvt(
        [
          toBN(500).mul(daiBaseNum),
          toBN(500).mul(usdcBaseNum),
          toBN(500).mul(usdtBaseNum),
        ],
        investor2,
      );

      await controller.depositPwrd(
        [
          toBN(20000).mul(daiBaseNum),
          toBN(20000).mul(usdcBaseNum),
          toBN(20000).mul(usdtBaseNum),
        ],
        investor2,
      );

      const profits = [
        toBN(2000).mul(daiBaseNum),
        toBN(2000).mul(usdcBaseNum),
        toBN(2000).mul(usdtBaseNum),
      ]

      await mintToken(DAI, DAIVaultAdaptor.address, profits[0], mainnet);
      await mintToken(USDC, USDCVaultAdaptor.address, profits[1], mainnet);
      await mintToken(USDT, USDTVaultAdaptor.address, profits[2], mainnet);

      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor1)
      // printSystemInfo(preSystemAssetState)
      // printUserInfo(preUserAssetState)
      expect(await pnl.totalAssetsChangeTrigger()).equal(true);

      await insurance.setWhaleThresholdDeposit(1);
      await pnl.setPerformanceFee(10000);

      const profitsUsd = await buoy.stableToUsd(profits, true);
      const performanceFee = await pnl.performanceFee();
      const feeProfit = profitsUsd.mul(performanceFee).div(percentFactor);

      const depositDai = toBN(1000).mul(daiBaseNum);
      const depositUsdc = toBN(1000).mul(usdcBaseNum);
      const depositUsdt = toBN(1000).mul(usdtBaseNum);
      const amounts = [
        depositDai,
        depositUsdc,
        depositUsdt,
      ];
      const amountsUsd = await buoy.stableToUsd(amounts, true);
      const skimPercent = await controller.getSkimPercent();
      const skimUsd = amountsUsd.mul(skimPercent).div(percentFactor);

      await controller.depositGvt(amounts, investor1);

      const postSystemAssetState = await getSystemInfo(controller)
      const postUserAssetState = await getUserInfo(controller, investor1)
      // printSystemInfo(postSystemAssetState)
      // printUserInfo(postUserAssetState)

      const rewardGvt = await gvt.getAssets(reward);

      expect(await pnl.pnlTrigger()).equal(false);
      expect(rewardGvt).to.be.a.bignumber.closeTo(profitsUsd, baseNum.div(toBN(1000)));
      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        skimUsd,
        amountsUsd,
        amountsUsd.add(profitsUsd),
        baseNum
      ]);

      compareUserStableCoins(
        preUserAssetState,
        postUserAssetState,
        amounts
      );
      compareUserGTokens(preUserAssetState, postUserAssetState,
        [amountsUsd, baseNum]);
    })

    it.skip('Whale deposit with loss', async function () {
      await controller.depositPwrd(
        [
          toBN(500).mul(daiBaseNum),
          toBN(500).mul(usdcBaseNum),
          toBN(500).mul(usdtBaseNum),
        ],
        investor1,
      );

      await controller.depositGvt(
        [
          toBN(500).mul(daiBaseNum),
          toBN(500).mul(usdcBaseNum),
          toBN(500).mul(usdtBaseNum),
        ],
        investor2,
      );

      await controller.depositPwrd(
        [
          toBN(20000).mul(daiBaseNum),
          toBN(20000).mul(usdcBaseNum),
          toBN(20000).mul(usdtBaseNum),
        ],
        investor2,
      );

      const losses = [
        toBN(2000).mul(daiBaseNum),
        toBN(2000).mul(usdcBaseNum),
        toBN(2000).mul(usdtBaseNum),
      ]

      await burnToken(DAI, DAIVaultAdaptor.address, losses[0], mainnet);
      await burnToken(USDC, USDCVaultAdaptor.address, losses[1], mainnet);
      await burnToken(USDT, USDTVaultAdaptor.address, losses[2], mainnet);

      const preSystemAssetState = await getSystemInfo(controller)
      const preUserAssetState = await getUserInfo(controller, investor1)
      // printSystemInfo(preSystemAssetState)
      // printUserInfo(preUserAssetState)
      expect(await pnl.pnlTrigger()).equal(true);

      await insurance.setWhaleThresholdDeposit(1);

      const lossesUsd = await buoy.stableToUsd(losses, true);
      const investor1GvtLoss = await userPnL(lossesUsd, gvt, investor1);

      const depositDai = toBN(1000).mul(daiBaseNum);
      const depositUsdc = toBN(1000).mul(usdcBaseNum);
      const depositUsdt = toBN(1000).mul(usdtBaseNum);
      const amounts = [
        depositDai,
        depositUsdc,
        depositUsdt,
      ];
      const amountsUsd = await buoy.stableToUsd(amounts, true);
      const skimPercent = await controller.getSkimPercent();
      const skimUsd = amountsUsd.mul(skimPercent).div(percentFactor);

      await controller.depositGvt(amounts, investor1);

      const postSystemAssetState = await getSystemInfo(controller)
      const postUserAssetState = await getUserInfo(controller, investor1)
      // printSystemInfo(postSystemAssetState)
      // printUserInfo(postUserAssetState)

      compareSystemInfo(preSystemAssetState, postSystemAssetState, [
        skimUsd,
        amountsUsd.sub(lossesUsd).abs(),
        amountsUsd.sub(lossesUsd).abs().add(baseNum),
        baseNum,
      ]);

      compareUserStableCoins(
        preUserAssetState,
        postUserAssetState,
        amounts
      );
      compareUserGTokens(preUserAssetState, postUserAssetState,
        [amountsUsd.sub(investor1GvtLoss).abs().add(baseNum), baseNum]);
    })
  })
})
