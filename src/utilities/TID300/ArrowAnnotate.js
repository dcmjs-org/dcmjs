import OpenPolyline from "./OpenPolyline";
import addAccessors from "../addAccessors.js";

export default class ArrowAnnotate extends OpenPolyline {
    getPoints() {
        return this.props.points;
    }

    getConceptNameCodeSequence() {
        return addAccessors({
            CodeValue: "111010",
            CodingSchemeDesignator: "DCM",
            CodeMeaning: "label"
        });
    }

    getMeasuredValueSequence() {
        return {
            NumericValue: 0,
            MeasurementUnitsCodeSequence: {
                CodeValue: "1",
                CodingSchemeDesignator: "UCUM",
                CodeMeaning: "no units"
            }
        };
    }
}
