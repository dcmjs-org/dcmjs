import { utilities } from "../src";

const { Length, Circle, Polygon, Polyline, Ellipse, Bidirectional, Calibration } = utilities.TID300;

describe("DICOM SR TID 300/1500 tests", () => {
    describe("TID300 Creation", () => {
        it("Polygon Create", () => {
            const props = {
                points: [{x: 3, y: 5}, {x: 6, y: 1}],
                unit: 'mm',
                areaUnit: 'mm2',
                area: 3.14,
                perimeter: 25,
            };
            const polyline = new Polygon(props);
            const value = polyline.contentItem();
            expect(value.length).toBe(4);
            const measured = value[2].MeasuredValueSequence;
            expect(measured.NumericValue).toBe(props.perimeter);
            expect(value[3].MeasuredValueSequence.NumericValue).toBe(props.area);
            const units = measured.MeasurementUnitsCodeSequence;
            expect(units.CodeValue).toBe('mm');
        });

        it("Polyline Create", () => {
            const props = {
                points: [{x: 3, y: 5}, {x: 6, y: 1}],
                unit: 'mm',
                areaUnit: 'mm2',
                area: 3.14,
                perimeter: 25,
            };
            const polyline = new Polyline(props);
            const value = polyline.contentItem();
            expect(value.length).toBe(4);
            const measured = value[2].MeasuredValueSequence;
            expect(measured.NumericValue).toBe(props.perimeter);
            expect(value[3].MeasuredValueSequence.NumericValue).toBe(props.area);
            const units = measured.MeasurementUnitsCodeSequence;
            expect(units.CodeValue).toBe('mm');
        });

        it("Ellipse Create", () => {
            const r = 10;
            const props = {
                points: [{x: 3, y: 5}, {x: 6, y: 1}],
                areaUnit: 'mm\xB2',
                area: 3.141592*r*r,
            };
            const circle = new Ellipse(props);
            const value = circle.contentItem();
            expect(value.length).toBe(3);
            const measured = value[2].MeasuredValueSequence;
            expect(measured.NumericValue).toBe(props.area);
            const units = measured.MeasurementUnitsCodeSequence;
            expect(units.CodeValue).toBe('mm2');
        });

        it("Bidirectional Create", () => {
            const bidir = new Bidirectional({
                longAxis: {
                    point1: {x: 3, y: 5},
                    point2: {x: 6, y: 1},
                },
                shortAxis: {
                    point1: {x: 3, y: 5},
                    point2: {x: 6, y: 1},
                },
                unit: 'mm',
                longAxisLength: 3.14,
                shortAxisLenght: 1.5,
            });
            const value = bidir.contentItem();
            expect(value.length).toBe(4);
            const measured = value[2].MeasuredValueSequence;
            expect(measured.NumericValue).toBe(3.14);
            const units = measured.MeasurementUnitsCodeSequence;
            expect(units.CodeValue).toBe('mm');
        });


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
                areaUnit: 'mm\xB2',
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

        it("Polygon Units", () => {
            const props = {
                points: [{x: 3, y: 5}, {x: 6, y: 1}],
                unit: 'px',
                areaUnit: 'px\xB2',
                area: 3.14,
                perimeter: 25,
            };
            const polyline = new Polygon(props);
            const value = polyline.contentItem();
            expect(value.length).toBe(4);
            const measured = value[2].MeasuredValueSequence;
            expect(measured.NumericValue).toBe(props.perimeter);
            const units = measured.MeasurementUnitsCodeSequence;
            expect(units.CodeValue).toBe('1');
        });

        it("Polyline Units", () => {
            const props = {
                points: [{x: 3, y: 5}, {x: 6, y: 1}],
                unit: 'px',
                areaUnit: 'px\xB2',
                area: 3.14,
                perimeter: 25,
            };
            const polyline = new Polyline(props);
            const value = polyline.contentItem();
            expect(value.length).toBe(4);
            const measured = value[2].MeasuredValueSequence;
            expect(measured.NumericValue).toBe(props.perimeter);
            const units = measured.MeasurementUnitsCodeSequence;
            expect(units.CodeValue).toBe('1');
        });

        it("Ellipse Unit", () => {
            const r = 10;
            const props = {
                points: [{x: 3, y: 5}, {x: 6, y: 1}],
                areaUnit: 'px\xB2',
                area: 3.141592*r*r,
            };
            const circle = new Ellipse(props);
            const value = circle.contentItem();
            expect(value.length).toBe(3);
            const measured = value[2].MeasuredValueSequence;
            expect(measured.NumericValue).toBe(props.area);
            const units = measured.MeasurementUnitsCodeSequence;
            expect(units.CodeValue).toBe('1');
        });

        it("Bidirectional Create", () => {
            const bidir = new Bidirectional({
                longAxis: {
                    point1: {x: 3, y: 5},
                    point2: {x: 6, y: 1},
                },
                shortAxis: {
                    point1: {x: 3, y: 5},
                    point2: {x: 6, y: 1},
                },
                unit: 'px',
                longAxisLength: 3.14,
                shortAxisLenght: 1.5,
            });
            const value = bidir.contentItem();
            expect(value.length).toBe(4);
            const measured = value[2].MeasuredValueSequence;
            expect(measured.NumericValue).toBe(3.14);
            const units = measured.MeasurementUnitsCodeSequence;
            expect(units.CodeValue).toBe('1');
        });

    });
});

