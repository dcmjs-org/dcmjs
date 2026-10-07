//
// Handle DICOM and CIELAB colors
// based on:
// https://github.com/DCMTK/dcmtk/blob/88105877c3b610e23fc9422ba6a84af85552f5dd/dcmiod/libsrc/cielabutil.cc
//
// RGB here refers to sRGB 0-1 per component.
// dicomlab is CIELAB values as defined in the dicom standard
// XYZ is CIEXYZ convention, relative to the D50 white point (ICC PCS)
//
// DICOM encodes CIELab values in the same way as the ICC Profile Connection
// Space (PCS, see PS3.3 C.10.7.1.1), i.e. relative to the D50 illuminant,
// whereas the native white point of sRGB is D65. The conversions below
// therefore chromatically adapt between the two using the linear Bradford
// transform. Matrices and constants are those of the CSS Color Module Level 4
// sample code (https://www.w3.org/TR/css-color-4/#color-conversion-code).
//

// White points, defined by their 4-figure CIE x,y chromaticities
const D50_WHITEPOINT_XYZ = [
    0.3457 / 0.3585,
    1.0,
    (1.0 - 0.3457 - 0.3585) / 0.3585
];
const D65_WHITEPOINT_XYZ = [
    0.3127 / 0.329,
    1.0,
    (1.0 - 0.3127 - 0.329) / 0.329
];

class Colors {
    static d50WhitePointXYZ() {
        // white point of D50 illuminant (ICC PCS, reference white for DICOM CIELab)
        return [...D50_WHITEPOINT_XYZ];
    }

    static d65WhitePointXYZ() {
        // white point of D65 illuminant (native white point of sRGB)
        return [...D65_WHITEPOINT_XYZ];
    }

    static dicomlab2RGB(dicomlab) {
        return Colors.lab2RGB(Colors.dicomlab2LAB(dicomlab));
    }

    static rgb2DICOMLAB(rgb) {
        return Colors.lab2DICOMLAB(Colors.rgb2LAB(rgb));
    }

    // 16 bit DICOM CIELab -> 8 bit sRGB, rounded and clamped
    static dicomlab2RGB8(dicomlab) {
        return Colors.dicomlab2RGB(dicomlab).map(n =>
            Colors.roundClamp(n * 255.0, 255)
        );
    }

    // 8 bit sRGB -> 16 bit DICOM CIELab, rounded and clamped
    static rgb82DICOMLAB(rgb) {
        return Colors.rgb2DICOMLAB(rgb.map(n => n / 255.0)).map(n =>
            Colors.roundClamp(n, 65535)
        );
    }

    static dicomlab2LAB(dicomlab) {
        return [
            (dicomlab[0] * 100.0) / 65535.0, // results in 0 <= L <= 100
            (dicomlab[1] * 255.0) / 65535.0 - 128, // results in -128 <= a <= 127
            (dicomlab[2] * 255.0) / 65535.0 - 128 // results in -128 <= b <= 127
        ];
    }

    static lab2DICOMLAB(lab) {
        return [
            (lab[0] * 65535.0) / 100.0, // results in 0 <= L <= 65535
            ((lab[1] + 128) * 65535.0) / 255.0, // results in 0 <= a <= 65535
            ((lab[2] + 128) * 65535.0) / 255.0 // results in 0 <= b <= 65535
        ];
    }

    static rgb2LAB(rgb) {
        return Colors.xyz2LAB(Colors.rgb2XYZ(rgb));
    }

    static gammaCorrection(n) {
        // sRGB transfer function (IEC 61966-2-1), linear to gamma-encoded
        if (n <= 0.0031308) {
            return 12.92 * n;
        } else {
            return 1.055 * Math.pow(n, 1 / 2.4) - 0.055;
        }
    }

    static invGammaCorrection(n) {
        // sRGB transfer function (IEC 61966-2-1), gamma-encoded to linear
        if (n <= 0.04045) {
            return n / 12.92;
        } else {
            return Math.pow((n + 0.055) / 1.055, 2.4);
        }
    }

    static rgb2XYZ(rgb) {
        // sRGB to linear RGB
        const R = Colors.invGammaCorrection(rgb[0]);
        const G = Colors.invGammaCorrection(rgb[1]);
        const B = Colors.invGammaCorrection(rgb[2]);

        // linear RGB to CIE XYZ (D65)
        const X65 =
            (506752.0 / 1228815.0) * R +
            (87881.0 / 245763.0) * G +
            (12673.0 / 70218.0) * B;
        const Y65 =
            (87098.0 / 409605.0) * R +
            (175762.0 / 245763.0) * G +
            (12673.0 / 175545.0) * B;
        const Z65 =
            (7918.0 / 409605.0) * R +
            (87881.0 / 737289.0) * G +
            (1001167.0 / 1053270.0) * B;

        // chromatic adaptation D65 to D50 (linear Bradford)
        return [
            1.0479297925449969 * X65 +
                0.022946870601609652 * Y65 -
                0.05019226628920524 * Z65,
            0.02962780877005599 * X65 +
                0.9904344267538799 * Y65 -
                0.017073799063418826 * Z65,
            -0.009243040646204504 * X65 +
                0.015055191490298152 * Y65 +
                0.7518742814281371 * Z65
        ];
    }

    static xyz2LAB(xyz) {
        let X = xyz[0] / D50_WHITEPOINT_XYZ[0];
        let Y = xyz[1] / D50_WHITEPOINT_XYZ[1];
        let Z = xyz[2] / D50_WHITEPOINT_XYZ[2];
        X = Colors.labf(X);
        Y = Colors.labf(Y);
        Z = Colors.labf(Z);
        return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
    }

    static lab2RGB(lab) {
        return Colors.xyz2RGB(Colors.lab2XYZ(lab));
    }

    static lab2XYZ(lab) {
        let L = (lab[0] + 16) / 116;
        let a = L + lab[1] / 500;
        let b = L - lab[2] / 200;
        return [
            D50_WHITEPOINT_XYZ[0] * Colors.labfInv(a),
            D50_WHITEPOINT_XYZ[1] * Colors.labfInv(L),
            D50_WHITEPOINT_XYZ[2] * Colors.labfInv(b)
        ];
    }

    static xyz2RGB(xyz) {
        const [X, Y, Z] = xyz;

        // chromatic adaptation D50 to D65 (linear Bradford)
        const X65 =
            0.955473421488075 * X -
            0.02309845494876471 * Y +
            0.06325924320057072 * Z;
        const Y65 =
            -0.0283697093338637 * X +
            1.0099953980813041 * Y +
            0.021041441191917323 * Z;
        const Z65 =
            0.012314014864481998 * X -
            0.020507649298898964 * Y +
            1.330365926242124 * Z;

        // CIE XYZ (D65) to linear RGB
        const R1 =
            (12831.0 / 3959.0) * X65 -
            (329.0 / 214.0) * Y65 -
            (1974.0 / 3959.0) * Z65;
        const G1 =
            (-851781.0 / 878810.0) * X65 +
            (1648619.0 / 878810.0) * Y65 +
            (36519.0 / 878810.0) * Z65;
        const B1 =
            (705.0 / 12673.0) * X65 -
            (2585.0 / 12673.0) * Y65 +
            (705.0 / 667.0) * Z65;

        // Clip to the sRGB gamut (also makes sure that gamma encoding is
        // well-defined), then transform from linear RGB to sRGB
        return [
            Colors.gammaCorrection(Colors.clamp01(R1)),
            Colors.gammaCorrection(Colors.clamp01(G1)),
            Colors.gammaCorrection(Colors.clamp01(B1))
        ];
    }

    static labf(n) {
        // epsilon = (6/29)^3 = 216/24389, kappa = (29/3)^3 = 24389/27
        if (n > 216.0 / 24389.0) {
            return Math.cbrt(n);
        } else {
            return ((24389.0 / 27.0) * n + 16.0) / 116.0;
        }
    }

    static labfInv(n) {
        // n > 6/29 <=> n^3 > epsilon
        if (n > 6.0 / 29.0) {
            return n * n * n;
        } else {
            return (116.0 * n - 16.0) / (24389.0 / 27.0);
        }
    }

    static clamp01(n) {
        return Math.min(1.0, Math.max(0.0, n));
    }

    static roundClamp(n, max) {
        if (n < 0.0) {
            return 0;
        }
        if (n > max) {
            return max;
        }
        return Math.floor(n + 0.5);
    }
}

export { Colors };
export default Colors;
