if (ds.PatientName === "Anonymous") clear();
const family = ds.PatientName.split("^")[0];
const isText = typeof ds.ReferringPhysicianName === "string";
const alphabetic = ds.PatientName[0].Alphabetic;
const others = ds.PerformingPhysicianName.map(String);
