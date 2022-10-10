import { developmentChains, sqrt } from "../../helper-hardhat-config"
import { ethers, getNamedAccounts, network } from "hardhat"
import { GOERLI_ZEROKAGE_ADDRESS, INITIAL_0KAGE, INITIAL_ETH } from "../../constants"
import { DEX, ERC20 } from "../../typechain-types"
import { expect } from "chai"

/**
 * @notice test exclusively for deployed contract on goerli
 */
network.name !== "goerli"
    ? describe.skip
    : /**
       * @notice Full test on Goerli contract
       * @dev following steps for end-to-end test
       * @dev 1. initialize DEX with 0.01 ETH and 0.1 0Kage
       * @dev 2. transfer 0.001 Eth -> Get 0Kage
       * @dev 3. transfer 0.01 0Kage -> Get Eth
       * @dev 4. New user adds 0.01 ETH Liquidity
       * @dev 5. New user withdraws 0.005 liquidity
       */
      describe("End-to-end integration tests", () => {
          let zKageContract: ERC20
          let dexContract: DEX
          beforeEach(async () => {
              const { deployer } = await getNamedAccounts()
              zKageContract = await ethers.getContractAt(
                  "ZeroKage",
                  GOERLI_ZEROKAGE_ADDRESS,
                  deployer
              )
              dexContract = await ethers.getContract("DEX", deployer)
          })

          it("full DEX test", async () => {
              const initial0Kage = ethers.utils.parseEther(INITIAL_0KAGE)
              const initialEth = ethers.utils.parseEther(INITIAL_ETH)

              // approve dex for using 0KAge
              // approving 2x number of tokens for usage just to avoid future approvals
              const approveTx = await zKageContract.approve(
                  dexContract.address,
                  initial0Kage.mul(2)
              )

              // initializing dex with 0.01 Eth and 0.1 0Kage
              const initTx = await dexContract.initializeDEX(initial0Kage, { value: initialEth })
              await initTx.wait(1)

              // State 0 -> right after initial capitalization of pool
              const ethReserve0 = await ethers.provider.getBalance(dexContract.address)
              const zKageReserve0 = await zKageContract.balanceOf(dexContract.address)
              const totalLiquidity0 = await dexContract.getTotalLiquidity()

              expect(ethReserve0).equals(initialEth, "initial eth reserve = 0.1 eth")
              expect(zKageReserve0).equals(initial0Kage, "initial 0Kage reserve = ")
              expect(totalLiquidity0).equals(
                  sqrt(initial0Kage.mul(initialEth)),
                  "initial liquidity = sqrt(eth * 0kage)"
              )

              // State 1 -> swap eth for 0Kage tokens
              const swapEthAmt = ethers.utils.parseEther("0.001")
              // applying AMM formula manually
              const num1 = zKageReserve0.mul(997).mul(swapEthAmt)
              const den1 = ethReserve0.mul(1000).add(zKageReserve0.mul(997))
              const forumla0Kage = num1.div(den1)

              const swapEthTo0KageTx = await dexContract.ethToZeroKage({ value: swapEthAmt })
              swapEthTo0KageTx.wait(1)

              const ethReserve1 = await ethers.provider.getBalance(dexContract.address)
              const zKageReserve1 = await zKageContract.balanceOf(dexContract.address)

              expect(ethReserve0.add(swapEthAmt)).equals(
                  ethReserve1,
                  "Add 0.001 eth to reserve pool"
              )
              expect(zKageReserve0.sub(forumla0Kage)).equals(
                  zKageReserve1,
                  "Subtract 0Kage from pool"
              )

              // State 2 - Swap out 0Kage for ETH
              const swap0Kage = ethers.utils.parseEther("0.01")

              // applying AMM formula manually
              const num2 = ethReserve1.mul(997).mul(swap0Kage)
              const den2 = zKageReserve1.mul(1000).add(ethReserve1.mul(997))
              const forumlaEth = num2.div(den2)

              const swap0KageToEthTx = await dexContract.zeroKageToEth(swap0Kage)
              swap0KageToEthTx.wait(1)

              const ethReserve2 = await ethers.provider.getBalance(dexContract.address)
              const zKageReserve2 = await zKageContract.balanceOf(dexContract.address)

              expect(ethReserve1.sub(forumlaEth)).equals(ethReserve2, "Remove eth as per formula")
              expect(zKageReserve1.add(swap0Kage)).equals(zKageReserve2, "Add 0Kage to pool")

              // State 3: Add liquidity to the pool

              const newEthLiquidity = ethers.utils.parseEther("0.01")

              // calculate delta below as per formula
              const liquidityDelta = newEthLiquidity.mul(totalLiquidity0).div(ethReserve2)
              const zkageDelta = newEthLiquidity.mul(zKageReserve2).div(ethReserve2)

              const addLiquidityTx = await dexContract.deposit({ value: newEthLiquidity })
              await addLiquidityTx.wait(1)

              const liquidity3 = await dexContract.getTotalLiquidity()
              const ethReserve3 = await ethers.provider.getBalance(dexContract.address)
              const zKageReserve3 = await zKageContract.balanceOf(dexContract.address)

              expect(totalLiquidity0.add(liquidityDelta)).equals(
                  liquidity3,
                  "Liquidity added should match as per formula"
              )

              expect(ethReserve2.add(newEthLiquidity)).equals(
                  ethReserve3,
                  "New eth added to pool + old eth = current eth"
              )

              expect(zKageReserve2.add(zkageDelta)).equals(
                  zKageReserve3,
                  "zkage reserve should increase proportional to liquidity"
              )

              // State 4 - Remove liquidity
              const liquidityDrain = liquidity3.mul(5).div(10) // drain 50% of liquidity from pool

              const remLiquidityTxn = await dexContract.withdraw(liquidityDrain)
              await remLiquidityTxn.wait(1)

              const ethDrained = liquidityDrain.mul(ethReserve3).div(liquidity3)
              const tokenDrained = liquidityDrain.mul(zKageReserve3).div(liquidity3)

              const liquidity4 = await dexContract.getTotalLiquidity()
              const ethReserve4 = await ethers.provider.getBalance(dexContract.address)
              const zKageReserve4 = await zKageContract.balanceOf(dexContract.address)

              expect(ethReserve3.sub(ethDrained)).equals(
                  ethReserve4,
                  "Eth drained from pool is proportionate to liquidity reduction"
              )

              expect(zKageReserve3.sub(tokenDrained)).equals(
                  zKageReserve4,
                  "Zkage drained from pool is propotionate to liquidity reduction"
              )

              expect(liquidity3.sub(liquidityDrain)).equals(
                  liquidity4,
                  "liquidity drained from pool"
              )
          })
      })
