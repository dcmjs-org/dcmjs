
const dcmjs = require('../../build/dcmjs');

const jsonDataset = `{
    "AccessionNumber": "",
    "AcquisitionMatrix": [ 256, 0, 0, 192 ],
    "AcquisitionNumber": "8",
    "BitsAllocated": 16,
    "BitsStored": 16,
    "Columns": 256,
    "ContentDate": "20020628",
    "ContentTime": "164936.0",
    "ContrastBolusAgent": "",
    "DeviceSerialNumber": "4168496325",
    "EchoTime": "6",
    "EchoTrainLength": "1",
    "FlipAngle": "3",
    "FrameOfReferenceUID": "2.16.840.1.113662.4.4168496325.1025305873.7118351817185979330",
    "HighBit": 15,
    "ImageOrientationPatient": [ "0.00000e+00", "1.00000e+00", "-0.00000e+00", "-0.00000e+00", "0.00000e+00", "-1.00000e+00" ],
    "ImagePositionPatient": [ "6.454490e+01", "-1.339286e+02", "1.167857e+02" ],
    "ImageType": [ "ORIGINAL", "PRIMARY", "OTHER" ],
    "ImagesInAcquisition": "130",
    "ImagingFrequency": "6.37165e+01",
    "InstanceNumber": "18",
    "InstitutionName": "UCI Medical Center",
    "MRAcquisitionType": "",
    "MagneticFieldStrength": "1.5",
    "Manufacturer": "Marconi Medical Systems, Inc.",
    "ManufacturerModelName": "Eclipse 1.5T",
    "Modality": "MR",
    "NumberOfAverages": "1",
    "NumberOfTemporalPositions": "1",
    "OperatorsName": "SSRT/^^^^",
    "PatientAge": "039Y",
    "PatientBirthDate": "19000000",
    "PatientID": "0000000",
    "PatientName": "Zzzzzz^Yyyyy^^^",
    "PatientPosition": "HFS",
    "PatientSex": "M",
    "PatientWeight": "99.773300",
    "PercentPhaseFieldOfView": "91.4062",
    "PhotometricInterpretation": "MONOCHROME2",
    "PixelRepresentation": 1,
    "PixelSpacing": [ "1.000000e+00", "1.000000e+00" ],
    "PositionReferenceIndicator": "BRAIN",
    "ProtocolName": "SAG/RF-FAST/VOL/FLIP 3",
    "ReceiveCoilName": "HEAD",
    "ReferencedImageSequence": {
        "ReferencedSOPClassUID": "1.2.840.10008.5.1.4.1.1.4",
        "ReferencedSOPInstanceUID": "2.16.840.1.113662.4.4168496325.1025306066.995213515550827262",
        "_vrMap": {}
    },
    "ReferringPhysicianName": "",
    "RepetitionTime": "20",
    "Rows": 256,
    "SOPClassUID": "1.2.840.10008.5.1.4.1.1.4",
    "SOPInstanceUID": "2.16.840.1.113662.4.4168496325.1025307679.1207625440068523197",
    "SamplesPerPixel": 1,
    "ScanOptions": "",
    "ScanningSequence": "GR",
    "SequenceVariant": [
        "SS",
        "SP"
    ],
    "SeriesDate": "20020628",
    "SeriesDescription": "SAG/RF-FAST/VOL/FLIP 3",
    "SeriesInstanceUID": "2.16.840.1.113662.4.4168496325.1025307678.3494705239865384161",
    "SeriesNumber": "5",
    "SeriesTime": "164118.0",
    "SliceLocation": "64.544899",
    "SliceThickness": "1.300000e+00",
    "SoftwareVersions": "VIA2.0E.003",
    "SpecificCharacterSet": "ISO_IR 100",
    "StationName": "ba187_ws",
    "StudyDate": "20020628",
    "StudyDescription": "BRAIN",
    "StudyID": "14024",
    "StudyInstanceUID": "2.16.840.1.113662.4.4168496325.1025305873.7118351817185979330",
    "StudyTime": "160956.0",
    "TemporalPositionIdentifier": "1",
    "TemporalResolution": "458660",
    "WindowCenter": "28",
    "WindowWidth": "20",
    "_meta": {
        "FileMetaInformationVersion": {
            "Value": [
                {
                    "0": 0,
                    "1": 1
                }
            ],
            "vr": "OB"
        },
        "ImplementationClassUID": {
            "Value": [
                "1.2.840.113819.7.1.1997.1.0"
            ],
            "vr": "UI"
        },
        "ImplementationVersionName": {
            "Value": [
                "SENSORSYSTEMS1.0"
            ],
            "vr": "SH"
        },
        "MediaStorageSOPClassUID": {
            "Value": [
                "1.2.840.10008.5.1.4.1.1.4"
            ],
            "vr": "UI"
        },
        "MediaStorageSOPInstanceUID": {
            "Value": [
                "2.16.840.1.113662.4.4168496325.1025307679.1207625440068523197"
            ],
            "vr": "UI"
        },
        "TransferSyntaxUID": {
            "Value": [
                "1.2.840.10008.1.2"
            ],
            "vr": "UI"
        }
    },
    "_vrMap": {
        "PixelData": "OW"
    }
}`;

const dataset = JSON.parse(jsonDataset);

pixelData = new Int16Array(dataset.Rows * dataset.Columns);
pixelData.fill(100);
dataset.PixelData = pixelData.buffer;


const dicomDict = dcmjs.data.datasetToDict(dataset);
const buffer = Buffer.from(dicomDict.write());

process.stdout.write(buffer);
