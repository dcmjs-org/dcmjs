import { jest } from "@jest/globals";
import fs from "fs";

import { StreamParser } from "../src/StreamParser.js";
    
jest.setTimeout(60000);

const chunkSize = 1024;

describe("Stream Parser Tests", () => {
it("streaming_parser_test", () => {
    const arrayBuffer = fs.readFileSync("test/sample-dicom.dcm").buffer;
    
    const streaming = new StreamParser();
    const stack = streaming.initPart10();
    let size = 0;
    
    while(size < arrayBuffer.byteLength) {
        const increment = Math.min(arrayBuffer.byteLength-size,chunkSize);
        streaming.append(stack, arrayBuffer.slice(size,size+increment));
        size += increment;
        streaming.parse(stack);
    }
    streaming.setComplete(stack);
    const result = streaming.parse(stack);
    expect(result.dict).not.toBeUndefined();
});
})
