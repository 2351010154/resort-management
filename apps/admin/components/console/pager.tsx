import { Button } from "@/components/ui/button";

/**
 * One step through a paged collection — the press that asks for the offset
 * before or after the one on screen.
 *
 * It lives here rather than in a feature because three screens page a
 * collection the API counts for them, and the desk works more than one of them
 * in a shift: the cash book, the folio list and the shift history are the same
 * control with a different offset behind it, and three copies of it are three
 * things to drift apart.
 *
 * **A press with nowhere to go is `aria-disabled` and not `disabled`.** A
 * control that goes disabled under the operator's finger hands focus to
 * `<body>`, and the last page of a list is exactly where that happens — the
 * press that took them there is the press that has just been taken away from
 * the keyboard. So the edge is refused here instead, and the button keeps its
 * place in the tab order and its focus with it.
 */
export interface PagerProps {
  /** The words on the press. */
  label: string;
  /** Whether there is a page on this side of the one on screen. */
  offered: boolean;
  /** Ask for it. Not called when nothing is offered. */
  onPage(): void;
}

function Pager({ label, offered, onPage }: PagerProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      aria-disabled={!offered}
      className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
      onClick={() => {
        if (!offered) {
          return;
        }

        onPage();
      }}
    >
      {label}
    </Button>
  );
}

export { Pager };
