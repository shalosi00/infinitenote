/**
 * English plural forms for UI strings.
 *
 * The UI used to render these through next-intl ICU messages
 * ("{count, plural, =1 {1 page} other {# pages}}"); with the English-only
 * UI the rule is trivial — the `one` branch for 1, the `other` branch
 * otherwise, with "#" replaced by the count.
 */

/** plural(1, "1 page", "# pages") → "1 page"; plural(3, …) → "3 pages". */
export function plural(count: number, one: string, other: string): string {
  return (count === 1 ? one : other).replaceAll("#", String(count));
}
