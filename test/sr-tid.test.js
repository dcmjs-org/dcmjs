import { utilities } from "../src";

const { Length, Circle, Calibration } = utilities.TID300;

describe("DICOM SR TID 300/1500 tests", () => {
    describe("TID300 Creation", () => {
        it("Length Create", () => {
            const length = new Length({
                point1: {x: 3, y: 5},
                point2: {x: 6, y: 1},
                unit: 'mm',
                distance: 3.14,
            });
            const value = length.contentItem();
            expect(value.length).toBe(3);
            const measured = value[2].MeasuredValueSequence;
            expect(measured.NumericValue).toBe(3.14);
            const units = measured.MeasurementUnitsCodeSequence;
            expect(units.CodeValue).toBe('mm');
        });

        it("Circle Create", () => {
            const r = 10;
            const props = {
                points: [{x: 3, y: 5}, {x: 6, y: 1}],
                unit: 'mm',
                areaUnits: 'mm\xB2',
                perimeter: 2*3.141592*r,
                area: 3.141592*r*r,
            };
            const circle = new Circle(props);
            const value = circle.contentItem();
            expect(value.length).toBe(4);
            const measured = value[3].MeasuredValueSequence;
            expect(measured.NumericValue).toBe(props.area);
            const units = measured.MeasurementUnitsCodeSequence;
            expect(units.CodeValue).toBe('mm2');
        });


        it('Calibration Create', () => {
            const calibration = new Calibration({
                point1: {x: 3, y: 5},
                point2: {x: 6, y: 1},
                unit: 'mm',
                distance: 3.14,
            });
            const value = calibration.contentItem();
            expect(value.length).toBe(3);
            const measured = value[2].MeasuredValueSequence;
            expect(measured.NumericValue).toBe(3.14);
            const units = measured.MeasurementUnitsCodeSequence;
            expect(units.CodeValue).toBe('mm');
        });
    });

    describe("Use Units", () => {
        it("Length Units", () => {
            const length = new Length({
                point1: {x: 3, y: 5},
                point2: {x: 6, y: 1},
                unit: 'px',
                distance: 3.14,
            });
            const value = length.contentItem();
            expect(value.length).toBe(3);
            const measured = value[2].MeasuredValueSequence;
            expect(measured.NumericValue).toBe(3.14);
            const units = measured.MeasurementUnitsCodeSequence;
            expect(units.CodeValue).toBe('1');
        });
    });
});

