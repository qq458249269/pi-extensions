#!/usr/bin/env node
// readme 表格列数自检：只管「每张表的每行格数 == 表头格数」这一件事。
// 单元格内的 `\|` 是转义竖线（如 `pi --version \| grep`、`| find`），先剥掉再切分。
// 用法：node check-readme-tables.mjs   不一致则 exit 1
import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "readme.md";
const lines = readFileSync(file, "utf8").split("\n");

const cells = (line) =>
	line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split(/(?<!\\)\|/).length;

let bad = 0;
let head = -1;
let width = 0;

lines.forEach((line, i) => {
	const t = line.trim();
	if (!t.startsWith("|")) {
		head = -1;
		return;
	}
	const n = cells(t);
	if (head === -1) {
		head = i + 1;
		width = n;
		return;
	}
	if (n !== width) {
		console.error(`行${i + 1} 列数=${n} ≠ 表头(行${head})列数=${width} : ${t.slice(0, 70)}`);
		bad++;
	}
});

console.log(bad ? `✗ ${file}：不一致行 ${bad}` : `✓ ${file}：所有表格列数一致`);
process.exit(bad ? 1 : 0);