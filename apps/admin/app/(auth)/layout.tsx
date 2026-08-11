// The unauthenticated realm: the staff login screen and anything else that has
// to render before a session exists. It is a route group rather than a path
// segment because the login screen's URL should not carry a folder name.
//
// Nothing here may import the shell, the navigation, or the command palette.
// That is the whole reason this group is separate from (app): those all assume
// a signed-in operator, and a layout that assumes one cannot be in the tree of
// the screen that creates one.

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
