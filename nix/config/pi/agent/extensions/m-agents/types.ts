import type { Message } from "@mariozechner/pi-ai";

export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type Mode = "allow" | "ask" | "deny";

export interface PermissionSettings {
  defaultMode?: Mode;
  allow?: string[];
  deny?: string[];
  ask?: string[];
}

export type PresetType = "primary" | "subagent" | "all";

export interface Preset {
  provider?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  tools?: string[];
  instructions?: string;
  description?: string;
  type?: PresetType;
  permission?: PermissionSettings;
}

export interface PresetsConfig {
  [name: string]: Preset;
}

export interface PermissionSnapshot {
  presetName?: string;
  permission: PermissionSettings;
  sessionOverrides: Record<string, Mode>;
}

export interface UsageStats {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  contextTokens: number;
  turns: number;
}

export interface SingleResult {
  preset: string;
  task: string;
  exitCode: number;
  messages: Message[];
  stderr: string;
  usage: UsageStats;
  model?: string;
  stopReason?: string;
  errorMessage?: string;
  step?: number;
  sessionFile?: string;
}

export interface SubagentDetails {
  mode: "single" | "parallel" | "chain";
  results: SingleResult[];
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

export interface IpcPermissionRequest {
  id: string;
  subagentId: string;
  type: "permission";
  toolName: string;
  toolCallId: string;
  prompt: string;
  message: string;
  toolInput: Record<string, unknown>;
}

export interface IpcQuestionnaireRequest {
  id: string;
  subagentId: string;
  type: "questionnaire";
  toolCallId: string;
  questions: QuestionnaireQuestion[];
}

export type IpcRequest = IpcPermissionRequest | IpcQuestionnaireRequest;

export interface IpcPermissionResponse {
  id: string;
  type: "permission_response";
  approved: boolean;
}

export interface IpcQuestionnaireResponse {
  id: string;
  type: "questionnaire_response";
  answers: Record<string, string>;
  cancelled?: boolean;
}

export type IpcResponse = IpcPermissionResponse | IpcQuestionnaireResponse;

// Prevent accidental auto-registration if this helper module is discovered directly.
export default function (): void {}
