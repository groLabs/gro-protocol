const IERC20Detailed = artifacts.require('IERC20Detailed');
const ZERO = '0x0000000000000000000000000000000000000000';
const ForceSend = artifacts.require('ForceSend'); // contracts/mocks/abi
const { BN, toBN, toWei } = require('web3-utils');

const getDetailed = async (address) => {
    const tokenDetailed = await IERC20Detailed.at(address);
    const name = await tokenDetailed.name();
    const symbol = await tokenDetailed.symbol();
    const decimals = await tokenDetailed.decimals();
    return { address, name, symbol, decimals };
}

let mainnetBank;

async function getMainnetBank() {
    if (mainnetBank === undefined) {
        const bank = '0xbebc44782c7db0a1a60cb6fe97d0b483032ff1c7';
        try {
            await network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [bank],
            });
        } catch (e) {
            console.error(e);
        }
        const forceSend = await ForceSend.new();
        await forceSend.go(bank, { value: toWei('2', 'ether') });
        mainnetBank = bank;
    }
    return mainnetBank;
}

const mintToken = async (token, recipient, amount, mainnet) => {
    if (mainnet) {
        const bank = await getMainnetBank();
        await token.transfer(recipient, amount, { from: bank });
    } else {
        await token.mint(recipient, amount);
    }
}

const burnToken = async (token, holder, amount, mainnet) => {
    if (mainnet) {
        const forceSend = await ForceSend.new();
        await forceSend.go(holder, { value: toWei('2', 'ether') });
        await network.provider.request({
            method: "hardhat_impersonateAccount",
            params: [holder],
        });
        const bank = await getMainnetBank();
        await token.transfer(bank, amount, { from: holder });
    } else {
        await token.burn(holder, amount);
    }
}

const tokens = {
        dai: { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', name: "Dai", symbol: "DAI", decimals: 18, mappingSlot: '0x2'  },
        usdc: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: "USD Coin", symbol: "USDC", decimals: 6, mappingSlot: '0x9'  },
        usdt: { address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', name: "Tether USD", symbol: "USDT", decimals: 6, mappingSlot: '0x2'  },
        weth: { address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', name: "Wrapped ether", symbol: "ETH", decimals: 18, mappingSlot: '0x3'  },
};

function getBalanceOfSlotSolidity(mappingSlot, address) {
        return ethers.utils.hexStripZeros(ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['address', 'uint256'], [address, mappingSlot])));

}

async function setBalance(tokenSymbol, to, amount) {
        const amountToMint = web3.utils.padLeft(ethers.utils.parseUnits(amount, tokens[tokenSymbol].decimals ).toHexString(), 64);
        const slot = getBalanceOfSlotSolidity(tokens[tokenSymbol].mappingSlot, to);
        await hre.ethers.provider.send('hardhat_setStorageAt', [tokens[tokenSymbol].address, slot, amountToMint]);
}

module.exports = {
    getDetailed,
    mintToken,
    burnToken,
    setBalance,
};
