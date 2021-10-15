/**
 * Adds accessors (set/get) to dest for every property in src.
 */
const addAccessors = (dest, src) => {
    Object.keys(src).forEach(key => {
        Object.defineProperty(dest, key, {
            get: () => {
                return src[key];
            },
            set: v => {
                src[key] = v;
            }
        });
    });
};

export default addAccessors;
