// The console's entry point, and the only route the scaffold ships.
//
// A Next app with no route at all builds vacuously: nothing compiles the
// layouts, nothing resolves the token import, nothing pins React's version
// against the installed types. One route makes `next build` a real check of
// the scaffold instead of a check that the directory exists.
//
// Now it checks the styling layer too, which is why the markup below is set in
// utilities rather than left bare. Between them these classes exercise every
// part of globals.css that could silently fail to compile: a semantic colour
// (`text-muted-foreground`), a Mariva colour (`border-border` off the channel
// triplets), both faces, a display step and a shared step, the caps tracking,
// and the rhythm scale beside the multiplier. If the theme stops reaching the
// tokens, this page renders in Times New Roman on white and says so.
//
// It renders no navigation and no shell on purpose — both belong to the (app)
// layout, and a second opinion about them invented here would have to be
// undone. Once staff sessions exist this becomes a redirect: to the dashboard
// when one is present, to the login screen under (auth) when it is not.

export default function ConsoleIndexPage() {
  return (
    <main className="p-rhythm-3">
      <p className="text-muted-foreground text-xs tracking-caps uppercase">
        Mariva
      </p>
      <h1 className="font-display text-display-sm mt-2">Console</h1>
      <p className="text-muted-foreground mt-rhythm-1 border-border border-t pt-2">
        Front desk and management. No screens yet.
      </p>
    </main>
  );
}
