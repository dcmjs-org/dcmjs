# Migration Guide for Breaking Changes

## v 0.50.1 to higher

After version 0.50.1, we introduced a breaking change to `WriteBufferStream` and `ReadBufferStream`.

### What Changed

- `ReadBufferStream`: Constructor signature changed from
```js
constructor(
        buffer,
        littleEndian = false,
        options = {
            start: null,
            stop: null,
            noCopy: false
        },
        encoding = defaultDICOMEncoding
    )
```
to 
```js
constructor(
    buffer,
    options = {
        start: null,
        stop: null,
        encoding: defaultDICOMEncoding,
        noCopy: false,
        littleEndian: true
    }
)
```

- `WriteBufferStream`: Constructor signature changed from
```js
constructor(defaultSize, options = null)
```
to
```js
constructor(options = null)
```

### Notes

Essentially, the options that used to be separate parameters were moved into the flexible `options` object.

For reading situations, the `littleEndian` and `encoding` options are now in that options object. Moving forward, any 
new parameters will be introduced as options here.

For writing situations, the `defaultSize` parameter was moved into the options object. 

In all situations, the legacy usage of the constructor will fire a warning reminding you of the change to prompt you to 
update your usage of the library.
