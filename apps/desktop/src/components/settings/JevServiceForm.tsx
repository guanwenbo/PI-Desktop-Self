/**
 * Adding Jev from the service list (D625).
 *
 * The service chooser answers "which service"; this is the whole second half
 * for Jev: which System One endpoint answers, and the key for it. The endpoint
 * is the TypeSafe default, the Zhizengzeng relay (same protocol, preset
 * address), or a custom address such as a self-hosted local gateway. One
 * button runs both steps — check the key against that endpoint, then store it
 * and turn Jev on — so a key that never answered is never kept, and adding Jev
 * is the same click as enabling it. Closing this dialog while the check is
 * still running cancels the whole action: nothing is stored and nothing is
 * enabled.
 */
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  DEFAULT_JEV_MODEL_ID,
  ZHIZENGZENG_JEV_BASE_URL,
  normalizeJevEndpoint,
  type JevEndpoint,
} from "@pi-desktop/shared";
import { useAppStore } from "../../stores/app-store";
import { Button, Field, Input, PasswordInput, SegmentedControl } from "../ui";
import { addJevService } from "./jev-config";
import { appJevConfigDeps, useJevKeyStatus } from "./jev-app-config";
import { endpointLabel } from "./service-catalog";

type EndpointMode = "typesafe" | "zhizengzeng" | "custom";

export type JevServiceFormProps = {
  onClose: () => void;
  /** The key was stored and Jev turned on; the caller closes this dialog. */
  onConfigured: () => void;
};

/** The stored endpoint decides which mode the dialog reopens on. */
function initialMode(endpoint: JevEndpoint | undefined): EndpointMode {
  if (!endpoint) return "typesafe";
  return endpoint.baseUrl === ZHIZENGZENG_JEV_BASE_URL ? "zhizengzeng" : "custom";
}

export function JevServiceForm({ onClose, onConfigured }: JevServiceFormProps) {
  const { t } = useTranslation();
  const showToast = useAppStore((state) => state.showToast);
  const storedEndpoint = useAppStore.getState().settings?.jevEndpoint;
  const [mode, setMode] = useState<EndpointMode>(() => initialMode(storedEndpoint));
  const [baseUrlDraft, setBaseUrlDraft] = useState(() =>
    initialMode(storedEndpoint) === "custom" ? (storedEndpoint?.baseUrl ?? "") : "",
  );
  const [modelDraft, setModelDraft] = useState(() =>
    initialMode(storedEndpoint) === "custom" ? (storedEndpoint?.modelId ?? "") : "",
  );
  const [keyDraft, setKeyDraft] = useState("");
  const [checking, setChecking] = useState(false);
  const [keyStatus] = useJevKeyStatus();
  const aborted = useRef<AbortController | null>(null);
  const configured = keyStatus === "configured";

  // Unmounting is a cancel: the check may still be in flight, and a dialog the
  // user closed must not come back later with a stored credential.
  useEffect(() => () => aborted.current?.abort(), []);

  const statusText = configured
    ? t("settings.jevKeyConfigured")
    : keyStatus === "unavailable"
      ? t("settings.jevKeyStatusUnavailable")
      : keyStatus === "loading"
        ? t("settings.jevKeyStatusChecking")
        : t("settings.jevKeyMissing");

  /** The endpoint this dialog would check and store; undefined = TypeSafe. */
  const resolvedEndpoint = (): JevEndpoint | undefined => {
    if (mode === "typesafe") return undefined;
    if (mode === "zhizengzeng") {
      return { baseUrl: ZHIZENGZENG_JEV_BASE_URL, modelId: DEFAULT_JEV_MODEL_ID };
    }
    return normalizeJevEndpoint({
      baseUrl: baseUrlDraft,
      ...(modelDraft.trim() ? { modelId: modelDraft.trim() } : {}),
    });
  };

  const endpointHost = (endpoint: JevEndpoint | undefined): string => {
    if (!endpoint) return "TypeSafe";
    try {
      return new URL(endpoint.baseUrl).hostname;
    } catch {
      return endpoint.baseUrl;
    }
  };

  const customIncomplete = mode === "custom" && !baseUrlDraft.trim();
  const saveDisabled = checking || !keyDraft.trim() || customIncomplete;

  const save = async () => {
    if (saveDisabled) return;
    const endpoint = resolvedEndpoint();
    if (mode === "custom" && !endpoint) {
      showToast(t("settings.jevEndpointInvalid"), { variant: "error" });
      return;
    }
    const controller = new AbortController();
    aborted.current = controller;
    setChecking(true);
    try {
      const outcome = await addJevService(
        appJevConfigDeps(),
        keyDraft,
        controller.signal,
        endpoint,
      );
      if (!outcome.ok) {
        // Closed while the check ran: the user cancelled, so say nothing at all.
        if (outcome.reason === "cancelled") return;
        showToast(
          outcome.reason === "missing-key"
            ? mode === "typesafe"
              ? t("settings.jevKeyRequired")
              : t("settings.jevKeyRequiredGeneric")
            : outcome.message || t("settings.jevKeyCheckFailed"),
          { variant: "error" },
        );
        return;
      }
      setKeyDraft("");
      showToast(
        mode === "typesafe"
          ? t("settings.jevServiceAdded")
          : t("settings.jevServiceAddedGeneric"),
        { variant: "success" },
      );
      onConfigured();
    } catch (error) {
      if (controller.signal.aborted) return;
      showToast(error instanceof Error ? error.message : String(error), {
        variant: "error",
      });
    } finally {
      if (!controller.signal.aborted) setChecking(false);
    }
  };

  const keyLabel =
    mode === "typesafe" ? t("settings.jevApiKey") : t("settings.jevApiKeyGeneric");
  const privacyNotice =
    mode === "typesafe"
      ? t("settings.jevPrivacyNotice")
      : t("settings.jevPrivacyNoticeCustom", {
          host: endpointHost(resolvedEndpoint()),
        });

  return (
    <>
      <div className="provider-setup-head">
        <h3 id="provider-setup-title" className="provider-setup-title">
          {t("settings.jevTitle")}
        </h3>
        <div className="provider-setup-head-actions">
          <Button variant="ghost" size="sm" disabled={checking} onClick={onClose}>
            {t("settings.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            disabled={saveDisabled}
            onClick={() => void save()}
          >
            {checking ? t("settings.jevCheckingKey") : t("settings.jevTestAndSave")}
          </Button>
        </div>
      </div>

      <div className="provider-setup-body">
        <div className="provider-setup-credentials">
          <div className="jev-setup">
            <p className="jev-setup-description">{t("settings.jevDescription")}</p>
            <SegmentedControl
              value={mode}
              onChange={setMode}
              label={t("settings.jevEndpointLabel")}
              disabled={checking}
              options={[
                { value: "typesafe", label: t("settings.jevEndpointTypesafe") },
                { value: "zhizengzeng", label: t("settings.jevEndpointZhizengzeng") },
                { value: "custom", label: t("settings.jevEndpointCustom") },
              ]}
            />
            {mode === "zhizengzeng" ? (
              <p className="jev-setup-note">{endpointLabel(ZHIZENGZENG_JEV_BASE_URL)}</p>
            ) : null}
            {mode === "custom" ? (
              <>
                <Field label={t("settings.jevBaseUrl")}>
                  <Input
                    value={baseUrlDraft}
                    placeholder={t("settings.jevBaseUrlPlaceholder")}
                    aria-label={t("settings.jevBaseUrl")}
                    disabled={checking}
                    onChange={(event) => setBaseUrlDraft(event.target.value)}
                  />
                </Field>
                <Field label={t("settings.jevModelId")}>
                  <Input
                    value={modelDraft}
                    placeholder={DEFAULT_JEV_MODEL_ID}
                    aria-label={t("settings.jevModelId")}
                    disabled={checking}
                    onChange={(event) => setModelDraft(event.target.value)}
                  />
                </Field>
              </>
            ) : null}
            <p className="jev-setup-privacy">{privacyNotice}</p>
            <Field label={keyLabel}>
              <PasswordInput
                value={keyDraft}
                autoFocus
                placeholder={
                  mode === "typesafe"
                    ? t("settings.jevApiKeyPlaceholder")
                    : t("settings.jevApiKeyGenericPlaceholder")
                }
                aria-label={keyLabel}
                autoComplete="new-password"
                showLabel={t("settings.configSync.showPassword")}
                hideLabel={t("settings.configSync.hidePassword")}
                disabled={checking}
                onChange={(event) => setKeyDraft(event.target.value)}
              />
            </Field>
            <p className="jev-setup-status" role="status">
              {statusText}
            </p>
            <p className="jev-setup-note">{t("settings.jevAddEnableNote")}</p>
          </div>
        </div>
      </div>
    </>
  );
}