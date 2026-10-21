import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { isDesktopApp } from "../wilma/transport";
import { version } from "../../package.json";

export const APP_VERSION = version;

export interface Edition { localAi: boolean; signedUpdater: boolean }
let edition: Promise<Edition> | undefined;
export function appEdition(): Promise<Edition> {
  return edition ??= isDesktopApp ? invoke<Edition>("app_edition") : Promise.resolve({ localAi: true, signedUpdater: false });
}

export function useLocalEdition(): boolean | null {
  const [local, setLocal] = useState<boolean | null>(isDesktopApp ? null : true);
  useEffect(() => { let live = true; void appEdition().then((e) => { if (live) setLocal(e.localAi); }).catch(() => { if (live) setLocal(false); }); return () => { live = false; }; }, []);
  return local;
}
