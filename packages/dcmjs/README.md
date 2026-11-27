# dcmjs

`dcmjs` 1.x is the unscoped name of
[`@dcmjs-org/dcmjs`](https://www.npmjs.com/package/@dcmjs-org/dcmjs). Each
entry re-exports the same entry of `@dcmjs-org/dcmjs`, at the same version:
`dcmjs`, `dcmjs/eventStream`, `dcmjs/media`, `dcmjs/encapsulated`,
`dcmjs/image` and `dcmjs/dictionary`. An application that uses both names
gets one copy of the code.

```bash
npm install dcmjs          # 1.x
npm install dcmjs@0.x      # the 0.x maintenance line (fixes only)
```

The 1.x code, its documentation and the migration guide from 0.x are in
the [dcmjs repository](https://github.com/dcmjs-org/dcmjs), on the `main`
branch.

For a `<script>` tag, use the UMD build of `@dcmjs-org/dcmjs`:
`https://unpkg.com/@dcmjs-org/dcmjs`. This package has no UMD build.
