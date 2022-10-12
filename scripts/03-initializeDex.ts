import { ethers, getNamedAccounts, network } from "hardhat"
import { developmentChains } from "../helper-hardhat-config"
import { DEX, ERC20 } from "../typechain-types"
import { GOERLI_ZEROKAGE_ADDRESS } from "../constants"

const initializeDex = async () => {
    // run this script to initialize DEX

    // for localhost -> we initialize with 1000 0KAGE -> 100 ETH (1:10)

    // for goerli -> we initialize with 0.1 0KAGE -> 0.01 ETH (1:10)
    // keeping levels low because goerli eth is not easy to get
    const isLocalChain = developmentChains.includes(network.name)
    const initialEth = isLocalChain ? "100" : "0.01"
    const initialTokens = isLocalChain ? "1000" : "0.1"

    const initialEthInWei = ethers.utils.parseEther(initialEth)
    const initialTokensInWei = ethers.utils.parseEther(initialTokens)

    const { deployer } = await getNamedAccounts()
    const dexContract: DEX = await ethers.getContract("DEX", deployer)
    let zKageContract: ERC20

    if (isLocalChain) {
        zKageContract = await ethers.getContract("ZeroKageMock")
    } else {
        zKageContract = await ethers.getContractAt("ZeroKage", GOERLI_ZEROKAGE_ADDRESS)
    }

    // give approval to dex contract to spend 0Kage
    const approveTx = await zKageContract.approve(dexContract.address, initialTokensInWei)
    await approveTx.wait(1)

    // once approved, initialize dex
    const initTx = await dexContract.initializeDEX(initialTokensInWei, { value: initialEthInWei })
    const initTxReceipt = await initTx.wait(1)

    console.log(`DEX initialized on ${network.name} network`)
    console.log(`Txn id ${initTxReceipt.transactionHash}`)
    console.log("______________________")
}

initializeDex()
    .then(() => {
        process.exit(0)
    })
    .catch((e) => {
        console.log(e)
        process.exit(1)
    })
