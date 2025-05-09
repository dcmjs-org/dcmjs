import { DicomMetaDictionary } from "../../DicomMetaDictionary.js";
import addAccessors from "../addAccessors.js";

export default class TID300Measurement {
    constructor(props) {
        this.ReferencedSOPSequence = props.ReferencedSOPSequence;
        this.props = props;
    }

    getMeasurement(contentSequenceEntries) {
        return [
            ...this.getTrackingGroups(),
            ...this.getFindingGroup(),
            ...this.getFindingSiteGroups(),
            ...contentSequenceEntries
        ];
    }

    getTrackingGroups() {
        let { trackingIdentifierTextValue } = this.props;

        return [
            {
                RelationshipType: "HAS OBS CONTEXT",
                ValueType: "TEXT",
                ConceptNameCodeSequence: {
                    CodeValue: "112039",
                    CodingSchemeDesignator: "DCM",
                    CodeMeaning: "Tracking Identifier"
                },
                TextValue: trackingIdentifierTextValue || "web annotation"
            },
            {
                RelationshipType: "HAS OBS CONTEXT",
                ValueType: "UIDREF",
                ConceptNameCodeSequence: {
                    CodeValue: "112040",
                    CodingSchemeDesignator: "DCM",
                    CodeMeaning: "Tracking Unique Identifier"
                },
                UID: DicomMetaDictionary.uid()
            }
        ];
    }

    getFindingGroup() {
        let finding = this.props.finding;

        if (!finding) {
            return [];
        }

        const { CodeValue, CodingSchemeDesignator, CodeMeaning } = finding;

        return [
            {
                RelationshipType: "CONTAINS",
                ValueType: "CODE",
                ConceptNameCodeSequence: addAccessors({
                    CodeValue: "121071",
                    CodingSchemeDesignator: "DCM",
                    CodeMeaning: "Finding"
                }),
                ConceptCodeSequence: addAccessors({
                    CodeValue, //: "SAMPLE FINDING",
                    CodingSchemeDesignator, //: "99dcmjs",
                    CodeMeaning //: "Sample Finding"
                })
            }
        ];
    }

    getFindingSiteGroups() {
        let findingSites = this.props.findingSites || [];

        return findingSites.map(findingSite => {
            const { CodeValue, CodingSchemeDesignator, CodeMeaning } =
                findingSite;
            return {
                RelationshipType: "CONTAINS",
                ValueType: "CODE",
                ConceptNameCodeSequence: addAccessors({
                    CodeValue: "363698007",
                    CodingSchemeDesignator: "SCT",
                    CodeMeaning: "Finding Site"
                }),
                ConceptCodeSequence: addAccessors({
                    CodeValue, //: "SAMPLE FINDING SITE",
                    CodingSchemeDesignator, //: "99dcmjs",
                    CodeMeaning //: "Sample Finding Site"
                })
            };
        });
    }

    /**
     * Expands an array of points stored as objects into a flattened array of points
     *
     * @param param.points [{x: 0, y: 1}, {x: 1, y: 2}] or [{x: 0, y: 1, z: 0}, {x: 1, y: 2, z: 0}]
     * @param param.use3DSpatialCoordinates boolean: true for 3D points and false for 2D points.
     *
     * @return {Array} [point1x, point1y, point2x, point2y] or [point1x, point1y, point1z, point2x, point2y, point2z]
     */
    flattenPoints({ points, use3DSpatialCoordinates = false }) {
        const flattenedCoordinates = [];

        points.forEach(point => {
            flattenedCoordinates.push(point[0] || point.x);
            flattenedCoordinates.push(point[1] || point.y);
            if (use3DSpatialCoordinates) {
                flattenedCoordinates.push(point[2] || point.z);
            }
        });

        return flattenedCoordinates;
    }
}
