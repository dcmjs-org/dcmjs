# ArrayBufferExpanderFilter

## Overview

The `ArrayBufferExpanderFilter` is a filter for `DicomMetadataListener` that converts `ArrayBuffer[]` child values into expanded `listener.startObject([])` and `value(fragment)` calls. This is particularly useful when working with compressed or fragmented pixel data that may be delivered as an array of ArrayBuffers.

## Purpose

When the `AsyncDicomReader` reads compressed pixel data, it can deliver frame data in two formats:

1. **Compact format**: A single `ArrayBuffer[]` value passed to `listener.value()`
2. **Expanded format**: A sequence of calls:
   - `listener.startObject([])`
   - Multiple `listener.value(fragment)` calls (one per ArrayBuffer)
   - `listener.pop()`

The `ArrayBufferExpanderFilter` automatically converts format #1 into format #2, ensuring consistent handling regardless of how the reader delivers the data.

**Important**: 
- Each frame is ALWAYS delivered as an array (ArrayBuffer[]), even for single frames
- Video transfer syntaxes are handled as though they were a single frame
- Binary data can be delivered fragmented - a single frame may be split across multiple ArrayBuffer fragments
- Multiple fragments are combined into one array per frame
- When the `AsyncDicomReader` delivers `ArrayBuffer[]` directly to `value()`, it does NOT call `startObject([])`/`pop()` around them. The expander filter makes those calls to properly represent the array structure, then captures the result and assigns it to the tag's `Value` field.

## Usage

### Basic Usage

```javascript
import { AsyncDicomReader } from 'dcmjs';
import { DicomMetadataListener, ArrayBufferExpanderFilter } from 'dcmjs/utilities';

async function readDicomWithExpansion(arrayBuffer) {
  const reader = new AsyncDicomReader();
  reader.stream.setData(arrayBuffer);
  
  // Create listener with the expander filter
  const listener = new DicomMetadataListener(ArrayBufferExpanderFilter);
  
  // Read the file using the listener
  await reader.readFile({ listener });
  
  // Access the result
  return listener.dict;
}
```

### Combining with Custom Filters

You can combine the expander with custom filters to process fragments individually:

```javascript
// Create a custom filter to track fragments
const fragmentTrackingFilter = {
  fragmentCount: 0,
  fragmentSizes: [],
  
  value(next, val) {
    if (val instanceof ArrayBuffer || ArrayBuffer.isView(val)) {
      this.fragmentCount++;
      this.fragmentSizes.push(val.byteLength);
      console.log(`Processing fragment ${this.fragmentCount}, size: ${val.byteLength}`);
    }
    return next(val);
  }
};

async function readWithFragmentTracking(arrayBuffer) {
  const reader = new AsyncDicomReader();
  reader.stream.setData(arrayBuffer);
  
  // Create listener with both filters
  // ArrayBufferExpanderFilter runs first to expand, then fragmentTrackingFilter sees individual fragments
  const listener = new DicomMetadataListener(
    ArrayBufferExpanderFilter,
    fragmentTrackingFilter
  );
  
  await reader.readFile({ listener });
  
  console.log(`Total fragments: ${listener.filters[1].fragmentCount}`);
  console.log(`Fragment sizes:`, listener.filters[1].fragmentSizes);
  
  return listener.dict;
}
```

### Processing Each Frame Fragment

This is useful for streaming or progressive decoding:

```javascript
// Create a streaming filter to process fragments as they arrive
function createStreamingFilter(onFrameFragment) {
  let inPixelData = false;
  let currentFrameFragments = [];
  
  return {
    addTag(next, tag, tagInfo) {
      // Track when we're processing pixel data
      inPixelData = tag === '7FE00010'; // Pixel Data tag
      return next(tag, tagInfo);
    },
    
    startObject(next, dest) {
      if (inPixelData && Array.isArray(dest)) {
        // Starting a new frame with multiple fragments
        currentFrameFragments = [];
      }
      return next(dest);
    },
    
    value(next, val) {
      if (inPixelData && (val instanceof ArrayBuffer || ArrayBuffer.isView(val))) {
        // Process each fragment as it arrives
        onFrameFragment(val);
        currentFrameFragments.push(val);
      }
      return next(val);
    },
    
    pop(next) {
      if (inPixelData && currentFrameFragments.length > 0) {
        // Finished processing all fragments for this frame
        console.log(`Completed frame with ${currentFrameFragments.length} fragments`);
        currentFrameFragments = [];
      }
      return next();
    }
  };
}

async function streamFrameFragments(arrayBuffer) {
  const reader = new AsyncDicomReader();
  reader.stream.setData(arrayBuffer);
  
  // Create streaming filter
  const streamingFilter = createStreamingFilter((fragment) => {
    console.log(`Received fragment of ${fragment.byteLength} bytes`);
    // Process fragment immediately (e.g., send to decoder)
  });
  
  // Combine expander with streaming filter
  const listener = new DicomMetadataListener(
    ArrayBufferExpanderFilter,
    streamingFilter
  );
  
  await reader.readFile({ listener });
  
  return listener.dict;
}
```

## How It Works

The `ArrayBufferExpanderFilter` is a filter object that integrates with `DicomMetadataListener`'s filter chain. It provides a `value()` filter method that:

1. When `value(next, v)` is called, it checks if the value is an array of ArrayBuffers
2. If yes:
   - Saves the current tag context (via `this.current`)
   - Calls `this.startObject([])` to create a new array context
   - Calls `this.value(fragment)` for each ArrayBuffer in the array
   - Calls `this.pop()` to get the resulting array structure
   - Assigns that array to the tag's `Value` field
3. If no, passes the value through to the next filter by calling `next(v)`

When used as a filter in `DicomMetadataListener`, `this` refers to the listener instance, giving the filter access to all listener methods and properties.

This ensures that any subsequent filters or processing logic always receives individual fragments through the proper `startObject([])/value/pop` sequence, regardless of how the `AsyncDicomReader` delivers them.

The resulting data structure will have a `Value` array containing the individual fragments. Note that each frame is always delivered as an array, and binary data can be fragmented across multiple ArrayBuffer chunks.

## Detection Logic

The listener considers a value to be an `ArrayBuffer[]` if:
- It is an `Array`
- All elements are either `ArrayBuffer` instances or typed array views (like `Uint8Array`)

This is checked using the `_isArrayBufferArray()` helper method:

```javascript
_isArrayBufferArray(arr) {
    return arr.every(
        item => item instanceof ArrayBuffer || ArrayBuffer.isView(item)
    );
}
```

## Use Cases

### 1. Fragmented Compressed Frames
Some compressed formats split single frames into multiple fragments:

```javascript
// Without expander: might receive ArrayBuffer[]
// With expander: always receives individual ArrayBuffer calls
```

### 2. Multiframe Images with Offset Table
When reading multiframe compressed images with an offset table, child elements may be delivered as arrays.

### 3. Video Sequences
Video frames stored as arrays of fragments can be processed consistently.

### 4. Bulkdata Streaming
When implementing custom bulkdata storage, individual fragments can be written to separate files or streams.

## API Reference

### Filter Object

`ArrayBufferExpanderFilter` is a plain JavaScript object (not a class) that can be passed to the `DicomMetadataListener` constructor.

```javascript
const listener = new DicomMetadataListener(ArrayBufferExpanderFilter);
```

### Filter Method

The filter provides one method:

#### `value(next, v)`

Filter method that intercepts value calls.

**Parameters:**
- `next` (Function): The next function in the filter chain to call for pass-through
- `v` (any): The value being set

**Behavior:**
- If `v` is an `ArrayBuffer[]`, expands it into `startObject([])/value/pop` sequence
- Otherwise, calls `next(v)` to pass through to the next filter

**Context:**
When called, `this` refers to the `DicomMetadataListener` instance, providing access to:
- `this.current` - Current parsing state
- `this.startObject([])` - Start array method (arrays are created via `startObject([])`)
- `this.value()` - Value method
- `this.pop()` - Pop method
- `this.fmi` - File Meta Information
- `this.dict` - Dataset dictionary
- All other listener methods and properties

## Combining with Other Patterns

### With Multiple Filters

The `ArrayBufferExpanderFilter` can be easily combined with other filters in the `DicomMetadataListener`:

```javascript
const loggingFilter = {
  value(next, v) {
    console.log('Processing value:', v);
    return next(v);
  }
};

// Filters are applied in order: expander runs first, then logging
const listener = new DicomMetadataListener(
  ArrayBufferExpanderFilter,
  loggingFilter
);
```

### Filter Ordering

The order of filters matters. Filters are executed in the order they are passed to the constructor:

```javascript
// ArrayBufferExpanderFilter runs first to expand arrays,
// then customFilter sees the individual fragments
const listener = new DicomMetadataListener(
  ArrayBufferExpanderFilter,
  customFilter
);

// If you want customFilter to see the original ArrayBuffer[],
// put it before the expander
const listener2 = new DicomMetadataListener(
  customFilter,
  ArrayBufferExpanderFilter
);
```

## Performance Considerations

- **Minimal Overhead**: The expander only adds overhead when checking array types
- **Memory Efficient**: No additional memory allocation; just changes the calling sequence
- **Streaming Friendly**: Allows downstream listeners to process fragments immediately

## Limitations

1. **Only Expands ArrayBuffer Arrays**: Other array types (e.g., `[string, string]`) are not expanded
2. **One Level Deep**: Does not recursively expand nested structures
3. **Requires Complete Array**: Cannot partially expand; receives entire array at once

## See Also

- [AsyncDicomReader Skill Guide](./AsyncDicomReader-skill.md)
- [DicomMetadataListener](../src/utilities/DicomMetadataListener.js)
- DICOM Standard PS3.5 (Encapsulated Format)
