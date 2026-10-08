import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import register from "./state.ts";

export default function (pi: ExtensionAPI): void {
	register(
		pi,
		Type.Object({
			task_id: Type.String({ pattern: "^[1-9][0-9]*$" }),
			disposition: Type.Union(
				["proceed", "blocker", "decision", "wait", "complete", "stop"].map(
					(value) => Type.Literal(value),
				),
			),
			next_action: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
			reason: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
			blocked_by: Type.Optional(
				Type.Union(
					["external", "dependency", "authority", "ownership"].map((value) =>
						Type.Literal(value),
					),
				),
			),
		}),
	);
}
