import type { ExtensionAPI } from "../../src/pi-types.ts";
import { fakeSemanticRuntime } from "../unit/semantic-fixture.ts";

// Offline semantic transport for native lifecycle tests; never load in user sessions.
export default function (pi: ExtensionAPI) {
	pi.on("session_start", (_event, ctx) => {
		if (!ctx.modelRegistry) throw new Error("Native test registry is missing");
		Object.assign(ctx.modelRegistry, fakeSemanticRuntime().modelRegistry);
	});
}
