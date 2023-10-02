const contractInheritHandler = {
    get(target, p, receiver) {
        return target[p] ? Reflect.get(target, p) : Reflect.get(target._parent, p);
    },
    // TODO: allow to modify self value
    set(target, p, value, receiver) {
        throw new TypeError(target._name + ' is readonly');
    },
    deleteProperty(target, p) {
        throw new TypeError(target._name + ' is readonly');
    },
};

module.exports = {
    contractInheritHandler
}