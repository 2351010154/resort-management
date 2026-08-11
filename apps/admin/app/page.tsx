// The console's entry point, and the only route the scaffold ships.
//
// A Next app with no route at all builds vacuously: nothing compiles the
// layouts, nothing resolves the token import, nothing pins React's version
// against the installed types. One route makes `next build` a real check of
// the scaffold instead of a check that the directory exists.
//
// It renders no navigation and no shell on purpose — both belong to the (app)
// layout, and a second opinion about them invented here would have to be
// undone. Once staff sessions exist this becomes a redirect: to the dashboard
// when one is present, to the login screen under (auth) when it is not.

export default function ConsoleIndexPage() {
  return <main>Mariva Console</main>;
}
