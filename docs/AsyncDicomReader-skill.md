# AsyncDicomReader Skill Guide

## Overview

The `AsyncDicomReader` is an asynchronous binary DICOM file reader that provides streaming capabilities for parsing DICOM files. It's designed to handle
large DICOM files efficiently by reading and processing data incrementally rather than loading entire files into memory at once.

## Key Features

- **Asynchronous/Streaming**: Reads DICOM files incrementally using async/await patterns
- **Memory Efficient**: Uses buffer streaming with automatic clearing to reduce memory footprint
- **Multiple Transfer Syntaxes**: Supports Explicit Little Endian, Explicit Big Endian, and Implicit Little Endian as well as compressed syntaxes.
- **Pixel Data Handling**: Handles both compressed and uncompressed pixel data
- **Sequence Support**: Properly parses DICOM sequences with defined and undefined lengths
- **Character Set Support**: Automatically handles different character encodings, but not multiple character encodings.
- **Error Handling**: Configurable error handling for malformed files

## Current Limitations

- Files must contain the standard DICM preamble
- Interface is preliminary and subject to change

## Basic Usage

### Reading a Complete DICOM File

```javascript
import { AsyncDicomReader } from 'dcmjs';

async function readDicomFile(arrayBuffer) {
  // Create reader instance
  const reader = new AsyncDicomReader();
  
  // Set the data source
  reader.stream.setData(arrayBuffer);
  
  // Read the entire file
  await reader.readFile();
  
  // Access the metadata and dataset
  console.log('Meta information:', reader.meta);
  console.log('Dataset:', reader.dict);
  
  return reader;
}
```

### Reading with Custom Options

```javascript
async function readDicomFileWithOptions(arrayBuffer) {
  const reader = new AsyncDicomReader({
    isLittleEndian: true,
    clearBuffers: true  // Automatically clear consumed buffers
  });
  
  reader.stream.setData(arrayBuffer);
  
  // Read with error tolerance and custom meta size limit
  await reader.readFile({
    ignoreErrors: true,
    maxSizeMeta: 1024 * 20,  // 20KB max for meta header
    listener: customListener  // Optional custom listener
  });
  
  return reader;
}
```

### Using Custom Listeners

The reader uses a listener pattern to build the DICOM dataset. You can implement custom listeners to control how data is processed:

```javascript
import { DicomMetadataListener } from 'dcmjs';

class CustomListener extends DicomMetadataListener {
  addTag(tag, tagInfo) {
    console.log(`Processing tag: ${tag} (${tagInfo.name})`);
    super.addTag(tag, tagInfo);
  }
  
  value(val) {
    // Process each value as it's read
    super.value(val);
  }
}

async function readWithCustomListener(arrayBuffer) {
  const reader = new AsyncDicomReader();
  reader.stream.setData(arrayBuffer);
  
  await reader.readFile({
    listener: new CustomListener()
  });
  
  return reader;
}
```

## Architecture

### Core Components

1. **BufferStream**: Manages the underlying data buffer with automatic memory management
2. **Listener Pattern**: Uses listeners to build the dataset incrementally
3. **Tag Reading**: Parses DICOM tags with proper VR (Value Representation) handling
4. **Transfer Syntax Detection**: Automatically detects and adapts to file transfer syntax

### Reading Process

The reader follows this sequence:

1. **Preamble & Marker** (128 bytes + "DICM")
2. **File Meta Information** (Group 0x0002)
3. **Transfer Syntax Detection** (from meta info)
4. **Dataset Reading** (main DICOM data)

```
┌─────────────────┐
│  128B Preamble  │
├─────────────────┤
│   DICM Marker   │ 
├─────────────────┤
│   Meta Info     │ (Group 0x0002, Explicit Little Endian)
├─────────────────┤
│    Dataset      │ (Uses detected Transfer Syntax)
└─────────────────┘
```

## Advanced Usage

### Reading Specific Sections

#### Reading Only Meta Information

```javascript
async function readMetaOnly(arrayBuffer) {
  const reader = new AsyncDicomReader();
  reader.stream.setData(arrayBuffer);
  
  // Read preamble
  const hasPreamble = await reader.readPreamble();
  if (!hasPreamble) {
    throw new Error('No DICM marker found');
  }
  
  // Read only meta information
  const meta = await reader.readMeta();
  
  console.log('Transfer Syntax:', meta['00020010'].Value[0]);
  console.log('SOP Class UID:', meta['00020002'].Value[0]);
  
  return meta;
}
```

#### Reading Until Specific Tag

```javascript
async function readUntilTag(arrayBuffer, targetTag) {
  const reader = new AsyncDicomReader();
  reader.stream.setData(arrayBuffer);
  
  await reader.readPreamble();
  await reader.readMeta();
  
  const listener = new DicomMetadataListener();
  
  await reader.read(listener, {
    untilTag: targetTag,
    includeUntilTagValue: false
  });
  
  return listener.pop();
}
```

### Handling Pixel Data

The reader automatically detects compressed vs uncompressed pixel data:

#### Uncompressed Pixel Data

```javascript
// Uncompressed pixel data is delivered as arrays
// Each frame is ALWAYS delivered as an array (ArrayBuffer[]), even for single frames
// Binary data can be fragmented - a single frame may be split across multiple ArrayBuffer fragments
// Multiple fragments are combined into one array per frame
// Large frames may be split into multiple fragments based on maxFragmentSize (default 128MB)

class PixelDataListener extends DicomMetadataListener {
  constructor() {
    super();
    this.frames = [];
  }
  
  value(val) {
    if (val instanceof ArrayBuffer || ArrayBuffer.isView(val)) {
      this.frames.push(val);
    }
    super.value(val);
  }
}
```

#### Compressed Pixel Data

```javascript
// Compressed data is read as encapsulated format
// Each frame is ALWAYS delivered as an array (ArrayBuffer[]), even for single frames
// Video transfer syntaxes are handled as though they were a single frame
// Binary data can be delivered fragmented - a single frame may be split across multiple ArrayBuffer fragments
// Multiple fragments are combined into one array per frame
// Large frames may be split into multiple fragments based on maxFragmentSize (default 128MB)

async function readCompressedImage(arrayBuffer) {
  const reader = new AsyncDicomReader();
  const listener = new PixelDataListener();
  
  reader.stream.setData(arrayBuffer);
  await reader.readFile({ listener });
  
  // listener.frames contains each compressed frame (each frame is an ArrayBuffer[])
  return listener.frames;
}
```

### Working with Sequences

Sequences are automatically parsed with proper nesting:

```javascript
// Sequences are represented as arrays of objects
// Example: Referenced Series Sequence

async function readWithSequences(arrayBuffer) {
  const reader = new AsyncDicomReader();
  reader.stream.setData(arrayBuffer);
  await reader.readFile();
  
  // Access sequence items
  const referencedSeries = reader.dict['00081115']; // Referenced Series Seq
  if (referencedSeries) {
    referencedSeries.Value.forEach((item, index) => {
      console.log(`Series ${index}:`, item['0020000E']); // Series Instance UID
    });
  }
  
  return reader;
}
```

## Performance Considerations

### Memory Management

The reader uses automatic buffer clearing to minimize memory usage:

```javascript
// Enable buffer clearing (default)
const reader = new AsyncDicomReader({
  clearBuffers: true
});

// The stream automatically calls consume() to clear processed data
// This prevents memory buildup during large file reads
```

### Streaming Large Files

For very large files, the async nature prevents blocking:

```javascript
async function streamLargeFile(fileHandle) {
  const reader = new AsyncDicomReader();
  
  // Read file in chunks
  const chunkSize = 1024 * 1024; // 1MB chunks
  let offset = 0;
  const chunks = [];
  
  while (true) {
    const { done, value } = await fileHandle.read(chunkSize);
    if (done) break;
    
    chunks.push(value);
    offset += value.byteLength;
  }
  
  // Combine chunks
  const fullBuffer = new Uint8Array(offset);
  let position = 0;
  for (const chunk of chunks) {
    fullBuffer.set(new Uint8Array(chunk), position);
    position += chunk.byteLength;
  }
  
  reader.stream.setData(fullBuffer.buffer);
  await reader.readFile();
  
  return reader;
}
```

## Error Handling

### Handling Malformed Files

```javascript
async function readWithErrorHandling(arrayBuffer) {
  const reader = new AsyncDicomReader();
  reader.stream.setData(arrayBuffer);
  
  try {
    await reader.readFile({
      ignoreErrors: true,  // Continue reading despite errors
      maxSizeMeta: 1024 * 50  // Allow larger meta headers
    });
  } catch (error) {
    console.error('Failed to read DICOM file:', error);
    
    // Partial data may still be available
    if (reader.meta) {
      console.log('Meta information was read:', reader.meta);
    }
    
    throw error;
  }
  
  return reader;
}
```

### Validation

```javascript
async function validateDicomFile(arrayBuffer) {
  const reader = new AsyncDicomReader();
  reader.stream.setData(arrayBuffer);
  
  // Check for DICM marker
  const hasPreamble = await reader.readPreamble();
  if (!hasPreamble) {
    return {
      valid: false,
      error: 'Missing DICM preamble'
    };
  }
  
  // Validate meta information
  try {
    const meta = await reader.readMeta();
    
    if (!meta['00020010']) {
      return {
        valid: false,
        error: 'Missing Transfer Syntax UID'
      };
    }
    
    return {
      valid: true,
      transferSyntax: meta['00020010'].Value[0]
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message
    };
  }
}
```

## API Reference

### Constructor

```javascript
new AsyncDicomReader(options)
```

**Options:**
- `isLittleEndian` (boolean): Force specific endianness
- `clearBuffers` (boolean): Enable automatic buffer clearing (default: true)
- Additional options passed to `ReadBufferStream`

### Methods

#### `async readPreamble()`
Reads the 128-byte preamble and DICM marker.

**Returns:** `Promise<boolean>` - true if DICM marker found

#### `async readFile(options)`
Reads the entire DICOM file including meta information and dataset.

**Options:**
- `listener` (DicomMetadataListener): Custom listener for dataset building
- `ignoreErrors` (boolean): Continue reading despite errors
- `maxSizeMeta` (number): Maximum bytes to read for meta header

**Returns:** `Promise<AsyncDicomReader>` - The reader instance

#### `async readMeta(options)`
Reads only the file meta information (Group 0x0002).

**Options:**
- `maxSizeMeta` (number): Maximum bytes for meta header (default: 10KB)
- `ignoreErrors` (boolean): Allow reading files with malformed meta

**Returns:** `Promise<Object>` - Meta information dictionary

#### `async read(listener, options)`
Reads the dataset portion using the provided listener.

**Parameters:**
- `listener` (DicomMetadataListener): Listener to build dataset
- `options.untilOffset` (number): Stop reading at specific byte offset

**Returns:** `Promise<Object>` - Parsed dataset

#### `readTagHeader(options)`
Reads a single tag header (tag, VR, length).

**Options:**
- `untilTag` (string): Stop when reaching this tag
- `includeUntilTagValue` (boolean): Include the stop tag's value

**Returns:** `Object` - Tag information with structure:
```javascript
{
  tag: string,        // Tag as hex string (e.g., "00100010")
  tagObj: Tag,        // Tag object
  vr: string,         // VR as string (e.g., "PN")
  vrObj: VR,          // ValueRepresentation object
  length: number,     // Value length (-1 for undefined)
  vm: string,         // Value multiplicity
  name: string        // Tag name from dictionary
}
```

### Properties

- `syntax` (string): Current transfer syntax UID
- `meta` (Object): File meta information dictionary
- `dict` (Object): Dataset dictionary
- `stream` (ReadBufferStream): Underlying buffer stream
- `listener` (DicomMetadataListener): Current listener instance

## Common Patterns

### Extract Specific Tags

```javascript
async function extractTags(arrayBuffer, tagList) {
  const reader = new AsyncDicomReader();
  reader.stream.setData(arrayBuffer);
  await reader.readFile();
  
  const result = {};
  for (const tag of tagList) {
    if (reader.dict[tag]) {
      result[tag] = reader.dict[tag].Value;
    }
  }
  
  return result;
}

// Usage
const tags = await extractTags(buffer, [
  '00100010',  // Patient Name
  '00100020',  // Patient ID
  '0020000D',  // Study Instance UID
]);
```

### Convert to JSON

```javascript
async function dicomToJson(arrayBuffer) {
  const reader = new AsyncDicomReader();
  reader.stream.setData(arrayBuffer);
  await reader.readFile();
  
  return {
    meta: reader.meta,
    dataset: reader.dict
  };
}
```

### Read Multiple Files

```javascript
async function readMultipleFiles(arrayBuffers) {
  const results = await Promise.all(
    arrayBuffers.map(async (buffer) => {
      const reader = new AsyncDicomReader();
      reader.stream.setData(buffer);
      await reader.readFile();
      return {
        meta: reader.meta,
        dataset: reader.dict
      };
    })
  );
  
  return results;
}
```

## Bulkdata format

The bulkdata format in JSON is
```
    "54001010": {
          "vr": "OW",
          "BulkDataURI": "./bulkdata/group1"
    }
```

where the bulkdata uri can be an absolute or relative URI.

The encoding of the bulkdata URI is multipart/related.  It is recommended to gzip the entire bulkdata instance for storage.

## Sequence of listener calls

The sequence of listener calls generated by `AsyncDicomReader` is:

```
  // Start of dict parsing (after fmi)
  listener.dict ||= {};
  listener.startObject(this.dict);
  // listener.current.level is 0 - top level object awaiting tags

  // For every tag:
  listener.addTag(tagHexString, tagInfo);
  // listener.current.level is 1 - top level attributing awaiting value

  if( isSequence ) {
    // For sequences, recursively:
    listener.startObject([]);
    // listener.current.level will be 2
    for(const child of sequence) {
      listener.startObject();
      // listener.current.level will be 3
      ... deliver child to listener
      listener.pop();
    }
    listener.pop();
  } else {
    // For each value in the tag:
    values.forEach(value => listener.value(value));
    // listener.current should record the value in some way
  }

  listener.pop();
```

## Writing new listeners

Only the modified methods in the listener should be overwritten, as absent methods
simply mean to call the next listener.  Listeners should implement the `addTag(next,tag,tagInfo)` version
of the methods and get added to the constructor of `DicomMetadataListener` or 
another root listener.

### Raw Binary Data Feature

Starting with the `expectsRaw` feature, listeners can request raw binary data for specific tags by returning an object with `expectsRaw: true` from the `addTag` method. This is useful when you need to:

- Process tag data in its raw binary form without parsing
- Implement custom parsing logic for specific tags
- Extract binary data for external processing
- Optimize performance by skipping unnecessary parsing

**How it works:**

1. The `addTag` method returns an object with `expectsRaw: true`
2. AsyncDicomReader delivers the raw binary data as `ArrayBuffer` chunks via `listener.value()`
3. Binary data can be delivered fragmented - a single tag's data may be split across multiple ArrayBuffer fragments
4. Multiple fragments are delivered sequentially via multiple `listener.value()` calls
5. Data is split into fragments based on `maxFragmentSize` (default 128MB) with buffer consumption between chunks for memory efficiency
6. This only works for non-pixel data tags with positive length
7. Pixel data and sequences continue to use their specialized handlers

**Example:**

```javascript
class RawBinaryListener extends DicomMetadataListener {
  constructor(tagsToReceiveRaw = []) {
    super();
    this.tagsToReceiveRaw = new Set(tagsToReceiveRaw);
    this.rawDataReceived = {};
    this.rawChunks = {};
  }

  addTag(tag, tagInfo) {
    // Call the parent implementation
    const result = super.addTag(tag, tagInfo);
    
    // Request raw binary data for specific tags
    if (this.tagsToReceiveRaw.has(tag)) {
      // Initialize chunk collector for this tag
      this.rawChunks[tag] = [];
      return { expectsRaw: true };
    }
    
    return result;
  }

  value(v) {
    // Track raw binary data received (may be delivered in multiple chunks)
    if (this.current && this.tagsToReceiveRaw.has(this.current.tag)) {
      if (v instanceof ArrayBuffer) {
        this.rawChunks[this.current.tag].push(v);
      }
    }
    return super.value(v);
  }
  
  pop() {
    // When tag is complete, combine chunks if needed
    if (this.current && this.tagsToReceiveRaw.has(this.current.tag)) {
      const tag = this.current.tag;
      const chunks = this.rawChunks[tag];
      
      if (chunks.length === 1) {
        this.rawDataReceived[tag] = chunks[0];
      } else if (chunks.length > 1) {
        // Combine multiple chunks into a single ArrayBuffer
        const totalSize = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
        const combined = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          combined.set(new Uint8Array(chunk), offset);
          offset += chunk.byteLength;
        }
        this.rawDataReceived[tag] = combined.buffer;
      }
      
      delete this.rawChunks[tag];
    }
    return super.pop();
  }
}

// Usage
const listener = new RawBinaryListener([
  '00100010', // Patient Name
  '00080060', // Modality
  '00201041', // Slice Location
]);

const reader = new AsyncDicomReader();
reader.stream.setData(arrayBuffer);
await reader.readFile({ listener });

// Access raw binary data (now combined from all chunks)
console.log(listener.rawDataReceived);
```

**Limitations:**
- Only works for non-pixel data tags (pixel data uses dedicated handlers)
- Only works for tags with positive length (not undefined length)
- The tag must have actual data present in the file

## Image Frames

Image frames are numbered starting at 1, with the index in the pixel data
tag starting at 0.  **Each frame is ALWAYS delivered as an array (ArrayBuffer[]), even for single frames.**

The value of both uncompressed and compressed image frames is one of:

   - BulkDataURI
   - ArrayBuffer[] containing the frame data (always an array, even for single frames)

**Important behaviors:**

- **Video transfer syntaxes**: Video is handled as though it were a single frame. All video frames are delivered as a single array containing all frame fragments.
- **Fragmented binary data**: Binary data can be delivered fragmented. A single frame may be split across multiple ArrayBuffer fragments based on `maxFragmentSize` (default 128MB). Multiple fragments are combined into one array per frame.
- **Frame delivery**: Each frame is delivered via `listener.startObject([])` followed by one or more `listener.value(fragment)` calls (one per fragment), then `listener.pop()`.

## Best Practices

2. **Use error handling** for production code - not all DICOM files are well-formed
3. **Implement custom listeners** storing data as bulkdata.
4. **Enable buffer clearing** (default) for memory efficiency
5. **Validate transfer syntax** before processing pixel data
6. **Use ignoreErrors cautiously** - it may skip important data

## Troubleshooting

### Issue: "Invalid DICOM file, meta length tag is malformed"
**Solution:** Use `ignoreErrors: true` option or check if file has proper DICM preamble

### Issue: Out of memory errors
**Solution:** Ensure `clearBuffers: true` and process pixel data incrementally with custom listener

### Issue: "Can't handle tag with -1 length and not sequence"
**Solution:** File may have non-standard undefined length tags - this is invalid DICOM

### Issue: Incorrect character encoding
**Solution:** Check Specific Character Set (0008,0005) tag and verify encoding mapping

## Related Components

- **DicomMessage**: Synchronous DICOM reader for smaller files
- **ReadBufferStream**: Underlying streaming buffer implementation
- **ValueRepresentation**: VR parsing and value extraction
- **DicomMetadataListener**: Default listener for building datasets
- **Tag**: DICOM tag parsing and manipulation

## Future Enhancements

The AsyncDicomReader is marked as preliminary. Future versions may include:

- Compressed transfer syntax support (JPEG, JPEG-LS, RLE, JPEG 2000)
- Files without DICM preamble
- Improved streaming for network sources
- Progress callbacks
- Cancelable operations
- More robust error recovery

## References

- DICOM Standard PS3.10 (Media Storage and File Format)
- DICOM Standard PS3.5 (Data Structures and Encoding)
- [dcmjs Documentation](https://github.com/dcmjs-org/dcmjs)
