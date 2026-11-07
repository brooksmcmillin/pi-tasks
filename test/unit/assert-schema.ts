import { expect } from "vitest";

// Validate the JSON Schema subset emitted by src/schema.ts, including unknown keys.
export function assertSchema(
	schema: Record<string, unknown>,
	value: unknown,
): void {
	if (schema.type === "object") {
		expect(value).not.toBeNull();
		expect(typeof value).toBe("object");
		expect(Array.isArray(value)).toBe(false);
		const record = value as Record<string, unknown>;
		const properties = schema.properties as Record<
			string,
			Record<string, unknown>
		>;
		for (const required of schema.required as string[])
			expect(record).toHaveProperty(required);
		for (const [key, field] of Object.entries(record)) {
			const property = properties[key];
			expect(property, `Undeclared property ${key}`).toBeDefined();
			if (property) assertSchema(property, field);
		}
	} else if (schema.type === "array") {
		expect(Array.isArray(value)).toBe(true);
		const values = value as unknown[];
		if (typeof schema.minItems === "number")
			expect(values.length).toBeGreaterThanOrEqual(schema.minItems);
		if (typeof schema.maxItems === "number")
			expect(values.length).toBeLessThanOrEqual(schema.maxItems);
		for (const item of values)
			assertSchema(schema.items as Record<string, unknown>, item);
	} else {
		expect(typeof value).toBe(schema.type);
		if (Array.isArray(schema.enum)) expect(schema.enum).toContain(value);
		if ("const" in schema) expect(value).toBe(schema.const);
		if (typeof value === "string") {
			if (typeof schema.minLength === "number")
				expect(value.length).toBeGreaterThanOrEqual(schema.minLength);
			if (typeof schema.maxLength === "number")
				expect(value.length).toBeLessThanOrEqual(schema.maxLength);
		}
		if (typeof value === "number") {
			if (schema.integer) expect(Number.isInteger(value)).toBe(true);
			if (typeof schema.minimum === "number")
				expect(value).toBeGreaterThanOrEqual(schema.minimum);
		}
	}
}
