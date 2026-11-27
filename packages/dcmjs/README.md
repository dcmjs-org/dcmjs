# dcmjs

`dcmjs` 1.x is the unscoped name of
[`@dcmjs-org/dcmjs`](https://www.npmjs.com/package/@dcmjs-org/dcmjs). Each
entry re-exports the same entry of `@dcmjs-org/dcmjs`:
`dcmjs`, `dcmjs/eventStream`, `dcmjs/media`, `dcmjs/encapsulated`,
`dcmjs/image` and `dcmjs/dictionary`. `dcmjs@1.N` depends on
`@dcmjs-org/dcmjs@^1.N`, so an application that uses both names gets one copy
of the code when one version satisfies both.

```bash
npm install dcmjs          # 1.x
npm install dcmjs@0.x      # the 0.x maintenance line (fixes only; npm dist-tag release-0.x)
```

The 1.x code, its documentation and the migration guide from 0.x are in
the [dcmjs repository](https://github.com/dcmjs-org/dcmjs), on the `main`
branch.

For a `<script>` tag, `https://unpkg.com/dcmjs` serves a copy of the UMD
build of `@dcmjs-org/dcmjs`, which sets the global `dcmjs`. The copy is not
part of the module entries, so a bundler still gets one copy of the code.
