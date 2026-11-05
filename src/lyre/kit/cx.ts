/** Joins class names, leaving out empty ones: cx("btn", primary && "primary"). */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
