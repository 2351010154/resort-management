// The authenticated realm. Every screen family the console grows lives under
// this group, so this layout is where the things that must be true on all of
// them are mounted: the session guard, the persistent navigation, the global
// hotkey listener, and the command palette.
//
// It is empty on purpose. Those pieces have an owner further along in the
// console's build-out, and a placeholder navigation invented here would be a
// second opinion about the screen inventory that the real one has to undo.
//
// What must not happen is screens arriving first. The keyboard layer is a
// property of every screen at once — focus order, an escape route from any
// modal, one palette that reaches every command — and retrofitting that onto
// twenty screens already written mouse-first is a rewrite, not a refactor.
// This layout exists now so the layer has somewhere to land before then.

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return children;
}
