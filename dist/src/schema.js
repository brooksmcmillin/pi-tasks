export const Type = {
    Object(properties) {
        const required = Object.entries(properties)
            .filter(([, schema]) => !schema.optional)
            .map(([name]) => name);
        const normalized = Object.fromEntries(Object.entries(properties).map(([name, schema]) => {
            const { optional: _optional, ...rest } = schema;
            return [name, rest];
        }));
        return {
            type: "object",
            properties: normalized,
            required,
            additionalProperties: false,
        };
    },
    String(options = {}) {
        return { type: "string", ...options };
    },
    Number(options = {}) {
        return { type: "number", ...options };
    },
    Boolean(options = {}) {
        return { type: "boolean", ...options };
    },
    Array(item, options = {}) {
        return { type: "array", items: item, ...options };
    },
    Optional(schema) {
        return { ...schema, optional: true };
    },
    Enum(values, options = {}) {
        // Explicit type is required for Moonshot/Kimi ("moonshot flavored json
        // schema"). Bare `{ enum: [...] }` is draft-07-valid but rejected at
        // path e.g. plan_steps.items.properties.decompositionStatus.
        return { type: "string", enum: values, ...options };
    },
};
