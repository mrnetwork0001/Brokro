/**
 * Minimal, zero-dependency JSON Schema validator for SERV Reasoning outputs.
 *
 * Runs identically in Next.js server routes and under `node --test` without
 * code generation or external validator bloat. Every SERV step binds its
 * response to a strict schema and re-validates locally before passing data
 * downstream.
 */

export interface JsonSchema {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  enum?: readonly (string | number | boolean)[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  description?: string;
}

export function validate(schema: JsonSchema, value: unknown, path = "$"): string[] {
  const errors: string[] = [];

  if (schema.enum && !schema.enum.includes(value as never)) {
    errors.push(`${path}: expected one of [${schema.enum.join(", ")}], got ${JSON.stringify(value)}`);
    return errors;
  }

  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      errors.push(`${path}: expected object, got ${Array.isArray(value) ? "array" : typeof value}`);
      return errors;
    }
    const obj = value as Record<string, unknown>;
    if (schema.required) {
      for (const reqKey of schema.required) {
        if (!(reqKey in obj) || obj[reqKey] === undefined) {
          errors.push(`${path}.${reqKey}: missing required field`);
        }
      }
    }
    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(obj)) {
        if (!(key in schema.properties)) {
          errors.push(`${path}.${key}: unexpected additional property`);
        }
      }
    }
    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (key in obj && obj[key] !== undefined) {
          errors.push(...validate(propSchema, obj[key], `${path}.${key}`));
        }
      }
    }
    return errors;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      errors.push(`${path}: expected array, got ${typeof value}`);
      return errors;
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      errors.push(`${path}: expected at least ${schema.minItems} items, got ${value.length}`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      errors.push(`${path}: expected at most ${schema.maxItems} items, got ${value.length}`);
    }
    if (schema.items) {
      value.forEach((item, idx) => {
        errors.push(...validate(schema.items!, item, `${path}[${idx}]`));
      });
    }
    return errors;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      errors.push(`${path}: expected string, got ${typeof value}`);
      return errors;
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: string shorter than minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      errors.push(`${path}: string exceeds maxLength ${schema.maxLength}`);
    }
    return errors;
  }

  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      errors.push(`${path}: expected finite ${schema.type}, got ${typeof value}`);
      return errors;
    }
    if (schema.type === "integer" && !Number.isInteger(value)) {
      errors.push(`${path}: expected integer, got ${value}`);
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      errors.push(`${path}: ${value} is below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      errors.push(`${path}: ${value} exceeds maximum ${schema.maximum}`);
    }
    return errors;
  }

  if (schema.type === "boolean") {
    if (typeof value !== "boolean") {
      errors.push(`${path}: expected boolean, got ${typeof value}`);
    }
    return errors;
  }

  return errors;
}
