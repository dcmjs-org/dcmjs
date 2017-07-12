
export default {
	entry: 'src/dcmjs.js',
	indent: '\t',
	sourceMap: true,
	targets: [
		{
			format: 'umd',
			moduleName: 'DCMJS',
			dest: 'build/dcmjs.js'
		},
	]
};
