export default class Length extends TID300Measurement () {
    constructor(point1, point2, distance, sopInstanceUid, frameIndex) {
        this.contentItem(point1, point2, distance, sopInstanceUid, frameIndex)
    }

    contentItem(measurement, sopClassUid) {
        const {
            handles,
            length,
            frameIndex,
            sopInstanceUid
        } = measurement;
        
        return {
            RelationshipType: 'CONTAINS',
            ValueType: 'NUM',
            ConceptNameCodeSequence: {
                CodeValue: 'G-D7FE',
                CodingSchemeDesignator: 'SRT',
                CodeMeaning: 'Length',
            },
            MeasuredValueSequence: {
                MeasurementUnitsCodeSequence: {
                    CodeValue: 'mm',
                    CodingSchemeDesignator: 'UCUM',
                    CodingSchemeVersion: '1.4',
                    CodeMeaning: 'millimeter',
                },
                NumericValue: length,
            },
            ContentSequence: {
                RelationshipType: 'INFERRED FROM',
                ValueType: 'SCOORD',
                GraphicType: 'POLYLINE',
                GraphicData: [ handles.start.x, handles.start.y, handles.end.x, handles.end.y ],
                ContentSequence: {
                    RelationshipType: 'SELECTED FROM',
                    ValueType: 'IMAGE',
                    ReferencedSOPSequence: {
                        ReferencedSOPClassUID: sopClassUid,
                        ReferencedSOPInstanceUID: sopInstanceUid,
                        ReferencedFrameNumber: frameIndex,
                    }
                },
            },
        };
    };
}