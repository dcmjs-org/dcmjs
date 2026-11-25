if (String(ds.PatientName) === "Anonymous") clear();
const family = String(ds.PatientName).split("^")[0];
const isText = typeof ds.ReferringPhysicianName === "string";
const alphabetic = ds.PatientName[0].Alphabetic;
const others = ds.PerformingPhysicianName.map(String);
