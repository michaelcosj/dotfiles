export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type Mode = "allow" | "ask" | "deny";

export interface PermissionSettings {
  defaultMode?: Mode;
  allow?: string[];
  deny?: string[];
  ask?: string[];
}

export interface Preset {
  provider?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
  instructions?: string;
  description?: string;
  permission?: PermissionSettings;
}

export interface PresetsConfig {
  [name: string]: Preset;
}

export interface LoadedPresets {
  presets: PresetsConfig;
  defaultPreset: string | undefined;
  defaultMode: Mode;
  globalPermission: PermissionSettings | undefined;
}

export interface QuestionnaireOption {
  value: string;
  label: string;
  description?: string;
}

export interface QuestionnaireQuestion {
  id: string;
  label?: string;
  prompt: string;
  options: QuestionnaireOption[];
  allowOther?: boolean;
}

export interface QuestionnaireAnswer {
  id: string;
  value: string;
  label: string;
  wasCustom: boolean;
  index?: number;
}

export interface QuestionnaireUiResult {
  questions: Array<
    QuestionnaireQuestion & {
      label: string;
      allowOther: boolean;
    }
  >;
  answers: QuestionnaireAnswer[];
  cancelled: boolean;
}
