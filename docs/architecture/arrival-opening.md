# The arrival's opening

Act 1 of the marketing arrival, and the three assets it is the only consumer of.
Behaviour lives in
[`apps/web/features/arrival/components/act-1-arrival/`](../../apps/web/features/arrival/components/act-1-arrival/);
this file owns the decisions that the code cannot state and the commands that
cut the assets.

## What the opening is

One photograph, seen through an aperture that changes across a pinned scroll:
two skewed windows holding two halves of it pulled apart over ivory, which
straighten and slide back into register until they are one rectangle, which then
grows past the edges of the viewport. The reference is `intro.mp4`, supplied as a
visual reference and not as application footage — nothing of it ships.

Two decisions were taken by the owner on 2026-09-06 and are not open:

- **The opening replaces the monogram lens entirely.** The WebGL aperture Act 1
  used to open with — the plaster wall, the eroding M, the depth card field and
  the push through the letter — is gone, along with its SDF, glyph tracer and
  video tiles. Act 1 no longer needs WebGL. The house's mark is still on the page
  in the concierge bar and in Act 6's embossed footer.
- **The opening ends on the photograph, with no wordmark.** The reference scales
  a display word up over its final frame; this one does not. The act's only copy
  is the statement it opens with, which leaves before the push.

  Reversed by the owner on 2026-09-11: the push now lands on a greeting — the
  house's name over one display line ("Stay a while.", the page's only `h1`)
  and a black pill to `/booking`, the act's one action — which resolves over
  the last of the travel, stands through a hold beat of its own — a bit
  over half a screen of scroll with neither the picture nor the ribbon moving —
  and dissolves across the last quarter-screen of that hold, landing exactly
  where the ribbon starts. The exit is that short because the
  ribbon's first opening looks back through at the same photograph in register:
  its leading edge carries no visible sheet, so type still standing when the
  edge climbs past is cut in half by an edge the reader cannot see, and the cut
  reads as a hairline ruled across the picture. The pill takes clicks only while the
  greeting is all but fully resolved, so it is never a target the reader cannot
  see they are hitting. Both the reading time and the length of
  the dissolve are therefore bought from the hold beat, never from the seam
  hold: a fade that starts where the ribbon does has to be over before it
  began. The reasoning for the reversal is that the final
  frame of the push otherwise carries exactly what its first frame did, only
  larger, so the travel arrives at nothing. It is still not the reference's
  scaling wordmark: the type does not move with the picture, it resolves in
  place once the picture has stopped.

The entry carries no holding curtain. The sealed composition — four windows at
half their open width — is in the server-rendered markup, so the first painted
frame is already the scene and the windows start widening on the first frame the
script owns rather than after an ivory sheet has lifted. Changed on 2026-09-11,
when the previous opening (a 0.9s curtain, the windows held until it was three
quarters gone, then a 2.4s cascade) was read as the page waiting to finish
loading before anything moved.

Since 2026-09-07 the act also holds its full photograph for one more viewport
after the push, for the length Act 2's ribbon takes to be born over it — see
[`arrival-ribbon.md`](arrival-ribbon.md).

The mark's heavy cut, [`mariva-monogram-intro.svg`](../../apps/web/public/brand/mariva-monogram-intro.svg)
and its generator, are kept although nothing renders them at runtime: it is the
measured record of the mark for any composition cut from the letterform.

## Assets

None of these are covered by `image-manifest.ts`, whose cutter reads a library
outside the repository and is gitignored — an entry added there by hand is lost
on the next run. They are declared in
[`hero-plate.ts`](../../apps/web/features/arrival/components/act-1-arrival/hero-plate.ts)
instead, beside their only consumer.

**The photograph.** `HOME_8_JUN-1.jpg` from the design-materials library, cut to
three tiers. It has to survive being both a pair of small windows and the whole
viewport — the act ends with it scaled a little past the frame — which is why a
1956px-wide source was chosen over better-composed but smaller candidates.

```sh
for w in 640 1280 1920; do
  ffmpeg -i HOME_8_JUN-1.jpg -vf "scale=$w:-2" \
    -c:v libwebp -lossless 0 -q:v 82 \
    apps/web/public/images/act-1-arrival/terrace-canopy-$w.webp
done
```

**The two bougainvillea branches.** Loops from the reference material, carrying a
real alpha channel.

```sh
for i in 01 07; do
  ffmpeg -c:v libvpx-vp9 -i bougainvillea-flowers_$i.webm \
    -c:v libvpx-vp9 -pix_fmt yuva420p -vf "scale=1080:1080,fps=20" \
    -crf 54 -b:v 0 -row-mt 1 -auto-alt-ref 0 -g 100 -an \
    apps/web/public/video/arrival-botanical/bougainvillea-$i.webm
  ffmpeg -c:v libvpx-vp9 -i bougainvillea-flowers_$i.webm \
    -frames:v 1 -vf "scale=1080:1080" \
    -c:v libwebp -pix_fmt yuva420p -lossless 0 -q:v 80 \
    apps/web/public/video/arrival-botanical/bougainvillea-$i.webp
done
```

1080 is the source's own resolution, and the cut is at it because the branches
are pushed: they are drawn at 74vmin on a layer in front of the picture, and the
push magnifies that layer about the viewport's centre on the same dolly that
grows the picture, with the branches on a nearer plane. They have cleared the
viewport by about twice their rest size, which on a wide desktop is around 1300
CSS px of branch at the last moment one is on screen. The first cut was 560, and
at that magnification it was pink mush. The whole resolution the source has is
still an upscale there, but the flowers stay flowers.

CRF 54 rather than the 52 the 560 cut used is the price of that: at 1080 the two
loops together are 4.40 MB (2.05 + 2.35), against a ceiling of about 4.5 MB for
a decorative layer on the first screen. CRF 52 at this size overshoots it. The
posters land at 188 KB and 214 KB, which is the resolution they need to be
worth holding — they are the whole branch on Safari, not a placeholder.

`-c:v libvpx-vp9` **before** `-i` is load-bearing and is the trap here. VP9
carries alpha as a side channel, and ffmpeg's native VP9 decoder silently
ignores it: the decode succeeds, reports `yuv420p`, and every re-encode from it
bakes the branch onto an opaque black square. Nothing fails and nothing warns —
`ffprobe` even still reports `alpha_mode=1` on the *source*. Only the picture on
screen says so. Selecting the libvpx decoder gives `yuva420p` and the cutout
survives. The same applies to the posters: `libwebp` defaults to `yuv420p` and
needs `-pix_fmt yuva420p` told to it explicitly.

Safari plays neither of these. It decodes VP9 alpha in neither form, and the
HEVC-with-alpha `.mov` the source material also ships cannot be re-cut here —
that encode needs VideoToolbox, which is macOS only. Safari therefore holds the
poster: the same branch with the same alpha, not moving in the wind.

## Reduced motion

No pin and no scrub. The frame parks joined and high, at 0.70 of the viewport,
which leaves a real ivory band under it for the statement to stand in rather
than putting ink type over the photograph. The branches hold their posters.
