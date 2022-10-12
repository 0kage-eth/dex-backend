import { ethers, network, getNamedAccounts } from "hardhat"
import { DEX } from "../typechain-types"

const removeLiquidity = async () => {
    console.log("Some basic testing...")
    const accounts = await ethers.getSigners()
    const deployer = accounts[0].address

    console.log("deployer address", deployer)
    const dexContract: DEX = await ethers.getContract("DEX", deployer)

    const totalLiq = await dexContract.getTotalLiquidity()
    console.log("BEFORE: total liquidity", ethers.utils.formatEther(totalLiq))

    const accountLiq = await dexContract.getLiquidity(deployer)
    console.log(`BEFORE: liquidity of ${deployer} is ${ethers.utils.formatEther(accountLiq)}`)

    const remLiq = await dexContract.withdraw(ethers.utils.parseEther("1"))
    const remLiqTx = await remLiq.wait(1)

    const totalLiqAfter = await dexContract.getTotalLiquidity()
    console.log("AFTER: total liquidity", ethers.utils.formatEther(totalLiqAfter))

    const accountLiqAfter = await dexContract.getLiquidity(deployer)
    console.log(`AFTER: liquidity of ${deployer} is ${ethers.utils.formatEther(accountLiqAfter)}`)
}

removeLiquidity()
    .then(() => process.exit(0))
    .catch((e) => process.exit(1))
