# Sunlit arrival redesign

The supplied intro.mp4 is a visual reference, not application footage. Its split photographic windows, ivory ground and overlapping bougainvillea informed this adaptation.

## Page behavior

- The existing sea-terrace photograph spans an abstract M cutout. Scroll opens its negative spaces into one architectural frame. The foreground branches retreat and the caption appears once the view settles.
- The expanded photograph scrolls naturally into the ivory welcome, with no white flash or second camera push.
- Welcome chapters use ordinary document flow: arched bedroom portrait, wide dining view, practical house facts and garden photograph.
- The approach film remains a steady view with a dusk grade and a pause button.
- Rooms and eight experiences use readable photographic layouts instead of the horizontal corridor and shattered lettering. Menu destinations target the corresponding experience in document flow.
- The booking invitation is one screen; its link is visible immediately. The existing embossed footer M closes the sequence.
- The hero uses CSS clip-path and GSAP, without a WebGL requirement. Reduced motion leaves a static M, removes the extended hero scroll, and uses a still approach view.

## Asset provenance

Existing hero photograph: apps/web/public/images/auth/sea-terrace-1920.webp.
New decorative asset: apps/web/public/images/arrival-botanical/bougainvillea.webp (1536 x 1024), generated using the built-in image generation tool and encoded with FFmpeg.

Final asset uses a white background composited with CSS multiply against the ivory stage, rather than alpha transparency. The stage needs its own ivory background inside its isolated stacking context for this to blend correctly.

Initial generation prompt: Photorealistic bougainvillea branch, stems from the lower left, airy green leaves and magenta flowers, coastal morning sunlight, landscape 3:2, no architecture or text, isolated botanical foreground asset.

Final correction prompt: Keep exactly these photographic flowers, leaves and branches. Replace the entire gray and white checkerboard pattern with a perfectly flat pure white RGB(255,255,255) background. Every square and ALL gray checkerboard must disappear. No transparency, no checker pattern, no shadows, no gradients. Clean botanical cutout on pure solid white background for print. Retain only sharp leaves stems and magenta flowers, same layout.

## Verification

Production build and funnel bundle budget passed. Web TypeScript, CSS lint and scoped TSX lint passed. Browser review covered desktop and 375px mobile, the opening and handoff, rooms navigation, mobile Restore destination, image loading and horizontal overflow. Reduced-motion behavior was reviewed in code; it was not emulated in the browser.
