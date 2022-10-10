import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { ethers, network, getNamedAccounts, deployments } from "hardhat"
import { networkConfig, developmentChains } from "../../helper-hardhat-config"
import { DEX, ZeroKageMock } from "../../typechain-types"
import { DEX_FEES, sqrt } from "../../helper-hardhat-config"
import { BigNumber } from "ethers"

const chainId = network.config.chainId?.toString() || "31337"
console.log("chain Id", chainId)
!developmentChains.includes(network.name)
    ? describe.skip
    : describe("DEX unit tests", () => {
          let dexContract: DEX
          let zKageContract: ZeroKageMock
          let lpUser: SignerWithAddress
          let lpProvider: SignerWithAddress

          beforeEach(async () => {
              const { deployer } = await getNamedAccounts()
              const accounts = await ethers.getSigners()
              lpUser = accounts[0]
              lpProvider = accounts[1]

              await deployments.fixture(["zKage", "dex"])

              dexContract = await ethers.getContract("DEX", deployer)
              zKageContract = await ethers.getContract("ZeroKageMock", deployer)
          })

          describe("constructor tests", () => {
              it("Check if zKageAddress is correct", async () => {
                  const zKageAddress = await dexContract.getZeroKageTokenAddress()
                  expect(zKageAddress).equals(
                      zKageContract.address,
                      "Zero Kage address in DEX does not match mock address"
                  )
              })

              it("Check if DEX fees is correct", async () => {
                  const lpFees = (await dexContract.getLPFees()).toString()
                  expect(lpFees).equals(
                      ethers.utils.parseEther(DEX_FEES).toString(),
                      "LP Fees in DEX should be equal to DEX_FEES input"
                  )
              })
          })

          describe("initial liquidity", () => {
              const numTokens = ethers.utils.parseEther("100")
              const numEth = ethers.utils.parseEther("10") // initial price 1 ETH = 10 0KAGE

              beforeEach(async () => {
                  // approve token spend
                  const approveResponse = await zKageContract.approve(
                      dexContract.address,
                      numTokens
                  )
                  approveResponse.wait(1)
                  const txResponse = await dexContract.initializeDEX(numTokens, { value: numEth })

                  await txResponse.wait(1)
              })
              it("ZeroKage tokens in DEX = initially funded 0KAGE", async () => {
                  const zKageinDex = await zKageContract.balanceOf(dexContract.address)

                  expect(zKageinDex).equals(
                      numTokens,
                      "Initial funding of zKage tokens = token balance in DEX"
                  )
              })

              it("Ether tokens in DEX = 10% of 0KAGE tokens", async () => {
                  const etherInDex = await ethers.provider.getBalance(dexContract.address)

                  expect(etherInDex).equals(
                      numEth,
                      "Ether in dex should match the initial ether funding into LP"
                  )
              })

              it("total liquidity as per constant AMM", async () => {
                  const totalLiquidity = (await dexContract.getTotalLiquidity()).toString()
                  const constantProduct = sqrt(numTokens.mul(numEth)).toString()
                  expect(totalLiquidity).equals(
                      constantProduct,
                      "Initial liquidity is sqrt(eth * zkage)"
                  )
              })

              it("Liquidity of sender = total liquidity", async () => {
                  const totalLiquidity = (await dexContract.getTotalLiquidity()).toString()
                  const accountLiquidity = await dexContract.getLiquidity(lpUser.address)

                  expect(totalLiquidity).equals(
                      accountLiquidity,
                      "On initialization, total liquidity == deployer account liquidity"
                  )
              })
          })

          describe("swap ETH to 0KAGE", () => {
              const numTokens = ethers.utils.parseEther("100")
              const numEth = ethers.utils.parseEther("10") // initial price 1 ETH = 10 0KAGE
              const ethExchange = ethers.utils.parseEther("1")
              beforeEach(async () => {
                  const approveResponse = await zKageContract.approve(
                      dexContract.address,
                      numTokens
                  )
                  approveResponse.wait(1)

                  // initialize DEX
                  const txResponse = await dexContract.initializeDEX(numTokens, { value: numEth })
                  await txResponse.wait(1)

                  // swap ETH to 0KAGE txn

                  const ethTo0KageSwapResponse = await dexContract.ethToZeroKage({
                      value: ethExchange,
                  })
                  await ethTo0KageSwapResponse.wait(1)
              })

              it("Check ETH balance, ETH -> 0KAGE", async () => {
                  const balance = await ethers.provider.getBalance(dexContract.address)
                  expect(balance).equals(
                      numEth.add(ethExchange),
                      "Eth balance = initial balance + ETH transferred"
                  )
              })

              it("Check 0KAGE balance, ETH -> 0KAGE", async () => {
                  // Note below calculation is as per constant AMM formula

                  const tokensOut = ((100 * 997 * 1) / (1000 * 10 + 997 * 100)).toString()
                  const zkTokens = ethers.utils.parseEther(tokensOut)

                  const currentReserve = await zKageContract.balanceOf(dexContract.address)
                  const initialReserve = ethers.utils.parseEther("100")

                  const zkTokensSwapped = initialReserve.sub(currentReserve)

                  expect(zkTokensSwapped.toString().substring(0, 15)).equals(
                      zkTokens.toString().substring(0, 15),
                      "zkage balance after swap should be as per AMM formula"
                  )
              })
          })

          describe("swap 0KAGE to ETH", () => {
              const numTokens = ethers.utils.parseEther("100")
              const numEth = ethers.utils.parseEther("10")
              const tokensExchanged = ethers.utils.parseEther("10")
              let balanceUserBeforeSwap = BigNumber.from("0")
              let balanceUserAfterSwap = BigNumber.from("0")
              let balancePoolBeforeSwap = BigNumber.from("0")
              let balancePoolAfterSwap = BigNumber.from("0")

              let balanceEthBeforeSwap = BigNumber.from("0")
              let balanceEthAfterSwap = BigNumber.from("0")
              let balanceEthPoolBeforeSwap = BigNumber.from("0")
              let balanceEthPoolAfterSwap = BigNumber.from("0")
              let gasConsumed = BigNumber.from("0")
              beforeEach(async () => {
                  const approveResponse = await zKageContract.approve(
                      dexContract.address,
                      numTokens.add(tokensExchanged)
                  )
                  await approveResponse.wait(1)

                  const initResponse = await dexContract.initializeDEX(numTokens, { value: numEth })
                  await initResponse.wait(1)

                  balanceUserBeforeSwap = await zKageContract.balanceOf(lpUser.address)
                  balancePoolBeforeSwap = await zKageContract.balanceOf(dexContract.address)

                  balanceEthBeforeSwap = await ethers.provider.getBalance(lpUser.address)
                  balanceEthPoolBeforeSwap = await ethers.provider.getBalance(dexContract.address)
                  const swapResponse = await dexContract.zeroKageToEth(tokensExchanged)
                  const swapReceipt = await swapResponse.wait(1)
                  balanceEthAfterSwap = await ethers.provider.getBalance(lpUser.address)
                  balanceEthPoolAfterSwap = await ethers.provider.getBalance(dexContract.address)
                  gasConsumed = swapReceipt.cumulativeGasUsed
              })

              it("Check ETH balance, 0KAGE->ETH", async () => {
                  // note below calculation is as per constant AMM formula
                  // eth Reserve * 997 * zKage Swapped / (1000 * zKage Reserve + 997 * eth Reserve)

                  const ethSwap = ((10 * 997 * 10) / (1000 * 100 + 997 * 10)).toString()
                  const ethSwapWei = ethers.utils.parseEther(ethSwap)

                  console.log("gas consumed", gasConsumed.toString())

                  expect(
                      balanceEthPoolBeforeSwap
                          .sub(balanceEthPoolAfterSwap)
                          .toString()
                          .substring(0, 15)
                  ).equals(
                      ethSwapWei.toString().substring(0, 15),
                      "Eth decrease in pool should be as per constant AMM formula"
                  )
                  //   console.log("test - eth before balance", balanceEthBeforeSwap.toString())
                  //   console.log("test - eth transferred", ethSwapWei.toString())
                  //   console.log("test - eth after balance", balanceEthAfterSwap.toString())

                  //   expect(balanceEthBeforeSwap.add(ethSwapWei).sub(gasConsumed).toString()).equals(
                  //       balanceEthAfterSwap.toString(),
                  //       "Eth balance after = Eth balance before + Eth transfer + gas consumed"
                  //   )
              })

              it("Check 0KAGE balance, 0KAGE->ETH", async () => {
                  balanceUserAfterSwap = await zKageContract.balanceOf(lpUser.address)
                  balancePoolAfterSwap = await zKageContract.balanceOf(dexContract.address)

                  expect(balanceUserBeforeSwap.sub(balanceUserAfterSwap).toString()).equals(
                      tokensExchanged.toString(),
                      "tokens balance diff = tokens transfered to DEX"
                  )

                  expect(balancePoolAfterSwap.sub(balancePoolBeforeSwap).toString()).equals(
                      balanceUserBeforeSwap.sub(balanceUserAfterSwap).toString(),
                      "token increase in DEX = token decrease in user wallet"
                  )
              })
          })
          /**
           * @notice test by having a new user 1 ETH and 10 0KAGE to LP
           * @dev tests - 1. total liquidity should increase 2. eth reserve in LP increase by 1 3. 0Kage reserve in LP increase by 10
           * @dev tests - 4 eth Reserve in user wallet drops by 1, 5. 0Kage reserve in user wallet decrease by 1
           * @dev 6 liquidity of user  ==  % of total liquidiy
           */
          describe("add liquidity", () => {
              let initial0KageTokens = ethers.utils.parseEther("100")
              let initialEthTokens = ethers.utils.parseEther("10")

              let new0KageLiquidity = ethers.utils.parseEther("10")
              let newEthLiquidity = ethers.utils.parseEther("1")

              let liquidityBeforeFunding = BigNumber.from(0)
              let liquidityAfterFunding = BigNumber.from(0)

              let ethBalanceBeforeLP = BigNumber.from(0)
              let ethBalanceAfterLP = BigNumber.from(0)
              let gasUsedForLP = BigNumber.from(0)

              let ethPoolBalanceBeforeLP = BigNumber.from(0)
              let ethPoolBalanceAfterLP = BigNumber.from(0)

              let tokenBalanceBeforeLP = BigNumber.from(0)
              let tokenBalanceAfterLP = BigNumber.from(0)

              let tokenPoolBalanceBeforeLP = BigNumber.from(0)
              let tokenPoolBalanceAfterLP = BigNumber.from(0)

              beforeEach(async () => {
                  // allow Dexcontract to draw 100 0Kage tokens for initializing
                  const approveResponse = await zKageContract.approve(
                      dexContract.address,
                      initial0KageTokens
                  )
                  await approveResponse.wait(1)

                  // initialize DEX with 10 Eth and 100 0Kage tokens
                  const initResponse = await dexContract.initializeDEX(initial0KageTokens, {
                      value: initialEthTokens,
                  })
                  await initResponse.wait(1)

                  liquidityBeforeFunding = await dexContract.getTotalLiquidity()
                  ethBalanceBeforeLP = await ethers.provider.getBalance(lpProvider.address)
                  ethPoolBalanceBeforeLP = await ethers.provider.getBalance(dexContract.address)
                  tokenPoolBalanceBeforeLP = await zKageContract.balanceOf(dexContract.address)
                  // fund a new wallet with 10 0KAGE tokens
                  const transferResponse = await zKageContract.transfer(
                      lpProvider.address,
                      new0KageLiquidity
                  )
                  await transferResponse.wait(1)
                  tokenBalanceBeforeLP = await zKageContract.balanceOf(lpProvider.address)

                  // now that lpProvider is funded, approve dex contract to spend 0KAGE tokens
                  const approvelpProviderResponse = await zKageContract
                      .connect(lpProvider)
                      .approve(dexContract.address, new0KageLiquidity)

                  // now provide liquidity to dex contract
                  const addLiquidityResponse = await dexContract
                      .connect(lpProvider)
                      .deposit({ value: newEthLiquidity })

                  const addLiquidityReceipt = await addLiquidityResponse.wait(1)
                  gasUsedForLP = addLiquidityReceipt.cumulativeGasUsed
                  liquidityAfterFunding = await dexContract.getTotalLiquidity()
              })

              it("total liquidity increase", async () => {
                  expect(liquidityBeforeFunding.mul(110).div(100).toString()).equals(
                      liquidityAfterFunding.toString(),
                      "liquidity should increase by 10%"
                  )
              })

              it("Eth decrease in depositors account", async () => {
                  ethBalanceAfterLP = await ethers.provider.getBalance(lpProvider.address)
                  console.log("eth before lp", ethBalanceBeforeLP.toString())
                  console.log("new eth liquidity", newEthLiquidity.toString())
                  console.log("eth after lp", ethBalanceAfterLP.toString())
                  console.log("gas used for lp", gasUsedForLP.toString())
                  expect(
                      ethBalanceBeforeLP.sub(newEthLiquidity).sub(gasUsedForLP).toString()
                  ).equals(
                      ethBalanceAfterLP.toString(),
                      "Eth balance of LP provided should decrease by 1 ETH adjusted for gas"
                  )
              })

              it("0KAGE decrease in depositors account", async () => {
                  tokenBalanceAfterLP = await zKageContract.balanceOf(lpProvider.address)
                  expect(tokenBalanceBeforeLP.sub(new0KageLiquidity).toString()).equals(
                      tokenBalanceAfterLP.toString(),
                      "token balance should reduce in lp providers account"
                  )
              })

              it("Eth increase in pool account", async () => {
                  ethPoolBalanceAfterLP = await ethers.provider.getBalance(dexContract.address)
                  expect(ethPoolBalanceBeforeLP.add(newEthLiquidity).toString()).equals(
                      ethPoolBalanceAfterLP.toString(),
                      "Pool balance should increase by 1 ETH"
                  )
              })

              it("0KAGE increase in pool account", async () => {
                  tokenPoolBalanceAfterLP = await zKageContract.balanceOf(dexContract.address)

                  expect(tokenPoolBalanceBeforeLP.add(new0KageLiquidity).toString()).equals(
                      tokenPoolBalanceAfterLP.toString(),
                      "0Kage balance should increase by 100 0KAGE"
                  )
              })

              it("LP Provider liquidity = 10% of LP user liquidity ", async () => {
                  const lpProviderLiquidity = await dexContract.getLiquidity(lpProvider.address)

                  const totalLiquidity = await dexContract.getTotalLiquidity()

                  const deployerLiquidity = await dexContract.getLiquidity(lpUser.address)

                  expect(totalLiquidity.toString()).equals(
                      deployerLiquidity.add(lpProviderLiquidity).toString(),
                      "total liquidity = liquidity by user + liquidity by new provider"
                  )
                  // rounding precision problem - I have used first 15 digits for compairosn
                  expect(lpProviderLiquidity.mul(10).toString().substring(0, 15)).equals(
                      deployerLiquidity.toString().substring(0, 15),
                      "lp provider share is 10% of deployer share in liquidity"
                  )
              })
          })

          describe("withdraw liquidity", () => {
              let initial0KageTokens = ethers.utils.parseEther("100")
              let initialEthTokens = ethers.utils.parseEther("10")

              let new0KageLiquidity = ethers.utils.parseEther("10")
              let newEthLiquidity = ethers.utils.parseEther("1")

              let liqToWithdraw = BigNumber.from(0)
              let ethToWithdraw = BigNumber.from(0) // we calculate this as per constant AMM formulas
              let tokenToWithdraw = BigNumber.from(0) // we calculate this as per constant AMM formulas
              let liquidityBeforeWithdrawal = BigNumber.from(0)
              let liquidityAfterWithdrawal = BigNumber.from(0)

              let totalLiquidityBeforeWithdrawal = BigNumber.from(0)
              let totalLiquidityAfterWithdrawal = BigNumber.from(0)

              let ethPoolBalanceBeforeWithdrawal = BigNumber.from(0)
              let ethPoolBalanceAfterWithdrawal = BigNumber.from(0)

              let tokenBalanceBeforeWithdrawal = BigNumber.from(0)
              let tokenBalanceAfterWithdrawal = BigNumber.from(0)

              let tokenPoolBalanceBeforeWithdrawal = BigNumber.from(0)
              let tokenPoolBalanceAfterWithdrawal = BigNumber.from(0)

              beforeEach(async () => {
                  const approveTx = await zKageContract.approve(
                      dexContract.address,
                      initial0KageTokens
                  )
                  await approveTx.wait(1)

                  // step 1: deployer initializes dex (100 0KAGE + 10 ETH)
                  const initTx = await dexContract.initializeDEX(initial0KageTokens, {
                      value: initialEthTokens,
                  })
                  await initTx.wait(1)

                  // step 2: provider adds liquidity  (10 0KAGE + 1 ETH)
                  const transferTx = await zKageContract.transfer(
                      lpProvider.address,
                      new0KageLiquidity
                  )
                  await transferTx.wait(1)

                  const approveProvideTx = await zKageContract
                      .connect(lpProvider)
                      .approve(dexContract.address, new0KageLiquidity)
                  await approveProvideTx.wait(1)

                  const addLiquidityTx = await dexContract
                      .connect(lpProvider)
                      .deposit({ value: newEthLiquidity })
                  await addLiquidityTx.wait(1)

                  liquidityBeforeWithdrawal = await dexContract.getLiquidity(lpProvider.address)
                  totalLiquidityBeforeWithdrawal = await dexContract.getTotalLiquidity()
                  ethPoolBalanceBeforeWithdrawal = await ethers.provider.getBalance(
                      dexContract.address
                  )
                  tokenPoolBalanceBeforeWithdrawal = await zKageContract.balanceOf(
                      dexContract.address
                  )

                  liqToWithdraw = liquidityBeforeWithdrawal.mul(5).div(10)
                  // we are withdrawing 50% of total liquidity provider

                  ethToWithdraw = ethPoolBalanceBeforeWithdrawal
                      .mul(liqToWithdraw)
                      .div(totalLiquidityBeforeWithdrawal)
                  tokenToWithdraw = tokenPoolBalanceBeforeWithdrawal
                      .mul(liqToWithdraw)
                      .div(totalLiquidityBeforeWithdrawal)

                  // step 3: provider withdraws liquidity partially (5 0KAGE + 0.5 ETH)
                  const withdrawLiquidityTx = await dexContract.withdraw(liqToWithdraw)
                  await withdrawLiquidityTx.wait(1)

                  liquidityAfterWithdrawal = await dexContract.getLiquidity(lpProvider.address)
                  ethPoolBalanceAfterWithdrawal = await ethers.provider.getBalance(
                      dexContract.address
                  )
                  tokenPoolBalanceAfterWithdrawal = await zKageContract.balanceOf(
                      dexContract.address
                  )
              })

              it("total liquidity decrease", async () => {
                  totalLiquidityAfterWithdrawal = await dexContract.getTotalLiquidity()
                  expect(totalLiquidityBeforeWithdrawal.sub(liqToWithdraw).toString()).equals(
                      totalLiquidityAfterWithdrawal.toString(),
                      "total liquidity reduces by amount of liquidity withdrawn"
                  )
              })

              it("Eth decreaase from pool", async () => {
                  expect(ethPoolBalanceBeforeWithdrawal.sub(ethToWithdraw).toString()).equals(
                      ethPoolBalanceAfterWithdrawal.toString(),
                      "Eth balance in pool should drop proportional to LP token % of overall pool"
                  )
              })

              it("0Kage decrease from pool", async () => {
                  expect(tokenPoolBalanceBeforeWithdrawal.sub(tokenToWithdraw).toString()).equals(
                      tokenPoolBalanceAfterWithdrawal.toString(),
                      "Token balance in pool proportional to LP token % of overall pool"
                  )
              })
          })

          describe("events testing", () => {
              let initial0KageTokens = ethers.utils.parseEther("100")
              let initialEthTokens = ethers.utils.parseEther("10")

              beforeEach(async () => {
                  const approveTx = await zKageContract.approve(
                      dexContract.address,
                      initial0KageTokens
                  )
                  await approveTx.wait(1)

                  // step 1: deployer initializes dex (100 0KAGE + 10 ETH)
                  const initTx = await dexContract.initializeDEX(initial0KageTokens, {
                      value: initialEthTokens,
                  })
                  await initTx.wait(1)
              })
              it("test EthToZeroKage event emission", async () => {
                  const ethSent = ethers.utils.parseEther("0.1")
                  await expect(
                      dexContract.ethToZeroKage({
                          value: ethSent,
                      })
                  )
                      .to.emit(dexContract, "EthToZeroKage")
                      .withArgs(lpUser.address, ethSent, () => true)
              })

              it("test ZeroKageToEth event emission", async () => {
                  const zKageSent = ethers.utils.parseEther("1")
                  const approveTx = await zKageContract.approve(dexContract.address, zKageSent)
                  await approveTx.wait(1)

                  await expect(dexContract.zeroKageToEth(zKageSent))
                      .to.emit(dexContract, "ZeroKageToEth")
                      .withArgs(lpUser.address, zKageSent, () => true)
              })

              it("test AddLiquidity event emission", async () => {
                  const zKageAdded = ethers.utils.parseEther("10")
                  const ethAdded = ethers.utils.parseEther("1")

                  const totalLiq = await dexContract.getTotalLiquidity()
                  const liqDelta = totalLiq.mul(10).div(100) // liquidity delta = 0.1 * total liquidity, since we are adding 10% of total pool

                  // transfer zKage to lpprovide
                  const transferTx = await zKageContract.transfer(lpProvider.address, zKageAdded)
                  await transferTx.wait(1)

                  // approve spending for lp provider
                  const approveTx = await zKageContract
                      .connect(lpProvider)
                      .approve(dexContract.address, zKageAdded)
                  await approveTx.wait(1)

                  // lp provider deposits liquidity
                  await expect(dexContract.connect(lpProvider).deposit({ value: ethAdded }))
                      .to.emit(dexContract, "AddLiquidity")
                      .withArgs(lpProvider.address, liqDelta, ethAdded, zKageAdded)
              })

              it("test withdrawLiquidity event emission", async () => {
                  const totalLiq = await dexContract.getTotalLiquidity()

                  const liqWithdraw = totalLiq.div(10) // 10% of liquidity is being withdrawn

                  const ethWithdraw = (await ethers.provider.getBalance(dexContract.address)).div(
                      10
                  )
                  const tokenWithdraw = (await zKageContract.balanceOf(dexContract.address)).div(10)

                  await expect(dexContract.withdraw(liqWithdraw))
                      .to.emit(dexContract, "RemoveLiquidity")
                      .withArgs(
                          lpUser.address,
                          liqWithdraw,
                          () => true,
                          () => true
                      )
              })
          })

          describe("all errors testing", () => {
              it("eth->0Kage swap errors", async () => {
                  // transfer eth > wallet balance
              })

              it("0Kage -> eth swap errors", async () => {
                  // transfer 0Kage > wallet balance
                  // transfer 0Kage without approving to dex
              })

              it("add liquidity errors", async () => {
                  // add eth > wallet balance
                  // dont approve 0Kage before adding liquidity
                  // dont have enough 0Kage tokens to complete transfer
              })

              it("withdraw liquidity errors", async () => {
                  // withdraw liquidity > balance
              })
          })
      })
