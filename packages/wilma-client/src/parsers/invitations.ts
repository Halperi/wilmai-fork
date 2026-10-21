/*
 * Event invitations (Tapahtumakutsut): parents' evenings, learning
 * discussions with time slots, a choice between events.
 *
 * Seen 2026-10-06 (Helsinki, Wilma 2.36):
 * - list: `/messages/list/appointments`, the inbox JSON plus IsEvent and
 *   Applying {Status: "Applied" | "ExpiredReg" | …, ExtraInfo};
 * - detail: `/messages/<id>?format=json` with EventData, a JSON string
 *   {MustApply, Events: [{EventID, Start, End, EnrollStart, EnrollEnd,
 *   CancelDate, Info, MaxPeople, PeopleCount, State, CanDismissEvent,
 *   IsDismissed}]} (a string, or already an object on some messages).
 *
 * State (2026-10-08, the class of the button Wilma's page shows for it):
 * "available"; "selected-cancellable" for your slot while it can be
 * cancelled, "selected" once it can't ("Perumisaika on umpeutunut");
 * "selected-other" with SelectedOther naming the guardian who signed up;
 * "full"; "pending" before sign-up opens; "expired" after it closes.
 * CanDismissEvent: the page offers "En osallistu" (won't attend), which
 * covers every such slot; IsDismissed: the family said so.
 */
import { finnishTime } from "../finnish-time.js";
import type { Invitation, InvitationListing, InvitationSlot, InvitationSlotState, Message } from "../types.js";

/** "2026-10-14 17:30" (Finnish time) as an instant; null when there's no date. */
function wilmaTime(value: unknown): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(String(value ?? ""));
  if (!m) return null;
  return finnishTime(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0));
}

/** A message's EventData (a JSON string or already parsed); null when it isn't an invitation. */
export function parseInvitation(raw: unknown): Invitation | null {
  let data: unknown = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  const d = data as { MustApply?: unknown; Events?: unknown } | null;
  if (!d || typeof d !== "object" || !Array.isArray(d.Events)) return null;
  const slots: InvitationSlot[] = (d.Events as Record<string, unknown>[]).flatMap((e) => {
    if (!e || typeof e !== "object" || e.EventID === undefined || e.EventID === null) return [];
    return [
      {
        id: String(e.EventID),
        start: wilmaTime(e.Start),
        end: wilmaTime(e.End),
        enrollStart: wilmaTime(e.EnrollStart),
        enrollEnd: wilmaTime(e.EnrollEnd),
        cancelUntil: wilmaTime(e.CancelDate),
        info: String(e.Info ?? "").trim(),
        subject: String(e.Subject ?? "").trim(),
        maxPeople: Number(e.MaxPeople) || 0,
        peopleCount: Number(e.PeopleCount) || 0,
        selected: e.State === "selected" || e.State === "selected-cancellable",
        selectedByOther: e.State === "selected-other" ? String(e.SelectedOther ?? "").trim() || "another guardian" : null,
        wilmaState: typeof e.State === "string" ? e.State : "",
        canDecline: e.CanDismissEvent === true,
        declined: e.IsDismissed === true,
      },
    ];
  });
  const declinable = slots.filter((slot) => slot.canDecline);
  return {
    mustApply: Boolean(d.MustApply),
    slots,
    // As Wilma's page: the button shows while a slot can be declined and none is chosen for good.
    canDecline: declinable.length > 0 && !slots.some((slot) => slot.wilmaState === "selected"),
    declined: declinable.length > 0 && declinable.every((slot) => slot.declined),
  };
}

/**
 * What can be done with a slot right now (the states Wilma's own page shows).
 * Pass the invitation to tell a free slot from one the family can't take
 * because it already has another.
 */
export function slotState(slot: InvitationSlot, now = new Date(), invitation?: Invitation): InvitationSlotState {
  if (slot.selected) return slot.wilmaState === "selected" || (slot.cancelUntil && now > slot.cancelUntil) ? "chosen-locked" : "chosen";
  if (slot.selectedByOther) return "chosen-by-other";
  if (slot.wilmaState === "expired") return "closed";
  if (slot.wilmaState === "full") return "full";
  if (slot.wilmaState === "pending") return "not-yet";
  if (slot.enrollStart && now < slot.enrollStart) return "not-yet";
  if (slot.enrollEnd && now > slot.enrollEnd) return "closed";
  if (slot.maxPeople > 0 && slot.peopleCount >= slot.maxPeople) return "full";
  if (invitation && answered(invitation)) return "taken";
  return "open";
}

/** You or another guardian signed up for one of the slots. */
function answered(invitation: Invitation): boolean {
  return invitation.slots.some((slot) => slot.selected || slot.selectedByOther);
}

/** The invitation still waits for an answer: nobody in the family signed up or said they won't attend, and a slot is open. */
export function awaitingAnswer(invitation: Invitation, now = new Date()): boolean {
  if (answered(invitation) || invitation.declined) return false;
  return invitation.slots.some((slot) => slotState(slot, now) === "open");
}

/** The invitations list: each message with where this family stands. */
export function parseInvitationListings(data: unknown, messages: Message[]): InvitationListing[] {
  const list = (data as { Messages?: unknown; messages?: unknown } | null) ?? {};
  const raw = (Array.isArray(list.Messages) ? list.Messages : Array.isArray(list.messages) ? list.messages : []) as Record<string, unknown>[];
  const byId = new Map(raw.filter((m) => m && typeof m === "object").map((m) => [Number(m["Id"] ?? m["id"]), m]));
  return messages.map((message) => {
    const applying = byId.get(message.wilmaId)?.["Applying"] as { Status?: unknown; ExtraInfo?: unknown } | null | undefined;
    const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim() : null);
    return { message, status: text(applying?.Status), extra: text(applying?.ExtraInfo) };
  });
}
