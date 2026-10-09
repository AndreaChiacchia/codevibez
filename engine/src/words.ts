export function plural(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return count === 1 ? singular : pluralForm;
}

export function counted(
  count: number,
  singular: string,
  pluralForm = `${singular}s`,
): string {
  return `${count} ${plural(count, singular, pluralForm)}`;
}
