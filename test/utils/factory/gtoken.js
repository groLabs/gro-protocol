const NonRebasingGToken = artifacts.require('NonRebasingGToken');
const RebasingGToken = artifacts.require('RebasingGToken');
const { encodeCall } = require('../common-utils');

const newGvtToken = async (governance, upgradable) => {
    let gvt = await NonRebasingGToken.new('GVT', 'GVT');

    return gvt;
};

const newPwrdToken = async (governance, upgradable) => {
    let pwrd = await RebasingGToken.new('PWRD', 'PWRD');

    return pwrd;
};

module.exports = {
    newGvtToken,
    newPwrdToken,
};
