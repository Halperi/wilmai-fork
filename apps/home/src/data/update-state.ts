export interface Release { version: string; notes: string | null; url: string | null; canInstall?: boolean }
export interface UpdateState {
  available: Release | null;
  current: string | null;
  checkedAt: number | null;
  error: string | null;
  phase: "idle" | "downloading" | "ready" | "installing";
  progress: number | null;
}
export const initialUpdate: UpdateState = { available: null, current: null, checkedAt: null, error: null, phase: "idle", progress: null };
export function failedCheck(previous: UpdateState): UpdateState {
  // A failed request says nothing about whether the installed version is current.
  return { ...previous, error: "check" };
}
