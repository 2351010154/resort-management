"use client";

import type { StaffRole } from "@mariva/shared";
import { CANCELLATION_REASONS, ROOM_TYPE_CODES } from "@mariva/shared";
import type React from "react";
import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { type BookingAction, visibleBookingActions } from "./booking-actions";
import type { Stay } from "./booking-search";
import { useBookingActions } from "./bookings-queries";
import { enterSubmissionGate, leaveSubmissionGate } from "./submission-gate";

const LABELS: Record<BookingAction, string> = {
  confirm: "Confirm offline hold",
  cancel: "Cancel",
  cancelWithWaiver: "Cancel and waive penalty",
  markNoShow: "Mark no-show",
  reinstate: "Reinstate late arrival",
  moveRoom: "Move room",
  changeRoomType: "Change room type",
  extendStay: "Extend stay",
  shortenStay: "Shorten stay",
  resendAccountLink: "Resend account link",
};

export function StayActionSheet({
  stay,
  role,
  open,
  onOpenChange,
}: {
  stay: Stay;
  role: StaffRole;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const actions = useBookingActions();
  const offered = visibleBookingActions(role, stay.state);
  const [action, setAction] = useState<BookingAction | null>(null);
  const [reason, setReason] = useState("");
  const [roomNumber, setRoomNumber] = useState("");
  const [roomType, setRoomType] = useState<string>(stay.roomType);
  const [checkOut, setCheckOut] = useState(stay.checkOut);
  const [guestName, setGuestName] = useState(stay.guestNames[0] ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [invalidField, setInvalidField] = useState<
    "reason" | "guest" | "room" | null
  >(null);
  const problemRef = useRef<HTMLParagraphElement>(null);
  const formTitleRef = useRef<HTMLHeadingElement>(null);
  const reasonRef = useRef<HTMLSelectElement>(null);
  const guestRef = useRef<HTMLInputElement>(null);
  const roomRef = useRef<HTMLInputElement>(null);
  const actionRefs = useRef<Partial<Record<BookingAction, HTMLButtonElement>>>(
    {},
  );
  const submissionGate = useRef(false);
  const fieldId = useId();
  const problemId = `${fieldId}-problem`;
  const busy = Object.values(actions).some((mutation) => mutation.isPending);

  useEffect(() => {
    if (action !== null) formTitleRef.current?.focus();
  }, [action]);

  function refuse(message: string, field: "reason" | "guest" | "room" | null) {
    setProblem(message);
    setInvalidField(field);
    toast.error(message);
    requestAnimationFrame(() => {
      const target =
        field === "reason"
          ? reasonRef.current
          : field === "guest"
            ? guestRef.current
            : field === "room"
              ? roomRef.current
              : problemRef.current;
      target?.focus();
    });
  }

  async function submit() {
    if (action === null) return;
    if (!enterSubmissionGate(submissionGate)) return;
    const bookingId = stay.id;
    try {
      switch (action) {
        case "confirm":
          await actions.confirm.mutateAsync({ bookingId });
          break;
        case "cancel":
        case "cancelWithWaiver": {
          if (reason === "")
            return refuse("Choose the reason for the cancellation.", "reason");
          const input = {
            bookingId,
            reason: reason as
              | "GUEST_REQUEST"
              | "STAFF_ERROR"
              | "PAYMENT_FAILED"
              | "OVERBOOK_WALK"
              | "FORCE_MAJEURE",
          };
          await (action === "cancel"
            ? actions.cancel
            : actions.cancelWithWaiver
          ).mutateAsync(input);
          break;
        }
        case "markNoShow":
          await actions.markNoShow.mutateAsync({ bookingId });
          break;
        case "reinstate":
          if (guestName.trim() === "")
            return refuse(
              "A reinstatement needs at least one registered guest.",
              "guest",
            );
          await actions.reinstate.mutateAsync({
            bookingId,
            guests: [{ fullName: guestName.trim() }],
            ...(roomNumber.trim() === ""
              ? {}
              : { roomNumber: roomNumber.trim() }),
          });
          break;
        case "moveRoom":
          if (roomNumber.trim() === "")
            return refuse("Choose the room the guest is moving to.", "room");
          await actions.moveRoom.mutateAsync({
            bookingId,
            roomNumber: roomNumber.trim(),
          });
          break;
        case "changeRoomType":
          await actions.changeRoomType.mutateAsync({
            bookingId,
            roomType: roomType as (typeof ROOM_TYPE_CODES)[number],
            ...(roomNumber.trim() === ""
              ? {}
              : { roomNumber: roomNumber.trim() }),
          });
          break;
        case "extendStay":
          await actions.extendStay.mutateAsync({ bookingId, checkOut });
          break;
        case "shortenStay":
          await actions.shortenStay.mutateAsync({ bookingId, checkOut });
          break;
        case "resendAccountLink": {
          const result = await actions.resendAccountLink.mutateAsync({
            bookingId,
          });
          toast.success(`Account link sent to ${result.to}.`);
          break;
        }
      }
      setProblem(null);
      setInvalidField(null);
      onOpenChange(false);
    } catch {
      /* Central query handling displays the actionable API refusal. */
    } finally {
      leaveSubmissionGate(submissionGate);
    }
  }

  const needsReason = action === "cancel" || action === "cancelWithWaiver";
  const needsRoom =
    action === "moveRoom" ||
    action === "changeRoomType" ||
    action === "reinstate";
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setAction(null);
        onOpenChange(next);
      }}
    >
      <SheetContent className="motion-reduce:transition-none">
        <SheetHeader>
          <SheetTitle>Stay {stay.reference}</SheetTitle>
          <SheetDescription>
            {stay.state.replaceAll("_", " ")} · {stay.checkIn} to{" "}
            {stay.checkOut} · Room {stay.roomNumber ?? "unassigned"}
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          {action === null ? (
            <div className="grid gap-2">
              {offered.map((item) => (
                <Button
                  key={item}
                  type="button"
                  variant="outline"
                  className="justify-start"
                  ref={(node) => {
                    actionRefs.current[item] = node ?? undefined;
                  }}
                  onClick={() => {
                    setProblem(null);
                    setInvalidField(null);
                    setAction(item);
                  }}
                >
                  {LABELS[item]}
                </Button>
              ))}
              {offered.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  There are no staff actions available for this stay.
                </p>
              ) : null}
            </div>
          ) : (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
              className="space-y-4"
            >
              <h3 ref={formTitleRef} tabIndex={-1} className="font-semibold">
                {LABELS[action]}
              </h3>
              {needsReason ? (
                <FieldLabel id={fieldId} label="Cancellation reason">
                  <select
                    id={fieldId}
                    ref={reasonRef}
                    aria-invalid={invalidField === "reason"}
                    aria-describedby={
                      invalidField === "reason" ? problemId : undefined
                    }
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  >
                    <option value="">Choose a reason</option>
                    {CANCELLATION_REASONS.filter(
                      (x) => x !== "HOLD_EXPIRED" && x !== "HOLD_REPLACED",
                    ).map((x) => (
                      <option key={x} value={x}>
                        {x.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </FieldLabel>
              ) : null}
              {action === "reinstate" ? (
                <Field
                  label="Guest full name"
                  value={guestName}
                  onChange={setGuestName}
                  inputRef={guestRef}
                  ariaInvalid={invalidField === "guest"}
                  describedBy={invalidField === "guest" ? problemId : undefined}
                  required
                />
              ) : null}
              {needsRoom ? (
                <Field
                  label={
                    action === "moveRoom"
                      ? "New room number"
                      : "Room number (optional)"
                  }
                  value={roomNumber}
                  onChange={setRoomNumber}
                  inputRef={roomRef}
                  ariaInvalid={invalidField === "room"}
                  describedBy={invalidField === "room" ? problemId : undefined}
                  required={action === "moveRoom"}
                />
              ) : null}
              {action === "changeRoomType" ? (
                <FieldLabel id={`${fieldId}-type`} label="New room type">
                  <select
                    id={`${fieldId}-type`}
                    className="mt-1 h-10 w-full rounded-md border border-input bg-background px-3"
                    value={roomType}
                    onChange={(e) => setRoomType(e.target.value)}
                  >
                    {ROOM_TYPE_CODES.map((x) => (
                      <option key={x}>{x}</option>
                    ))}
                  </select>
                </FieldLabel>
              ) : null}
              {action === "extendStay" || action === "shortenStay" ? (
                <Field
                  label="New checkout date (YYYY-MM-DD)"
                  type="date"
                  value={checkOut}
                  onChange={setCheckOut}
                  required
                />
              ) : null}
              {action === "resendAccountLink" ? (
                <p className="text-sm">
                  This sends a new link to the email address already stored on
                  the booking. The destination cannot be changed here.
                </p>
              ) : null}
              {problem === null ? null : (
                <p
                  id={problemId}
                  ref={problemRef}
                  tabIndex={-1}
                  role="alert"
                  className="border-danger border-l-2 pl-3 text-sm text-danger"
                >
                  {problem}
                </p>
              )}
              <div className="flex gap-2">
                <Button type="submit" aria-busy={busy} disabled={busy}>
                  {LABELS[action]}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    const previous = action;
                    setProblem(null);
                    setInvalidField(null);
                    setAction(null);
                    requestAnimationFrame(() =>
                      actionRefs.current[previous]?.focus(),
                    );
                  }}
                >
                  Back
                </Button>
              </div>
            </form>
          )}
        </SheetBody>
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  type = "text",
  inputRef,
  ariaInvalid,
  describedBy,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
  required?: boolean;
  type?: string;
  inputRef?: React.Ref<HTMLInputElement>;
  ariaInvalid?: boolean;
  describedBy?: string;
}) {
  const id = useId();
  return (
    <FieldLabel id={id} label={label}>
      <Input
        id={id}
        ref={inputRef}
        type={type}
        aria-invalid={ariaInvalid}
        aria-describedby={describedBy}
        value={value}
        required={required}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
      />
    </FieldLabel>
  );
}
function FieldLabel({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-sm font-semibold text-muted-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
