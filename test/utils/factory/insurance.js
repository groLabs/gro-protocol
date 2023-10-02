const { toBN } = require('web3-utils');
const Insurance = artifacts.require('Insurance');
const { newExposure } = require('./exposure');
const { newAllocation } = require('./allocation');
const { contractInheritHandler } = require('./internal-utils');

const exposureBufferRebalance = toBN(50);

const newInsurance = async (controller) => {
    const governance = await controller.owner();
    const insurance = await Insurance.new();
    await insurance.setController(controller.address, { from: governance });
    await insurance.setExposureBufferRebalance(
        exposureBufferRebalance, { from: governance });

    const exposure = await newExposure(controller, insurance);
    const allocation = await newAllocation(controller, insurance);
    await insurance.setExposure(exposure.address, { from: governance });
    await insurance.setAllocation(allocation.address, { from: governance });
    await insurance.addToWhitelist(governance, { from: governance });

    const obj = {
        _parent: insurance,
        _name: 'Insurance',
        exposure: exposure,
        allocation: allocation,
        parent: () => { return obj._parent; },
        batchSetUnderlyingTokensPercents: async (percents) => {
            await insurance.setUnderlyingTokenPercents(percents, { from: governance });
        },
    };

    return new Proxy(obj, contractInheritHandler);
};

module.exports = {
    newInsurance,
};
