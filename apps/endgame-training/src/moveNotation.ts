/** Coordinates remain in chess data; visible move labels use Rust notation. */
export function moveNotationLabel(notation?: string) {
  return notation && !/^[a-i][0-9][a-i][0-9]$/i.test(notation) ? notation : "着法待核对";
}
