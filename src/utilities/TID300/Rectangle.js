/* eslint-disable no-console */
import Ellipse from "./Ellipse";

export default class Rectangle extends Ellipse {
    contentItem() {
        let sequence = super.contentItem();

        sequence.at(-1).ContentSequence.GraphicType = "RECTANGLE";
        console.log(sequence);
        return sequence;
    }
}
