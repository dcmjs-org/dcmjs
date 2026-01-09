import OpenPolyline from "./OpenPolyline.js";

export default class CobbAngle extends OpenPolyline {
    getPoints() {
        const { point1, point2, point3, point4 } = this.props;
        return [point1, point2, point3, point4];
    }

    getConceptNameCodeSequence() {
        return {
            CodeValue: "285285000",
            CodingSchemeDesignator: "SCT",
            CodeMeaning: "Cobb angle"
        };
    }

    getMeasuredValueSequence() {
        const { rAngle } = this.props;
        return {
            MeasurementUnitsCodeSequence: {
                CodeValue: "deg",
                CodingSchemeDesignator: "UCUM",
                CodingSchemeVersion: "1.4",
                CodeMeaning: "\u00B0"
            },
            NumericValue: rAngle
        };
    }
}
