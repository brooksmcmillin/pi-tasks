import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	checkpoint,
	type RecoveryCheckpoint,
	recoveryChecks,
	repositoryIdentity,
} from "../../src/compaction-recovery.ts";
import { createTaskRuntimeStore } from "../../src/store.ts";

const dirs: string[] = [];
afterEach(() => {
	for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
function repo() {
	const cwd = mkdtempSync(join(tmpdir(), "compaction-recovery-"));
	dirs.push(cwd);
	const git = (...args: string[]) =>
		execFileSync("git", args, { cwd, stdio: "pipe" });
	git("init", "-b", "pilot");
	git(
		"-c",
		"user.name=Test",
		"-c",
		"user.email=test@example.com",
		"commit",
		"--allow-empty",
		"-m",
		"fixture",
	);
	return { cwd, git };
}
function saved(): RecoveryCheckpoint {
	return {
		version: 1,
		id: "checkpoint",
		taskId: "T1",
		stepId: "S1",
		revision: "r1",
		repository: {
			cwd: "/fixture",
			branch: "pilot",
			head: "h1",
			dirtyStateReference: "d1",
		},
		prHeads: [{ url: "pr", head: "p1", reference: "pr-read" }],
		authorizationSources: ["session-entry:user"],
		gates: [],
		evidence: [
			{ id: "E1", references: ["tests"], revision: "h1" },
			{ id: "E2", references: ["unbound"], revision: null },
		],
		children: ["existing-child"],
		allowedActions: ["edit", "read"],
		nextAction: "Edit bounded fixture",
	};
}
describe("operation-scoped recovery", () => {
	it("retains unknown authority, PR and child observations by default", () => {
		const result = recoveryChecks(saved(), saved());
		expect(result).toMatchObject({
			identity: "pass",
			authority: "unknown",
			children: "unknown",
			pr: "unknown",
			authorityGranted: false,
		});
		expect(result.evidence).toEqual([
			{ id: "E1", result: "pass" },
			{ id: "E2", result: "unknown" },
		]);
	});
	it("compares fresh operation-scoped observations without granting execution permission", () => {
		const result = recoveryChecks(saved(), saved(), {
			operation: "read",
			authorizationSource: "session-entry:user",
			authorizationRevision: "r1",
			prHeads: [{ url: "pr", head: "p1" }],
			children: [{ runId: "existing-child", status: "running" }],
		});
		expect(result).toMatchObject({
			authority: "pass",
			children: "pass",
			pr: "pass",
			authorityGranted: false,
		});
		expect(result.instruction).toContain("never relaunch");
	});
	it("does not reuse approval for new scope or revision and only invalidates affected evidence", () => {
		const original = saved();
		for (const current of [
			{ ...original, revision: "r2" },
			{ ...original, gates: ["approval pending"] },
		])
			expect(
				recoveryChecks(original, current, {
					operation: "edit",
					authorizationSource: "session-entry:user",
					authorizationRevision: "r1",
				}).authority,
			).toBe("mismatch");
		expect(
			recoveryChecks(original, original, { operation: "deploy" }).authority,
		).toBe("mismatch");
		const current = { ...original, evidence: original.evidence.slice(1) };
		expect(recoveryChecks(original, current).evidence).toEqual([
			{ id: "E1", result: "mismatch" },
			{ id: "E2", result: "unknown" },
		]);
		expect(recoveryChecks(original, undefined).identity).toBe("unknown");
	});
	it.each([
		"taskId",
		"stepId",
		"revision",
		"cwd",
		"branch",
		"head",
		"dirtyStateReference",
	])(
		"reports exact %s identity mismatch without discarding independent evidence",
		(field) => {
			const original = saved();
			const current = structuredClone(original);
			if (field === "taskId" || field === "stepId" || field === "revision")
				current[field] = "changed";
			else
				current.repository[field as keyof typeof current.repository] =
					"changed";
			const result = recoveryChecks(original, current);
			expect(result.identity).toBe("mismatch");
			expect(result.authorityGranted).toBe(false);
			expect(result.evidence[0]?.result).toBe(
				field === "head" ? "mismatch" : "pass",
			);
			expect(result.evidence[1]?.result).toBe("unknown");
		},
	);
	it.each([
		{ authorizationSource: "session-entry:stale", authorizationRevision: "r1" },
		{
			authorizationSource: "session-entry:user",
			authorizationRevision: "old-revision",
		},
	])(
		"rejects stale source/revision observations %# without invalidating unrelated evidence",
		(observation) => {
			const result = recoveryChecks(saved(), saved(), {
				operation: "read",
				...observation,
			});
			expect(result.authority).toBe("mismatch");
			expect(result.authorityGranted).toBe(false);
			expect(result.identity).toBe("pass");
			expect(result.evidence[0]?.result).toBe("pass");
		},
	);
	it("reports moved PR head and missing child identity independently", () => {
		const result = recoveryChecks(saved(), saved(), {
			operation: "read",
			authorizationSource: "session-entry:user",
			authorizationRevision: "r1",
			prHeads: [{ url: "pr", head: "new-published-head" }],
			children: [{ runId: "different-run", status: "completed" }],
		});
		expect(result).toMatchObject({
			identity: "pass",
			authority: "pass",
			pr: "mismatch",
			children: "mismatch",
			authorityGranted: false,
		});
		expect(result.evidence[0]?.result).toBe("pass");
		expect(result.instruction).toContain(
			"Authorization mismatch stops the affected action, not unrelated safe work",
		);
	});
	it("fingerprints HEAD, dirty tracked/index/untracked state without following symlinks", () => {
		const { cwd, git } = repo();
		const initial = repositoryIdentity(cwd);
		if (!initial) throw new Error("Missing initial repository identity");
		writeFileSync(join(cwd, "untracked"), "first");
		const dirty = repositoryIdentity(cwd);
		if (!dirty) throw new Error("Missing dirty repository identity");
		expect(dirty.dirtyStateReference).not.toBe(initial.dirtyStateReference);
		git("add", "untracked");
		expect(repositoryIdentity(cwd)?.dirtyStateReference).not.toBe(
			dirty.dirtyStateReference,
		);
		symlinkSync("/missing/private-target", join(cwd, "link"));
		expect(repositoryIdentity(cwd)).toBeDefined();
		expect(repositoryIdentity(undefined)).toBeUndefined();
	});
	it("fingerprints the entire worktree from a nested session cwd", () => {
		const { cwd } = repo();
		const nested = join(cwd, "nested");
		mkdirSync(nested);
		writeFileSync(join(nested, "inside"), "inside-first");
		writeFileSync(join(cwd, "outside"), "outside-first");
		const initial = repositoryIdentity(nested);
		expect(initial).toBeDefined();
		expect(initial).toEqual(repositoryIdentity(cwd));
		writeFileSync(join(cwd, "outside"), "outside-second");
		const outside = repositoryIdentity(nested);
		expect(outside).toEqual(repositoryIdentity(cwd));
		expect(outside?.dirtyStateReference).not.toBe(initial?.dirtyStateReference);
		writeFileSync(join(nested, "inside"), "inside-second");
		const inside = repositoryIdentity(nested);
		expect(inside).toEqual(repositoryIdentity(cwd));
		expect(inside?.dirtyStateReference).not.toBe(outside?.dirtyStateReference);
	});
	it("unknown task/checkpoint state never becomes a valid checkpoint", () => {
		expect(
			checkpoint(createTaskRuntimeStore().getState(), [], undefined),
		).toBeUndefined();
	});
});
