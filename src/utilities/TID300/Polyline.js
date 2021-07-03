import { DicomMetaDictionary } from "../../DicomMetaDictionary.js";
import TID300Measurement from "./TID300Measurement.js";
import utilities from "../index.js";

/**
 * Expand an array of points stored as objects into
 * a flattened array of points
 *
 * @param points [{x: 0, y: 1}, {x: 1, y: 2}] or [{x: 0, y: 1, z: 0}, {x: 1, y: 2, z: 0}]
 * @return {Array} [point1x, point1y, point2x, point2y] or [point1x, point1y, point1z, point2x, point2y, point2z]
 */
function expandPoints(points) {
    const allPoints = [];

    points.forEach(point => {
        allPoints.push(point.x);
        allPoints.push(point.y);
        if (point.z !== undefined) {
            allPoints.push(point.z);
        }
    });

    return allPoints;
}

function getMeasurementComponent(
    measurementType,
    value,
    unit,
    GraphicData,
    use3DSpatialCoordinates,
    ReferencedSOPSequence
) {
    return {
        // TODO: This feels weird to repeat the GraphicData
        RelationshipType: "CONTAINS",
        ValueType: "NUM",
        ConceptNameCodeSequence:
            utilities.quantificationCodedTermMap[measurementType],
        MeasuredValueSequence: {
            MeasurementUnitsCodeSequence:
                utilities.unitsCodedTermMap[unit] ||
                utilities.unitsCodedTermMap["1"],
            NumericValue: value
        },
        ContentSequence: {
            RelationshipType: "INFERRED FROM",
            ValueType: use3DSpatialCoordinates ? "SCOORD3D" : "SCOORD",
            GraphicType: "POLYLINE",
            GraphicData,
            ContentSequence: use3DSpatialCoordinates
                ? undefined
                : {
                      RelationshipType: "SELECTED FROM",
                      ValueType: "IMAGE",
                      ReferencedSOPSequence
                  }
        }
    };
}

export default class Polyline extends TID300Measurement {
    contentItem() {
        const {
            points,
            ReferencedSOPSequence,
            use3DSpatialCoordinates = false,
            perimeter,
            area,
            meanStdDev,
            meanStdDevSUV,
            pixelUnit
        } = this.props;

        const GraphicData = expandPoints(points);

        const measurements = [];
        // Talking with Steve, we decided it should not be calculated here.
        // it should either come from cornerstone tools or should not be saved
        if (perimeter) {
            measurements.push(
                getMeasurementComponent(
                    "Perimeter",
                    perimeter,
                    "mm",
                    GraphicData,
                    use3DSpatialCoordinates,
                    ReferencedSOPSequence
                )
            );
        }
        if (area) {
            measurements.push(
                getMeasurementComponent(
                    "Area",
                    area,
                    "mm2",
                    GraphicData,
                    use3DSpatialCoordinates,
                    ReferencedSOPSequence
                )
            );
        }
        // if the pixelUnit is not sent, check if tool calculated SUV, otherwise put HU. we cannot check modality here
        const unit = pixelUnit || (meanStdDevSUV ? "suv" : "hu");
        const stats = meanStdDevSUV || meanStdDev;
        if (stats) {
            if (stats.min) {
                measurements.push(
                    getMeasurementComponent(
                        "Min",
                        stats.min,
                        unit,
                        GraphicData,
                        use3DSpatialCoordinates,
                        ReferencedSOPSequence
                    )
                );
            }
            if (stats.max) {
                measurements.push(
                    getMeasurementComponent(
                        "Max",
                        stats.max,
                        unit,
                        GraphicData,
                        use3DSpatialCoordinates,
                        ReferencedSOPSequence
                    )
                );
            }
            if (stats.stdDev) {
                measurements.push(
                    getMeasurementComponent(
                        "StdDev",
                        stats.stdDev,
                        unit,
                        GraphicData,
                        use3DSpatialCoordinates,
                        ReferencedSOPSequence
                    )
                );
            }
            if (stats.mean) {
                measurements.push(
                    getMeasurementComponent(
                        "Mean",
                        stats.mean,
                        unit,
                        GraphicData,
                        use3DSpatialCoordinates,
                        ReferencedSOPSequence
                    )
                );
            }
        }
        return this.getMeasurement(measurements);
    }
}
