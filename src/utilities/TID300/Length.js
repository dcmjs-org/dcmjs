import OpenPolyline from "./OpenPolyline.js";
import unit2CodingValue from "./unit2CodingValue.js";

export default class Length extends OpenPolyline {
    getPoints() {
        const { point1, point2 } = this.props;
        return [point1, point2];
    }

    getConceptNameCodeSequence() {
        return {
            CodeValue: "410668003",
            CodingSchemeDesignator: "SCT",
            CodeMeaning: "Length"
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
