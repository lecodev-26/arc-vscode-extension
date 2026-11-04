/** Validate database identifiers using Arc's database creation rules. */
export function validateDatabaseName(name: string): string | undefined {
  if (!name) {
    return 'Database name is required';
  }
  if (name.length > 64 || !/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    return 'Use 1–64 characters: start with a letter, then use letters, numbers, underscores, or hyphens.';
  }
  if (['system', 'internal', '_internal'].includes(name.toLowerCase())) {
    return `Database name "${name}" is reserved by Arc.`;
  }
  return undefined;
}
