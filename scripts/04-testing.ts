import { ethers, network, getNamedAccounts } from "hardhat"
import { DEX } from "../typechain-types"

const testingScript = async () => {
    console.log("Some basic testing...")
    const accounts = await ethers.getSigners()
    const deployer = accounts[0].address

    console.log("deployer address", deployer)
    const dexContract: DEX = await ethers.getContract("DEX", deployer)

    const totalLiq = await dexContract.getTotalLiquidity()
    console.log("total liquidity", ethers.utils.formatEther(totalLiq))

    const accountLiq = await dexContract.getLiquidity(deployer)
    console.log(`liquidity of ${deployer} is ${ethers.utils.formatEther(accountLiq)}`)
}

testingScript()
    .then(() => process.exit(0))
    .catch((e) => process.exit(1))
