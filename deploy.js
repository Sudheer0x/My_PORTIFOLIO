
const fs = require("fs");
const path = require("path");
const ghpages = require("gh-pages");

const stagingDir = path.join(__dirname, ".pages-build");

const files = [
  "index.html",
  "style.css",
  "script.js",
  "images"
];

fs.rmSync(stagingDir, { recursive: true, force: true });
fs.mkdirSync(stagingDir, { recursive: true });

for (const file of files) {
  const source = path.join(__dirname, file);
  const destination = path.join(stagingDir, file);

  if (!fs.existsSync(source)) {
    throw new Error(`Required frontend file not found: ${file}`);
  }

  fs.cpSync(source, destination, { recursive: true });
}

ghpages.publish(stagingDir, {
  branch: "gh-pages",
  repo: "https://github.com/Sudheer0x/My_PORTIFOLIO.git",
  dotfiles: false
}, (error) => {
  if (error) {
    console.error("Deployment failed:", error);
    process.exitCode = 1;
  } else {
    console.log("Frontend deployed to GitHub Pages!");
  }
});
