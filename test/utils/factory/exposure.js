const { toBN } = require('web3-utils');
const Exposure = artifacts.require('Exposure');

const makerUSDCExposure = toBN(3119);

const newExposure = async (controller, insurance) => {
    const governance = await controller.owner();
    const exposure = await Exposure.new();
    await exposure.setController(controller.address, { from: governance });
    await exposure.setMakerUSDCExposure(
        makerUSDCExposure, { from: governance });

    return exposure;
};

module.exports = {
    newExposure,
};