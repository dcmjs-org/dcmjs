export default class Length {
  constructor() {
  }

  static measurementContentToLengthState(groupItemContent) {
    const toolType = 'length';
    const lengthContent = groupItemContent.ContentSequence;
    const { ReferencedSOPSequence } = lengthContent.ContentSequence;
    const { ReferencedSOPInstanceUID, ReferencedFrameNumber } = ReferencedSOPSequence
    const lengthState = {
      sopInstanceUid: ReferencedSOPInstanceUID,
      frameIndex: ReferencedFrameNumber || 0,
      length: groupItemContent.MeasuredValueSequence.NumericValue,
      toolType,
    };

    lengthState.handles = {start: {}, end: {}};
    [lengthState.handles.start.x,
      lengthState.handles.start.y,
      lengthState.handles.end.x,
      lengthState.handles.end.y] = lengthContent.GraphicData;

    // TODO: Save textbox position in GraphicData
    lengthState.handles.textBox = {
      hasMoved: false,
      movesIndependently: false,
      drawnIndependently: true,
      allowedOutsideImage: true,
      hasBoundingBox: true
    }

    return lengthState;
  }

  static getMeasurementData(measurementContent) {
    return measurementContent.map(Length.measurementContentToLengthState);
  }
}
