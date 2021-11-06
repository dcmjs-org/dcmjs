import MeasurementReport from "./MeasurementReport.js";
import TID300Measurement from "../../utilities/TID300/TID300Measurement";
import CORNERSTONE_4_TAG from "./cornerstone4Tag";
import { toArray } from "../helpers.js";

const COORD = "SCOORD";
const DESCRIPTION = "111033";
const FINDING = "121071";
const FINDING_SITE = "G-C0E3";
const GENERIC = "GenericTool";
const LOCATION = "121226";
const NUMERIC = "NUM";

class GenericTool {
    constructor() {}

    static getMeasurementData(MeasurementGroup) {
        const { ContentSequence } = MeasurementGroup;

        const findingGroup = toArray(ContentSequence).find(
            group => group.ConceptNameCodeSequence.CodeValue === FINDING
        );

        const findingSiteGroups = toArray(ContentSequence).filter(
            group => group.ConceptNameCodeSequence.CodeValue === FINDING_SITE
        );

        const LocationGroup = toArray(ContentSequence).filter(
            group => group.ConceptNameCodeSequence.CodeValue === LOCATION
        );
        let location = "";
        if (LocationGroup && LocationGroup.length > 0) {
            location = LocationGroup[0].TextValue;
        }

        const descriptionGroup = toArray(ContentSequence).filter(
            group => group.ConceptNameCodeSequence.CodeValue === DESCRIPTION
        );
        let description = "";
        if (descriptionGroup && descriptionGroup.length > 0) {
            description = descriptionGroup[0].TextValue;
        }

        const SCOORDGroup = this.getScoordContent(ContentSequence);

        const { ReferencedSOPSequence } = SCOORDGroup.ContentSequence;
        const {
            ReferencedSOPInstanceUID,
            ReferencedFrameNumber
        } = ReferencedSOPSequence;

        const toolState = {
            active: false,
            description,
            finding: findingGroup
                ? findingGroup.ConceptCodeSequence
                : undefined,
            findingSites: findingSiteGroups.map(fsg => {
                return { ...fsg.ConceptCodeSequence };
            }),
            frameIndex: ReferencedFrameNumber || 1,
            handles: {
                start: {},
                end: {},
                textBox: {
                    hasMoved: false,
                    movesIndependently: false,
                    drawnIndependently: true,
                    allowedOutsideImage: true,
                    hasBoundingBox: true
                }
            },
            invalidated: false,
            isCreating: false,
            location,
            sopInstanceUid: ReferencedSOPInstanceUID,
            toolName: GENERIC,
            toolType: GenericTool.toolType,
            visible: true
        };

        return toolState;
    }

    static getTID300RepresentationArguments(tool) {
        const { finding, findingSites } = tool;

        const trackingIdentifierTextValue = CORNERSTONE_4_TAG + ":" + GENERIC;

        return {
            finding,
            findingSites: findingSites || [],
            trackingIdentifierTextValue
        };
    }

    static getNumericContent(ContentSequence) {
        return toArray(ContentSequence).find(
            group => group.ValueType === NUMERIC
        );
    }

    static getScoordContent(ContentSequence) {
        const NUMGroup = this.getNumericContent(ContentSequence);
        return toArray(NUMGroup.ContentSequence).find(
            group => group.ValueType === COORD
        );
    }
}

GenericTool.toolType = GenericTool;
GenericTool.utilityToolType = GENERIC;
GenericTool.TID300Representation = TID300Measurement;
GenericTool.isValidCornerstoneTrackingIdentifier = TrackingIdentifier => {
    if (!TrackingIdentifier.includes(":")) {
        return false;
    }

    const [cornerstone4Tag, toolType] = TrackingIdentifier.split(":");

    if (cornerstone4Tag !== CORNERSTONE_4_TAG) {
        return false;
    }

    return toolType === GENERIC;
};

MeasurementReport.registerTool(GenericTool);

export default GenericTool;
