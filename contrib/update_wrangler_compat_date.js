import { Glob } from "bun";

const newDate = Bun.argv[2];
if (!newDate) {
	console.error("❌ Error: Please provide a date as an argument (e.g., 2026-03-31)");
	process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
	console.error("❌ Error: Date must be in YYYY-MM-DD format.");
	process.exit(1);
}

const glob = new Glob("packages/*/wrangler.jsonc");
let updateCount = 0;

for await (const path of glob.scan(".")) {
	// Skip node_modules and dist folders
	if (path.includes("node_modules") || path.includes("dist")) continue;

	const file = Bun.file(path);
	const content = await file.text();

	const updatedContent = content.replace(
		/"compatibility_date":\s*"[^"]*"/g,
		`"compatibility_date": "${newDate}"`,
	);

	if (content !== updatedContent) {
		await Bun.write(path, updatedContent);
		console.log(`✅ Updated: ${path}`);
		updateCount++;
	} else {
		console.log(`⏩ No change needed for: ${path}`);
	}
}

if (updateCount === 0) {
	console.log("⏩ No files needed updating.");
	process.exit(0);
}

console.log(`✅ Updated compatibility_date to ${newDate} in ${updateCount} files.`);
