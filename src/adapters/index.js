import Cornerstone from "./Cornerstone/index.js";
import Cornerstone3D from "./Cornerstone3D/index.js";
import VTKjs from "./VTKjs/index.js";
import DICOMMicroscopyViewer from "./DICOMMicroscopyViewer/";

/**
 * @deprecated The adapters moved to `@cornerstonejs/adapters`. Import them
 * from that package. `@dcmjs-org/dcmjs` keeps this export only for
 * compatibility with 0.x, and a later major release removes it.
 */
const adapters = {
    Cornerstone,
    Cornerstone3D,
    VTKjs,
    DICOMMicroscopyViewer
};

export default adapters;
