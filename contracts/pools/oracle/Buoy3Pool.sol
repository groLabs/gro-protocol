// SPDX-License-Identifier: AGPLv3
pragma solidity >=0.6.0 <0.7.0;

import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@chainlink/contracts/src/v0.6/interfaces/AggregatorV3Interface.sol";

import {FixedStablecoins} from "../../common/FixedContracts.sol";
import {ICurve3Pool} from "../../interfaces/ICurve.sol";

import "../../common/Controllable.sol";

import "../../interfaces/IBuoy.sol";
import "../../interfaces/IChainPrice.sol";
import "../../interfaces/IERC20Detailed.sol";


/// @notice Contract for calculating prices of underlying assets and LP tokens in Curve pool. Also
///     used to sanity check pool against external oracle, to ensure that pools underlying coin ratios
///     are within a specific range (measued in BP) of the external oracles coin price ratios.
///     Sanity check:
///         The Buoy checks previously recorded (cached) curve coin dy, which it compares against current curve dy,
///         blocking any interaction that is outside a certain tolerance (oracle_check_tolerance). When updting the cached
///         value, the buoy uses chainlink to ensure that curves prices arent off peg.
contract Buoy3Pool is FixedStablecoins, Controllable, IBuoy, IChainPrice {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    uint256 public oracle_check_tolerance = 1000;
    uint256 public curve_check_tolerance = 150;
    uint256 constant CHAIN_FACTOR = 100;

    ICurve3Pool public immutable curvePool;
    mapping(uint256 => uint256) public lastRatio;

    // Chianlink price feed
    address public immutable daiUsdAgg;
    address public immutable usdcUsdAgg;
    address public immutable usdtUsdAgg;

    event LogNewOracleTolerance(uint256 oldLimit, uint256 newLimit);
    event LogNewCurveTolerance(uint256 oldLimit, uint256 newLimit);
    event LogNewRatios(uint256[N_COINS] newRatios);

    constructor(
        address _crv3pool,
        address[N_COINS] memory _tokens,
        uint256[N_COINS] memory _decimals,
        address[N_COINS] memory aggregators
    ) public FixedStablecoins(_tokens, _decimals) {
        curvePool = ICurve3Pool(_crv3pool);
        daiUsdAgg = aggregators[0];
        usdcUsdAgg = aggregators[1];
        usdtUsdAgg = aggregators[2];
    }

    /// @notice Set limit for how much Curve pool and external oracle is allowed
    ///     to deviate before failing transactions
    /// @param newLimit New threshold in 1E6
    function setOracleTolerance(uint256 newLimit) external onlyOwner {
        uint256 oldLimit = oracle_check_tolerance;
        oracle_check_tolerance = newLimit;
        emit LogNewOracleTolerance(oldLimit, newLimit);
    }

    /// @notice Set limit for how much Curve pool current and cached values
    ///     can deviate before failing transactions
    /// @param newLimit New threshold in 1E6
    function setCurveTolerance(uint256 newLimit) external onlyOwner {
        uint256 oldLimit = curve_check_tolerance;
        curve_check_tolerance = newLimit;
        emit LogNewCurveTolerance(oldLimit, newLimit);
    }

    /// @notice Check the health of the Curve pool:
    ///     Ratios are checked by the following heuristic:
    ///     Orcale A - Curve
    ///     Oracle B - External oracle
    ///     Both oracles establish ratios for a set of stable coins
    ///         (a, b, c)
    ///     and product the following set of ratios:
    ///         (a/a, a/b, a/c), (b/b, b/a, b/c), (c/c, c/a, c/b)
    ///         1) ratios between a stable coin and itself can be discarded
    ///         2) inverted ratios, a/b vs b/a, while producing different results
    ///             should both reflect similar in any one of the two underlying assets,
    ///             but in opposite directions. This difference between the two will increase
    ///             as the two assets drift apart, but is considered insignificant at the required
    ///             treshold (< 50 BPs).
    ///     This mean that the following set should provide the necessary coverage checks
    ///     to establish that the coins pricing is healthy:
    ///         (a/b, a/c, c/b))
    function safetyCheck() external view override returns (bool) {
        uint256 _ratio;
        for (uint256 i = 1; i < N_COINS; i++) {
            _ratio = curvePool.get_dy(int128(0), int128(i), getDecimal(0));
            _ratio = abs(int256(_ratio) - int256(lastRatio[i - 1]));
            if (_ratio > curve_check_tolerance) {
                return false;
            }
        }
        _ratio = curvePool.get_dy(int128(2), int128(1), getDecimal(1));
        _ratio = abs(int256(_ratio) - int256(lastRatio[N_COINS - 1]));
        if (_ratio > curve_check_tolerance) {
            return false;
        }
        return true;
    }

    /// @notice Check depths in curve pool
    /// @param tolerance Check that the pool is within a given tolerance
    function healthCheck(uint256 tolerance) external view returns (bool, uint256) {
        uint256[N_COINS] memory balances;
        uint256 total;
        uint256 ratio;
        for (uint256 i = 0; i < N_COINS; i++) {
            uint256 balance = curvePool.balances(i);
            balance = balance.mul(1E18 / getDecimal(i));
            total = total.add(balance);
            balances[i] = balance;
        }
        for (uint256 i = 0; i < N_COINS; i++) {
            ratio = balances[i].mul(PERCENTAGE_DECIMAL_FACTOR).div(total);
            if (ratio < tolerance) {
                return (false, i);
            }
        }
        return (true, N_COINS);
    } 

    /// @notice Updated cached curve value with a custom tolerance towards chainlink
    /// @param tolerance How much difference between curve and chainlink can be tolerated
    function updateRatiosWithTolerance(uint256 tolerance) external override returns (bool) {
        require(msg.sender == controller || msg.sender == owner(), "updateRatiosWithTolerance: !authorized");
        return _updateRatios(tolerance);
    }

    /// @notice Updated cached curve values
    function updateRatios() external override returns (bool) {
        require(msg.sender == controller || msg.sender == owner(), "updateRatios: !authorized");
        return _updateRatios(oracle_check_tolerance);
    }

    /// @notice Get USD value for a specific input amount of tokens, slippage included
    function stableToUsd(uint256[N_COINS] calldata inAmounts, bool deposit) external view override returns (uint256) {
        return _stableToUsd(inAmounts, deposit);
    }

    /// @notice Get estimate USD price of a stablecoin amount
    /// @param inAmount Token amount
    /// @param i Index of token
    function singleStableToUsd(uint256 inAmount, uint256 i) external view override returns (uint256) {
        uint256[N_COINS] memory inAmounts;
        inAmounts[i] = inAmount;
        return _stableToUsd(inAmounts, true);
    }

    /// @notice Get LP token value of input amount of tokens
    function stableToLp(uint256[N_COINS] calldata tokenAmounts, bool deposit) external view override returns (uint256) {
        return _stableToLp(tokenAmounts, deposit);
    }

    /// @notice Get LP token value of input amount of single token
    function singleStableFromUsd(uint256 inAmount, int128 i) external view override returns (uint256) {
        return _singleStableFromLp(_usdToLp(inAmount), i);
    }

    /// @notice Get LP token value of input amount of single token
    function singleStableFromLp(uint256 inAmount, int128 i) external view override returns (uint256) {
        return _singleStableFromLp(inAmount, i);
    }

    /// @notice Get USD price of LP tokens you receive for a specific input amount of tokens, slippage included
    function lpToUsd(uint256 inAmount) external view override returns (uint256) {
        return _lpToUsd(inAmount);
    }

    /// @notice Convert USD amount to LP tokens
    function usdToLp(uint256 inAmount) external view override returns (uint256) {
        return _usdToLp(inAmount);
    }

    /// @notice Split LP token amount to balance of pool tokens
    /// @param inAmount Amount of LP tokens
    /// @param totalBalance Total balance of pool
    function poolBalances(uint256 inAmount, uint256 totalBalance)
        internal
        view
        returns (uint256[N_COINS] memory balances)
    {
        uint256[N_COINS] memory _balances;
        for (uint256 i = 0; i < N_COINS; i++) {
            _balances[i] = (IERC20(getToken(i)).balanceOf(address(curvePool)).mul(inAmount)).div(totalBalance);
        }
        balances = _balances;
    }

    function getVirtualPrice() external view override returns (uint256) {
        return curvePool.get_virtual_price();
    }

    // Internal functions
    function _lpToUsd(uint256 inAmount) internal view returns (uint256) {
        return inAmount.mul(curvePool.get_virtual_price()).div(DEFAULT_DECIMALS_FACTOR);
    }

    function _stableToUsd(uint256[N_COINS] memory tokenAmounts, bool deposit) internal view returns (uint256) {
        uint256 lpAmount = curvePool.calc_token_amount(tokenAmounts, deposit);
        return _lpToUsd(lpAmount);
    }

    function _stableToLp(uint256[N_COINS] memory tokenAmounts, bool deposit) internal view returns (uint256) {
        return curvePool.calc_token_amount(tokenAmounts, deposit);
    }

    function _singleStableFromLp(uint256 inAmount, int128 i) internal view returns (uint256) {
       if (inAmount == 0) {
           return 0;
       }
       return curvePool.calc_withdraw_one_coin(inAmount, i);
    }

    /// @notice Convert USD amount to LP tokens
    function _usdToLp(uint256 inAmount) internal view returns (uint256) {
        return inAmount.mul(DEFAULT_DECIMALS_FACTOR).div(curvePool.get_virtual_price());
    }

    /// @notice Calculate price ratios for stablecoins
    ///     Get USD price data for stablecoin
    /// @param i Stablecoin to get USD price for
    function getPriceFeed(uint256 i) external view override returns (uint256) {
        int256 _price;
        (, _price, , ,) = AggregatorV3Interface(getAggregator(i)).latestRoundData();
        return uint256(_price);
    }

    /// @notice Fetch chainlink token ratios
    /// @param i Token in
    function getTokenRatios(uint256 i) private view returns (uint256[N_COINS] memory _ratios) {
        int256[N_COINS] memory _prices;
        (,_prices[0], , ,) = AggregatorV3Interface(getAggregator(0)).latestRoundData();
        (,_prices[1], , ,) = AggregatorV3Interface(getAggregator(1)).latestRoundData();
        (,_prices[2], , ,) = AggregatorV3Interface(getAggregator(2)).latestRoundData();
        _ratios[0] = uint256(_prices[0]).mul(CHAINLINK_PRICE_DECIMAL_FACTOR).div(uint256(_prices[1]));
        _ratios[1] = uint256(_prices[0]).mul(CHAINLINK_PRICE_DECIMAL_FACTOR).div(uint256(_prices[2]));
        _ratios[2] = uint256(_prices[2]).mul(CHAINLINK_PRICE_DECIMAL_FACTOR).div(uint256(_prices[1]));
        return _ratios;
    }

    function getAggregator(uint256 index) private view returns (address) {
        require(index < N_COINS, 'getAggregator: !index < N_COINS');
        if (index == 0) {
            return daiUsdAgg;
        } else if (index == 1) {
            return usdcUsdAgg;
        } else {
            return usdtUsdAgg;
        }
    }

    /// @notice Get absolute value
    function abs(int256 x) private pure returns (uint256) {
        return x >= 0 ? uint256(x) : uint256(-x);
    }

    function _updateRatios(uint256 tolerance) private returns (bool) {
        uint256[N_COINS] memory chainRatios = getTokenRatios(0);
        uint256[N_COINS] memory newRatios;
        uint256 _ratio;
        uint256 check;
        for (uint256 i = 1; i < N_COINS; i++) {
            _ratio = curvePool.get_dy(int128(0), int128(i), getDecimal(0));
            check = abs(int256(_ratio) - int256(chainRatios[i - 1].div(CHAIN_FACTOR)));
            if (check > tolerance) {
                return false;
            } else {
                newRatios[i - 1] = _ratio;
            }
        }

        _ratio = curvePool.get_dy(int128(2), int128(1), getDecimal(1));
        check = abs(int256(_ratio) - int256(chainRatios[2]/CHAIN_FACTOR));
        if (check > tolerance) {
            return false;
        }
        newRatios[N_COINS - 1] = _ratio;
        for (uint256 i; i < N_COINS; i++) {
            lastRatio[i] = newRatios[i];
        }
        emit LogNewRatios(newRatios);
        return true;
    }
}
