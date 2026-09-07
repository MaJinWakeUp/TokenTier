"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { defaultScenarioId, scenarioFor, scenarios } from "@/lib/catalog";
import type { ScenarioId } from "@/lib/catalog/types";
import {
  defaultBudget,
  isAccessRequirement,
  isObjective,
  isPreference,
  normalizeWorkload,
  workloadFromScenario,
  type Objective,
  type Preference,
  type Workload,
} from "@/lib/domain/workload";
import {
  legacyKeys,
  migrateLegacyOnce,
  readRaw,
  readRecord,
  storageKeys,
  writeRecord,
} from "@/lib/browser/storage";
import { parseRecommendState, recommendParams, replaceQuery } from "@/lib/browser/url";

const workloadVersion = 1;

export type RecommendSettings = {
  workload: Workload;
  objective: Objective;
  preference: Preference;
  // A workload restored from a pre-refactor save has numbers but no work type,
  // and the work type is what sets the capability bar. Rather than assign one,
  // the reader is asked to pick while their numbers are kept.
  scenarioChosen: boolean;
};

const knownScenarioIds = scenarios.map((scenario) => scenario.id);

export function defaultSettings(): RecommendSettings {
  return {
    workload: workloadFromScenario(scenarioFor(defaultScenarioId), { budget: defaultBudget }),
    objective: "cost",
    preference: "either",
    scenarioChosen: true,
  };
}

type StoredShape = {
  scenarioId: string | null;
  input: number;
  output: number;
  calls: number;
  cacheRatio: number;
  budget: number;
  access: string;
  objective: string;
  preference: string;
};

function toStored(settings: RecommendSettings): StoredShape {
  return {
    scenarioId: settings.scenarioChosen ? settings.workload.scenarioId : null,
    input: settings.workload.input,
    output: settings.workload.output,
    calls: settings.workload.calls,
    cacheRatio: settings.workload.cacheRatio,
    budget: settings.workload.budget,
    access: settings.workload.access,
    objective: settings.objective,
    preference: settings.preference,
  };
}

function fromStored(payload: unknown, fallback: RecommendSettings): RecommendSettings | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Partial<StoredShape>;
  const scenarioChosen = typeof record.scenarioId === "string" && knownScenarioIds.includes(record.scenarioId);
  return {
    workload: normalizeWorkload(
      {
        scenarioId: scenarioChosen ? record.scenarioId : fallback.workload.scenarioId,
        input: record.input,
        output: record.output,
        calls: record.calls,
        cacheRatio: record.cacheRatio,
        budget: record.budget,
        access: isAccessRequirement(record.access) ? record.access : fallback.workload.access,
      },
      fallback.workload,
      knownScenarioIds,
    ),
    objective: isObjective(record.objective) ? record.objective : fallback.objective,
    preference: isPreference(record.preference) ? record.preference : fallback.preference,
    scenarioChosen,
  };
}

// The pre-refactor build saved the numbers under flat keys but never saved the
// work type, so the migrated record deliberately carries no scenario.
function migrateLegacyWorkload(): void {
  const legacy = {
    input: readRaw(legacyKeys.input),
    output: readRaw(legacyKeys.output),
    calls: readRaw(legacyKeys.calls),
    budget: readRaw(legacyKeys.budget),
    cacheRatio: readRaw(legacyKeys.cache),
    access: readRaw(legacyKeys.access),
    objective: readRaw(legacyKeys.priority),
    preference: readRaw(legacyKeys.preference),
  };
  if (Object.values(legacy).every((value) => value === null)) return;

  const base = defaultSettings();
  const workload = normalizeWorkload(
    {
      scenarioId: base.workload.scenarioId,
      input: legacy.input,
      output: legacy.output,
      calls: legacy.calls,
      cacheRatio: legacy.cacheRatio,
      budget: legacy.budget,
      access: isAccessRequirement(legacy.access) ? legacy.access : base.workload.access,
    },
    base.workload,
    knownScenarioIds,
  );
  writeRecord(storageKeys.workload, workloadVersion, {
    ...toStored({
      workload,
      objective: isObjective(legacy.objective) ? legacy.objective : base.objective,
      preference: isPreference(legacy.preference) ? legacy.preference : base.preference,
      scenarioChosen: false,
    }),
    scenarioId: null,
  });
}

export function readStoredSettings(): RecommendSettings {
  const fallback = defaultSettings();
  migrateLegacyOnce("workload", storageKeys.workload, migrateLegacyWorkload);
  const stored = readRecord(storageKeys.workload, workloadVersion, (payload) => fromStored(payload, fallback));
  return stored.state === "ok" ? stored.value : fallback;
}

export type RecommendController = RecommendSettings & {
  hydrated: boolean;
  storageWritable: boolean;
  setScenario: (id: ScenarioId) => void;
  setWorkloadField: (field: "input" | "output" | "calls" | "budget" | "cacheRatio", value: number) => void;
  setAccess: (value: Workload["access"]) => void;
  setObjective: (value: Objective) => void;
  setPreference: (value: Preference) => void;
  shareParams: URLSearchParams;
};

export function useRecommendSettings(): RecommendController {
  const [settings, setSettings] = useState<RecommendSettings>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);
  const [storageWritable, setStorageWritable] = useState(true);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time hydration; the URL wins over storage, and both are parsed before anything is written */
    const stored = readStoredSettings();
    const params = new URLSearchParams(window.location.search);
    const fromUrl = parseRecommendState(params, stored, scenarios);
    const urlNamesScenario = scenarios.some((scenario) => scenario.id === params.get("scenario"));
    setSettings({
      ...fromUrl,
      scenarioChosen: urlNamesScenario || stored.scenarioChosen,
    });
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const shareParams = useMemo(() => recommendParams(settings), [settings]);

  // Editing replaces the current history entry rather than adding one, so Back
  // leaves Recommend instead of stepping through every keystroke.
  useEffect(() => {
    if (!hydrated || !settings.scenarioChosen) return;
    replaceQuery(recommendParams(settings));
  }, [hydrated, settings]);

  useEffect(() => {
    if (!hydrated) return;
    // Same as the board editor: the write is the point of the effect, and its
    // success is feedback from an external system the reader has to be told
    // about, not state derived from a render.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- storage feedback, not derived state
    setStorageWritable(writeRecord(storageKeys.workload, workloadVersion, toStored(settings)));
  }, [hydrated, settings]);

  // Naming a work type adopts that preset's whole typical month: the numbers
  // under the selector can never contradict the selector above them.
  //
  // The one exception is the first choice after a migrated legacy save. Those
  // numbers are the reader's own work, carried over from a build that never
  // saved the work type; picking the gate they belong to must not throw them
  // away.
  const setScenario = useCallback((id: ScenarioId) => {
    setSettings((current) => {
      if (!current.scenarioChosen) {
        return {
          ...current,
          scenarioChosen: true,
          workload: { ...current.workload, scenarioId: id },
        };
      }
      return {
        ...current,
        workload: workloadFromScenario(scenarioFor(id), {
          budget: current.workload.budget,
          access: current.workload.access,
        }),
      };
    });
  }, []);

  const setWorkloadField = useCallback(
    (field: "input" | "output" | "calls" | "budget" | "cacheRatio", value: number) => {
      setSettings((current) => ({
        ...current,
        workload: normalizeWorkload({ ...current.workload, [field]: value }, current.workload, knownScenarioIds),
      }));
    },
    [],
  );

  const setAccess = useCallback((value: Workload["access"]) => {
    setSettings((current) => ({ ...current, workload: { ...current.workload, access: value } }));
  }, []);

  const setObjective = useCallback((value: Objective) => {
    setSettings((current) => ({ ...current, objective: value }));
  }, []);

  const setPreference = useCallback((value: Preference) => {
    setSettings((current) => ({ ...current, preference: value }));
  }, []);

  return {
    ...settings,
    hydrated,
    storageWritable,
    setScenario,
    setWorkloadField,
    setAccess,
    setObjective,
    setPreference,
    shareParams,
  };
}
