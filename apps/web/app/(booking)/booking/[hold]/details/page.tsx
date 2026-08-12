import type { Metadata } from "next";
import { DetailsScreen } from "@/features/booking/components/details-screen/details-screen";

export const metadata: Metadata = {
  title: "Your stay — Mariva",
  description:
    "Check the nights, the room and the total before you pay. Nothing is charged on this page.",
};

// The hold in the path, from the third step on — `repository-structure.md`
// §`(booking)`. In the url rather than a cookie so that two tabs stay
// unambiguous and an expired hold is a named resource the screen can ask about,
// rather than a form that is mysteriously empty.
//
// `params` is awaited because Next hands it over as a promise: the segment is
// known before the render, but the API is asynchronous so that a route can be
// resolved without blocking the shell.
export default async function HoldDetailsPage({
  params,
}: {
  readonly params: Promise<{ readonly hold: string }>;
}) {
  const { hold } = await params;

  return <DetailsScreen hold={hold} />;
}
