# Gro Protocol

## Prepare local enviroment

1. install `nodejs`, refer to [nodejs](https://nodejs.org/en/)
2. install `yarn`, refer to [yarn](https://classic.yarnpkg.com/en/)
3. install `Ganache`, refer to [Ganache](https://www.trufflesuite.com/ganache)
4. install `vyper`, refer to [vyper](https://vyper.readthedocs.io/en/stable/installing-vyper.html)

### install vyper for mac
``` shell
brew install pyenv
echo -e 'if command -v pyenv 1>/dev/null 2>&1; then\n  eval "$(pyenv init -)"\nfi' >> ~/.bash_profile
Restart shell
pyenv install 3.6.12
pyenv global 3.6.12
pip3 install vyper
```

## Test

1. run `yarn install` in workspace root folder
3. run `npx hardhat test` command in terminal

## Hardhat command

1. npx hardhat compile: compile the contracts
2. npx hardhat test: run the test cases under test folder

more infomation can refer to [hardhat](https://hardhat.org/getting-started/#quick-start)

## Running locally
Unless a forking varialbe is specified in the hardhat config (requires node access to be run), the system
will deploy on a hardhat local chain (Same thing applies if a local ganache chain is used). 
Some test (smoke test with the word mainnet in the title) arent supposed to complete on a local branch,
as they depend on interactions with external contracts.

Example of hardhat.config setup of locally deployed chain (ganache)
```
localhost: {
  url: 'http://127.0.0.1:8545',
  gas: 12000000,
  blockGasLimit: 12000000
},                        
```

 - test factory will deploy mock contracts instead of using the real counter part where possible (e.g stablecoins, oracles, curve pool)

Exhausive list of tests that wont pass on localy deployed intance.

 smoke-mainnet-strategy-curveXPool.js
 smoke-mainnet-strategy-genLender.js
 smoke-mainnet-strategy-harvest.js

## Running on forked chain
If a forked chain (mainnet) is specified, the test factory will not deloy any mocks, but rather use the mainnet counterparts of external dependencies.

All tests are expected to pass on a mainnet fork.

Example of hardhat.config setup of forked mainnet using alchemy node
```
hardhat: {
  forking: { url: "https://eth-mainnet.alchemyapi.io/v2/EiZDRdakYiF2yish4tYa9F0aodR9z3Yp" },
  gas: 12000000,
  blockGasLimit: 0x1fffffffffffff,
  allowUnlimitedContractSize: true,                   
  timeout: 1800000,
},                          
```

## Dependencies

Hardhat v2.1.1

Solidity - 0.6.8, 0.6.12 (solc-js)

Ganache CLI v6.10.2 (ganache-core: 2.11.3) or Ganache UI v2.5.4 (2.5.4.1367) (Optional)

Node v14.0.0

Vyper 0.2.8

Web3.js v1.2.1

yarn 1.22.5

