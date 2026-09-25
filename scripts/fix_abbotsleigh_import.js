const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const repoRoot = path.join(__dirname, "..");
const qbPath = path.join(repoRoot, "Physics.qb");
const jsonPath = path.join(repoRoot, "abbotsleigh_2023_physics_trials_import.json");
const courseJsonPath = path.join(repoRoot, ".tmp_physics_course.json");

if (!fs.existsSync(qbPath)) {
  console.error("Missing Physics.qb in repo root");
  process.exit(1);
}

const ps = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead(${JSON.stringify(qbPath)})
$e = $zip.GetEntry("course.json")
if (-not $e) { throw "course.json not in Physics.qb" }
$r = New-Object System.IO.StreamReader($e.Open())
$json = $r.ReadToEnd()
$r.Close()
$zip.Dispose()
[System.IO.File]::WriteAllText(${JSON.stringify(courseJsonPath)}, $json, [System.Text.UTF8Encoding]::new($false))
`;
execFileSync("powershell.exe", ["-NoProfile", "-Command", ps], { stdio: "inherit" });

const qb = JSON.parse(fs.readFileSync(courseJsonPath, "utf8"));
const doc = JSON.parse(fs.readFileSync(jsonPath, "utf8"));

const nodeById = new Map();
function walk(nodes, parentPath) {
  for (const n of nodes) {
    const full = parentPath ? parentPath + " / " + n.name : n.name;
    nodeById.set(n.node_id, full);
    if (n.children) walk(n.children, full);
  }
}
walk(qb.course.nodes, "");

const mapping = {
  0: ["3706695b37ae"],
  1: ["70043cc668ee"],
  2: ["70043cc668ee"],
  3: ["f8a86b9f6766"],
  4: ["3a5b0886a30d"],
  5: ["8463e8b0a7df"],
  6: ["0e16f5c99712"],
  7: ["12a879ec9415", "efa9d856f799"],
  8: ["0a4e515c7d59"],
  9: ["982608e70eeb"],
  10: ["dba128cbf88c"],
  11: ["380c0fd3b309"],
  12: ["4838a9643b9c"],
  13: ["b2cb111f97ef"],
  14: ["4ad306a2f154"],
  15: ["0d700ed77504", "2e213f7c5bf2"],
  16: ["99a4d04d6263"],
  17: ["0d700ed77504"],
  18: ["8c850eaa294a"],
  19: ["d4cc5c6dc848"],
  20: ["7084f9c4d2fe"],
  21: ["5eb28be8e46f", "0fb29f37a04a"],
  22: ["18c6390fe313", "2a7b07f04e72", "8c850eaa294a", "5eb28be8e46f"],
  23: ["982608e70eeb"],
  24: ["0a4e515c7d59", "ae449050e01b"],
  25: ["71f690564a58"],
  26: ["7f8407d45837"],
  27: ["9cb537de0a8a"],
  28: ["1698adf88760", "d3d37a52b98a"],
  29: ["c4bbc183f46f"],
  30: ["48e78d532810", "84397fac6249", "ae0c52451cb9", "8b10295987d0"],
  31: ["18c6390fe313", "219a77ca2dc4"],
  32: ["2d3523a41b98", "cddf7edfa25e", "8ce852918d2d"],
  33: ["c2409765d7bd", "3037a529c755"],
};

doc.course_name = qb.course.name;

const errors = [];
doc.questions.forEach((q, i) => {
  const ids = mapping[i];
  if (!ids) {
    errors.push(`No mapping for question ${i}`);
    return;
  }
  const names = [];
  for (let id of ids) {
    if (!id.startsWith("node_")) id = "node_" + id;
    const p = nodeById.get(id);
    if (!p) {
      errors.push(`Q${i}: unknown node_id ${id}`);
      continue;
    }
    names.push(p);
  }
  q.node_names = names;
});

if (errors.length) {
  console.error("ERRORS:\n" + errors.join("\n"));
  process.exit(1);
}

fs.writeFileSync(jsonPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
try {
  fs.unlinkSync(courseJsonPath);
} catch {
  /* ignore */
}

console.log("OK: course_name + node_names written to " + doc.questions.length + " questions");
for (let i = 0; i < doc.questions.length; i++) {
  console.log(String(i).padStart(2) + ": " + doc.questions[i].node_names.join(" || "));
}
