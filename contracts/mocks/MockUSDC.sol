// SPDX-License-Identifier: AGPLv3
pragma solidity >=0.6.0 <0.7.0;

import "./MockERC20.sol";

contract MockUSDC is MockERC20 {
    constructor() public ERC20("USDC", "USDC") {
        _setupDecimals(6);
    }
    
    function faucet() external override {
        require(!claimed[msg.sender], 'Already claimed');
        claimed[msg.sender] = true;
        _mint(msg.sender, 1E10);
    }
}
