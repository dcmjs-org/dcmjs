import TID300Measurement from "./TID300Measurement.js";

/**
 * Expand an array of points stored as objects into
 * a flattened array of points
 *
 * @param points
 * @return {Array}
 */
function expandPoints(points) {
    const allPoints = [];

    points.forEach(point => {
        allPoints.push(point.x);
        allPoints.push(point.y);
    });

    return allPoints;
}

export default class Ellipse extends TID300Measurement {
    contentItem() {
        const { cachedStats, points, ReferencedSOPSequence } = this.props;

        const GraphicData = expandPoints(points);

        return this.getMeasurement([
            {
                RelationshipType: "CONTAINS",
                ValueType: "NUM",
                ConceptNameCodeSequence: {
                    CodeValue: "G-D7FE",
                    CodingSchemeDesignator: "SRT",
                    CodeMeaning: "AREA"
                },
                MeasuredValueSequence: [
                    {
                        MeasurementUnitsCodeSequence: {
                            CodeValue: "mm2",
                            CodingSchemeDesignator: "UCUM",
                            CodingSchemeVersion: "1.4",
                            CodeMeaning: "squaremillimeter"
                        },
                        NumericValue: cachedStats.area
                    },
                    {
                        MeasurementUnitsCodeSequence: {
                            CodeValue: "HU",
                            CodingSchemeDesignator: "UCUM",
                            CodingSchemeVersion: "1.4",
                            CodeMeaning: "Hounsfield unit"
                        },
                        NumericValue: cachedStats.mean
                    },
                    {
                        MeasurementUnitsCodeSequence: {
                            CodeValue: "HU",
                            CodingSchemeDesignator: "UCUM",
                            CodingSchemeVersion: "1.4",
                            CodeMeaning: "Hounsfield unit"
                        },
                        NumericValue: cachedStats.stdDev
                    }
                ],
                ContentSequence: {
                    RelationshipType: "INFERRED FROM",
                    ValueType: "SCOORD",
                    GraphicType: "ELLIPSE",
                    GraphicData,
                    ContentSequence: {
                        RelationshipType: "SELECTED FROM",
                        ValueType: "IMAGE",
                        ReferencedSOPSequence
                    }
                }
            }
        ]);
    }
}
