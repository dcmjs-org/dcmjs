// Project-wide babel config: only declares where package-level .babelrc files
// are honored (monorepo). Presets stay in each package's .babelrc.
module.exports = {
    babelrcRoots: [".", "./packages/*"]
};
