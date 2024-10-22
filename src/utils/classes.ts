/**
 * Join class names together with a space separator.
 * @param classNames The class names to be joined 
 * @returns {string}
 */
export default function classes(...classNames: Array<string | undefined | null | false>): string {
  return classNames.filter(Boolean).join(" ");
}