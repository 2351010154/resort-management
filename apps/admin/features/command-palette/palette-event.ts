export const OPEN_COMMAND_PALETTE_EVENT = "mariva:open-command-palette";

export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_COMMAND_PALETTE_EVENT));
}
