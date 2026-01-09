import OpenPolyline from "./OpenPolyline.js";
import unit2CodingValue from "./unit2CodingValue.js";

export default class Calibration extends OpenPolyline {
    getPoints() {
        const { point1, point2 } = this.props;
        return [point1, point2];
    }

    getConceptNameCodeSequence() {
        return {
            CodeValue: "102304005",
            CodingSchemeDesignator: "SCT",
            CodeMeaning: "Calibration Ruler"
        };
    }

    getMeasuredValueSequence() {
        const { distance, unit = "mm" } = this.props;
        return {
            MeasurementUnitsCodeSequence: unit2CodingValue(unit),
            NumericValue: distance
        };
    }
}
