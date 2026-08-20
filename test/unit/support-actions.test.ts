import { describe, expect, it } from "vitest";
import {
	classifyMechanicStep,
	isSupportAction,
} from "../../src/support-actions.ts";

describe("classifyMechanicStep", () => {
	describe("true positives: pure read/instruction-load mechanics", () => {
		it.each([
			"Read the mandatory workflow instructions",
			"Read the deployment runbook",
			"read the mandatory workflow instructions",
			"  Read the deployment runbook  ",
			"Load the workflow instructions",
			"Review the mandatory instructions",
			"Instruction loading",
			"instruction load",
		])("classifies %j as a read mechanic", (text) => {
			expect(classifyMechanicStep(text)).toBe("read");
		});
	});

	describe("true positives: pure commit mechanics", () => {
		it.each([
			"git commit the changes",
			"Create commit for release changes",
			"Commit the changes",
			"Commit the work",
			"Commit the code",
			"Make a commit",
			"Prepare commit for the release",
		])("classifies %j as a commit mechanic", (text) => {
			expect(classifyMechanicStep(text)).toBe("commit");
		});
	});

	describe("false positives fixed: deliverable steps that merely start with a mechanic word", () => {
		it.each([
			"Read the API response and validate its shape",
			"Read and parse the CSV file, then generate a summary report",
			"Read the migration file and confirm the schema matches the design spec",
			"Write commit message validation logic for the release CLI",
			"Implement retry handling for malformed instruction loading requests",
		])("does not classify %j as a mechanic step", (text) => {
			expect(classifyMechanicStep(text)).toBeUndefined();
		});
	});

	describe("other near-miss deliverable steps", () => {
		it.each([
			"Read the config schema, then implement validation for missing fields",
			"Review the instructions module and refactor its exports",
			"Create commit-message linting rules for the release pipeline",
			"Commit the changes required by the new schema, after updating the migration",
		])("does not classify %j as a mechanic step", (text) => {
			expect(classifyMechanicStep(text)).toBeUndefined();
		});
	});

	it("returns undefined for empty or whitespace-only text", () => {
		expect(classifyMechanicStep("")).toBeUndefined();
		expect(classifyMechanicStep("   ")).toBeUndefined();
	});

	it("returns undefined for ordinary deliverable text unrelated to reads or commits", () => {
		expect(
			classifyMechanicStep("Ship the reducer change and add tests"),
		).toBeUndefined();
	});
});

describe("isSupportAction", () => {
	it.each([
		"read",
		"Read",
		"read_file",
		"cat",
		"grep",
		"search",
		"glob",
		"list",
		"list_dir",
		"ls",
		"instruction_load",
		"load_instruction",
		"load_instructions",
		"tool_discovery",
		"discover_tool",
		"discover_tools",
	])("treats %j as a support action", (action) => {
		expect(isSupportAction(action)).toBe(true);
	});

	it.each([
		"",
		"   ",
		"edit",
		"write_file",
		"git commit",
		"npm pack --dry-run",
		"read the file",
	])("does not treat %j as a support action", (action) => {
		expect(isSupportAction(action)).toBe(false);
	});
});
