const { toBN } = require('web3-utils');
const Allocation = artifacts.require('Allocation');


const newAllocation = async (controller, insurance) => {
    const governance = await controller.owner();
    const allocation = await Allocation.new();
    await allocation.setController(controller.address, { from: governance });

    return allocation;
};

module.exports = {
    newAllocation,
};
