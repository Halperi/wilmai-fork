/*
 * OpenAI can't be reached from this network (school and work networks can block it): what that means, and a way to
 * check again. Settings shows it instead of the key field, and Today while AI is paused (luna/client.ts).
 */
import { useState } from "react";
import { intelligenceOn, intelligenceProvider } from "../data/model";
import { useApp } from "../data/store";
import { t } from "../i18n";
import { checkOpenAIAgain } from "../luna/events";

export function OpenAIBlocked({ where }: { where: "settings" | "today" }) {
  const blocked = useApp((s) => s.openaiBlocked);
  const settings = useApp((s) => s.settings);
  const [checking, setChecking] = useState(false);
  if (!blocked || (where === "today" && (!intelligenceOn(settings) || intelligenceProvider(settings) !== "openai"))) return null;
  const again = async () => {
    setChecking(true);
    try { await checkOpenAIAgain(); }
    finally { setChecking(false); }
  };
  const detail = !blocked.detail
    ? null
    : blocked.reason === "intercepted"
      ? t("Another server answered in OpenAI's place ({detail}), usually the network's filter.", { detail: blocked.detail })
      : t("Connection error: {detail}", { detail: blocked.detail });
  return (
    <div className="notice err ai-blocked" role="alert">
      <div>
        <b>{where === "today" ? t("AI paused: this network can't reach OpenAI") : t("This computer can't reach OpenAI")}</b>
        <p>
          {where === "today"
            ? t("School and work networks sometimes block OpenAI. Everything from Wilma still shows, and the AI tries again in a few minutes.")
            : t("School and work networks sometimes block OpenAI (api.openai.com), and then AI with OpenAI can't work on this computer. Choose No AI, or use OpenAI on another network.")}
        </p>
        {detail ? <small>{detail}</small> : null}
      </div>
      <button type="button" className="btn btn-sm" onClick={() => void again()} disabled={checking}>
        {checking ? t("Checking…") : t("Check again")}
      </button>
    </div>
  );
}
