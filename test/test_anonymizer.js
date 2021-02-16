const expect = require("chai").expect;
const dcmjs = require("../build/dcmjs");

const fs = require("fs");

const tests = {
  test_export: () => {
    const cleanTags = dcmjs.anonymizer.cleanTags;
    expect(typeof cleanTags).to.equal("function");
  },
};

exports.test = (testToRun) => {
  Object.keys(tests).forEach((testName) => {
    if (testToRun && !testName.toLowerCase().includes(testToRun.toLowerCase())) {
      console.log("-- Skipping " + testName);
      return false;
    }
    console.log("-- Starting " + testName);
    tests[testName]();
  });
};
