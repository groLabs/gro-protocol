const PnL = artifacts.require('PnL');

const newPnL = async (controller, pwrd, gvt) => {
    const governance = await controller.owner();
    const pnl = await PnL.new(pwrd, gvt, 0, 0);
    await pnl.setController(controller.address, { from: governance });

    return pnl;
};

module.exports = {
    newPnL,
};
