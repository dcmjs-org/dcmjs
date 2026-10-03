// Project-wide Babel configuration. This used to be a relative .babelrc,
// but relative configs stop applying at package.json boundaries, so the
// files under packages/*/src would not be transformed for Jest. A root
// babel.config.js applies to the whole workspace.
module.exports = {
    presets: [
        [
            "@babel/preset-env",
            {
                targets: {
                    browsers: ["ie 11"]
                }
            }
        ]
    ]
};
