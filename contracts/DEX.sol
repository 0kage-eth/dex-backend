//SPDX-License-Identifier:MIT
pragma solidity ^0.8.7;
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";
import "hardhat/console.sol";

/**
 * @title DEX contract that converts ETH -> 0KAGE -> ETH
 * @author Zero Kage
 * @notice  Worked on this when solving scaffold ETH challenges. Used that as the base
 * @dev contract will hold reserves of ETH and 0KAGE. Users can provide liquidity or exchange one asset to another
 *
 */
contract DEX {
    using SafeMath for uint256;

    //************* Members ****************/
    IERC20 private s_zeroKage;

    uint256 private s_totalLiquidity; // total liquidity in the pool at any time

    uint256 private immutable i_lpFees; // lp fees in basis points (1 bp = 0.01%)

    mapping(address => uint256) private s_liquidity; //address wise mapping of liquidity

    //***************** Events **************/

    /**
     * @notice emitted when ETH -> 0KAGE conversion
     */
    event EthToZeroKage(address user, uint256 ethDeposited, uint256 zeroKageWithdrawn);

    /**
     * @notice emitted when 0KAGE -> ETH conversion
     */
    event ZeroKageToEth(address user, uint256 zeroKageDeposited, uint256 ethWithdrawn);

    /**
     * @notice emitted when liquidity is provided to pool
     */
    event AddLiquidity(
        address user,
        uint256 liquidityMinted,
        uint256 ethAdded,
        uint256 zeroKageAdded
    );

    /**
     * @notice emitted when liquidity is removed from pool
     */
    event RemoveLiquidity(
        address user,
        uint256 liquidityBurned,
        uint256 ethRemoved,
        uint256 zeroKageWithdrawn
    );

    //********************* ERRORS ***********************/

    error DEX__zKageTransferFromFailed(address from, uint256 transfer, uint256 balance);
    error DEX__zKageTransferToFailed(address to, uint256 transfer, uint256 balance);
    error DEX__ethTransferFailed(address to, uint256 transfer, uint256 balance);
    error DEX__insufficientLiquidity(
        address user,
        uint256 liquidityWithdrawn,
        uint256 liquidityBalance
    );

    /************* CONSTRUCTOR *******************/
    constructor(address zeroKageAddress, uint256 lpFees) {
        s_zeroKage = IERC20(zeroKageAddress);
        i_lpFees = lpFees;
    }

    //************ WRITE FUNCTIONS ***************/

    /**
     * @notice capitalized DEX with initial DEX and 0KAGE tokens
     * @param numTokens initial number of 0KAGE tokens to be transferred to DEX
     * @return totalLiquidity in ETH terms
     * @dev notice that numTokens is based on initial price of 0KAGE token
     * @dev say if 1 0KAGE = 0.01 ETH initially... we need to provide x ETH and 100x 0KAGE to capitalize pool
     * @dev initial LP tokens minted = sqrt (numEth * num0KAGE)
     * @dev Check out https://docs.uniswap.org/protocol/V2/concepts/core-concepts/pools for more on constant AMM pools
     */
    function initializeDEX(uint256 numTokens) public payable returns (uint256 totalLiquidity) {
        uint256 numEth = address(this).balance; // balance = total transferred
        s_totalLiquidity = sqrt(numEth * numTokens);

        bool success = s_zeroKage.transferFrom(msg.sender, address(this), numTokens);

        if (!success) {
            uint256 zeroKageBalance = s_zeroKage.balanceOf(msg.sender);
            revert DEX__zKageTransferFromFailed(msg.sender, numTokens, zeroKageBalance);
        }

        s_liquidity[msg.sender] = s_totalLiquidity;
        totalLiquidity = s_totalLiquidity;
    }

    /**
     * @notice function swaps ETH -> 0KAGE
     * @return zKageOutput number of zeroKage tokens that will exit the pool in exchange for ETH deposit
     * @dev this calculation is again governed by constant product AMM
     * @dev since Eth value is transfered via msg.value, this function has no params
     * */
    function ethToZeroKage() public payable returns (uint256 zKageOutput) {
        uint256 ethSent = msg.value;

        // eth reserve before transfer - subtract ethSent
        uint256 ethReserve = address(this).balance.sub(ethSent);
        uint256 zeroKageReserve = s_zeroKage.balanceOf(address(this));

        zKageOutput = price(ethSent, ethReserve, zeroKageReserve, i_lpFees);

        bool success = s_zeroKage.transfer(msg.sender, zKageOutput);

        if (!success) {
            revert DEX__zKageTransferToFailed(msg.sender, zKageOutput, zeroKageReserve);
        }

        emit EthToZeroKage(msg.sender, ethSent, zKageOutput);
    }

    /**
     * @notice function swaps 0KAGE -> ETH
     * @return ethOutput number of ETH that exit the pool in exchange for ZeroKage deposit
     * @dev just reverse of previous function
     */
    function zeroKageToEth(uint256 zeroKageTokens) public payable returns (uint256 ethOutput) {
        uint256 ethReserve = address(this).balance;
        uint256 zKageReserve = s_zeroKage.balanceOf(address(this));

        ethOutput = price(zeroKageTokens, zKageReserve, ethReserve, i_lpFees);

        bool success = s_zeroKage.transferFrom(msg.sender, address(this), zeroKageTokens);

        if (!success) {
            revert DEX__zKageTransferFromFailed(msg.sender, zeroKageTokens, zKageReserve);
        }

        // console.log("eth before transfer", msg.sender.balance);
        (bool ethSuccess, ) = msg.sender.call{value: ethOutput}("");
        if (!ethSuccess) {
            revert DEX__ethTransferFailed(msg.sender, ethOutput, ethReserve);
        }
        // console.log("eth transfer", ethOutput);
        // console.log("eth after transfer", msg.sender.balance);

        emit ZeroKageToEth(msg.sender, zeroKageTokens, ethOutput);
    }

    /**
     * @notice deposits liquidity into pool
     * @notice both ETH and 0Kage need to be deposited proportionately
     * @dev LP tokens have to be issued & total liquidity adjusted accordingly
     * */
    function deposit() public payable returns (uint256 tokensDeposited) {
        uint256 ethDeposited = msg.value;
        uint256 ethReserve = address(this).balance - ethDeposited;

        uint256 zKageReserve = s_zeroKage.balanceOf(address(this));

        uint256 zKageDeposited = ethDeposited.mul(zKageReserve).div(ethReserve);

        bool success = s_zeroKage.transferFrom(msg.sender, address(this), zKageDeposited);

        if (!success) {
            revert DEX__zKageTransferFromFailed(msg.sender, zKageDeposited, zKageReserve);
        }

        uint256 liquidityDelta = s_totalLiquidity.mul(ethDeposited).div(ethReserve);

        s_totalLiquidity += liquidityDelta;
        s_liquidity[msg.sender] += liquidityDelta;

        emit AddLiquidity(msg.sender, liquidityDelta, ethDeposited, zKageDeposited);

        tokensDeposited = zKageDeposited;
    }

    /**
     * @notice function withdraws liquidity from pool
     * @dev reduce liquidity and adjust liquidity of particular user
     */
    function withdraw(uint256 numLPTokens)
        public
        payable
        returns (uint256 ethQty, uint256 zeroKageQty)
    {
        if (numLPTokens > s_liquidity[msg.sender]) {
            revert DEX__insufficientLiquidity(msg.sender, numLPTokens, s_liquidity[msg.sender]);
        }

        uint256 ethReserve = address(this).balance;
        uint256 zKageReserve = s_zeroKage.balanceOf(address(this));

        ethQty = numLPTokens.mul(ethReserve).div(s_totalLiquidity);
        zeroKageQty = numLPTokens.mul(zKageReserve).div(s_totalLiquidity);

        (bool success, ) = msg.sender.call{value: ethQty}("");

        if (!success) {
            revert DEX__ethTransferFailed(msg.sender, ethQty, ethReserve);
        }

        bool zkSuccesss = s_zeroKage.transfer(msg.sender, zeroKageQty);

        if (!zkSuccesss) {
            revert DEX__zKageTransferToFailed(msg.sender, zeroKageQty, zKageReserve);
        }

        s_totalLiquidity -= numLPTokens;
        s_liquidity[msg.sender] -= numLPTokens;

        emit RemoveLiquidity(msg.sender, numLPTokens, ethQty, zeroKageQty);
    }

    //************ PURE FUNCTIONS **************/

    /**
     * @notice calculates square root of a number y
     * @dev took this from uniswap v2 version to calculate liquidity
     *
     */
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    /**
     * @notice calculates yOutput (change in y Tokens) for given change in xTokens
     * @notice we use Constant Product AMM model here
     * @param xInput number of x tokens sent to pool
     * @param xReserves total number of x tokens in pool before txn is executed
     * @param yReserves total number of y tokens in pool before txn is executed
     * @param lpFees fees in basis points (1 bp = 0.01%) charged by pool creators
     * @return yOutput number of y Tokens received from pool
     * @dev for more details on formula, I've referred to the following video by Smart Contract Engineer
     * @dev formula
     */
    function price(
        uint256 xInput,
        uint256 xReserves,
        uint256 yReserves,
        uint256 lpFees
    ) internal pure returns (uint256 yOutput) {
        uint256 share = 1000;
        uint256 feeInBp = lpFees.div(10**14);
        uint256 shareMinusFee = share.sub(feeInBp);
        uint256 denominator = (share * xReserves + shareMinusFee * yReserves);
        uint256 numerator = yReserves.mul(shareMinusFee).mul(xInput);

        yOutput = numerator.div(denominator);
    }

    // ************************* GET FUNCTIONS *********************** //

    /**
     * @notice gets # of Eth tokens you can swap for a given # of 0Kage tokens
     * @param numTokens number of 0Kage tokens that need to be swapped
     * @return eth number of eth that you can exchange to/from pool for 0Kage tokens
     */
    function getSwappableEth(uint256 numTokens) public view returns (uint256 eth) {
        uint256 tokenReserves = s_zeroKage.balanceOf(address(this));
        uint256 ethReserves = address(this).balance;
        eth = price(numTokens, tokenReserves, ethReserves, i_lpFees);
    }

    /**
     * @notice gets # of 0Kage tokens you can swap for a given # of eth
     * @param numEth number of eth coins that need to be swapped for 0Kage
     * @return tokens number of tokens that you can exchange to/from pool for numEth ethereum
     */
    function getSwappableTokens(uint256 numEth) public view returns (uint256 tokens) {
        uint256 tokenReserves = s_zeroKage.balanceOf(address(this));
        uint256 ethReserves = address(this).balance;
        tokens = price(numEth, ethReserves, tokenReserves, i_lpFees);
    }

    /**
     * @notice gets liquidity for a given address
     * @param user address of user whose liquidity is to be calculated
     * @return liquidity for specific user
     */
    function getLiquidity(address user) public view returns (uint256) {
        return s_liquidity[user];
    }

    /**
     * @notice gets total liquidity in the pool supplied by all users
     * @return total liquidity in pool
     */
    function getTotalLiquidity() public view returns (uint256) {
        return s_totalLiquidity;
    }

    /**
     * @notice returns the address of 0Kage token
     * @return deployed address of 0Kage token
     */
    function getZeroKageTokenAddress() public view returns (address) {
        return address(s_zeroKage);
    }

    /**
     * @notice lp fees charged by protocol  - default value set to 3 bps
     * @return lp fees in basis points
     */
    function getLPFees() public view returns (uint256) {
        return i_lpFees;
    }

    /**
     * @notice amount of Eth to be added to LP pool for given # of tokens
     * @param numTokens number of tokens that are added to LP pool
     * @dev tokens need to be added proportionately as per constant product AMM formulas
     * @return numEth number of ether to be added to pool
     */
    function getEthToPool(uint256 numTokens) public view returns (uint256 numEth) {
        uint256 ethReserve = address(this).balance;
        uint256 tokenReserve = s_zeroKage.balanceOf(address(this));

        numEth = numTokens.mul(ethReserve).div(tokenReserve);
    }

    /**
     * @notice amount of tokens to be added to LP pool for given # of eth added
     * @param numEth number of eth to be added to pool
     * @dev Eth needs to be proportionately added as per constant product AMM formula
     * @return numTokens number of tokens to be added to pool
     */
    function getTokensToPool(uint256 numEth) public view returns (uint256 numTokens) {
        uint256 ethReserve = address(this).balance;
        uint256 tokenReserve = s_zeroKage.balanceOf(address(this));

        numTokens = numEth.mul(tokenReserve).div(ethReserve);
    }
}
