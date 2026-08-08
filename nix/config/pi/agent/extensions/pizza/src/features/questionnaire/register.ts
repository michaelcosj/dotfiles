import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  Text,
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { QuestionnaireAnswer, QuestionnaireQuestion, QuestionnaireUiResult } from "./types.js";

interface NormalizedQuestion extends QuestionnaireQuestion {
  label: string;
  allowOther: boolean;
}

type RenderOption = {
  value: string;
  label: string;
  description?: string;
  isOther?: boolean;
};

export const QuestionOptionSchema = Type.Object({
  value: Type.String({ description: "The value returned when selected" }),
  label: Type.String({ description: "Display label for the option" }),
  description: Type.Optional(
    Type.String({ description: "Optional description shown below label" }),
  ),
});

export const QuestionSchema = Type.Object({
  id: Type.String({ description: "Unique identifier for this question" }),
  label: Type.Optional(
    Type.String({
      description:
        "Short contextual label for tab bar, e.g. 'Scope', 'Priority' (defaults to Q1, Q2)",
    }),
  ),
  prompt: Type.String({ description: "The full question text to display" }),
  options: Type.Array(QuestionOptionSchema, {
    description: "Available options to choose from",
  }),
  allowOther: Type.Optional(
    Type.Boolean({
      description: "Allow 'Type something' option (default: true)",
    }),
  ),
});

export const QuestionnaireParams = Type.Object({
  questions: Type.Array(QuestionSchema, {
    description: "Questions to ask the user",
  }),
});

function normalizeQuestions(questions: QuestionnaireQuestion[]): {
  questions?: NormalizedQuestion[];
  error?: string;
} {
  if (!Array.isArray(questions) || questions.length === 0) {
    return { error: "Error: No questions provided" };
  }

  const normalized: NormalizedQuestion[] = [];
  const ids = new Set<string>();
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const id = q.id?.trim();
    const options = Array.isArray(q.options) ? q.options : [];
    const allowOther = q.allowOther !== false;

    if (!id) return { error: `Error: Question at index ${i} missing id` };
    if (ids.has(id)) return { error: `Error: Duplicate question id "${id}"` };
    ids.add(id);
    if (!q.prompt?.trim()) return { error: `Error: Question "${id}" missing prompt` };
    if (options.length === 0 && !allowOther) {
      return {
        error: `Error: Question "${q.id}" has no options and allowOther is false`,
      };
    }

    normalized.push({
      ...q,
      id,
      label: q.label || `Q${i + 1}`,
      options,
      allowOther,
    });
  }

  return { questions: normalized };
}

export async function askQuestionnaire(
  ctx: ExtensionContext,
  inputQuestions: QuestionnaireQuestion[],
  signal?: AbortSignal,
): Promise<
  | { ok: true; result: QuestionnaireUiResult; values: Record<string, string> }
  | { ok: false; error: string }
> {
  if (ctx.mode !== "tui") {
    return { ok: false, error: "Error: questionnaire requires interactive TUI mode" };
  }

  const normalized = normalizeQuestions(inputQuestions);
  if (!normalized.questions) return { ok: false, error: normalized.error ?? "Invalid questions" };

  const questions = normalized.questions;
  const isMulti = questions.length > 1;
  const totalTabs = questions.length + 1; // questions + submit
  const cancelledResult = (): QuestionnaireUiResult => ({ questions, answers: [], cancelled: true });
  if (signal?.aborted) {
    const result = cancelledResult();
    return { ok: true, result, values: {} };
  }

  const result = await ctx.ui.custom<QuestionnaireUiResult>((tui, theme, _kb, done) => {
    let currentTab = 0;
    let optionIndex = 0;
    let inputMode = false;
    let inputQuestionId: string | null = null;
    let cachedLines: string[] | undefined;
    let cachedWidth: number | undefined;
    let finished = false;
    const answers = new Map<string, QuestionnaireAnswer>();

    const editorTheme: EditorTheme = {
      borderColor: (s) => theme.fg("accent", s),
      selectList: {
        selectedPrefix: (t) => theme.fg("accent", t),
        selectedText: (t) => theme.fg("accent", t),
        description: (t) => theme.fg("muted", t),
        scrollInfo: (t) => theme.fg("dim", t),
        noMatch: (t) => theme.fg("warning", t),
      },
    };
    const editor = new Editor(tui, editorTheme);

    const refresh = () => {
      cachedLines = undefined;
      cachedWidth = undefined;
      tui.requestRender();
    };

    const finish = (result: QuestionnaireUiResult) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", abort);
      done(result);
    };
    const abort = () => finish(cancelledResult());
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();

    const submit = (cancelled: boolean) => {
      finish({
        questions,
        answers: Array.from(answers.values()),
        cancelled,
      });
    };

    const currentQuestion = (): NormalizedQuestion | undefined => questions[currentTab];

    const currentOptions = (): RenderOption[] => {
      const q = currentQuestion();
      if (!q) return [];
      const opts: RenderOption[] = [...q.options];
      if (q.allowOther) {
        opts.push({
          value: "__other__",
          label: "Type something...",
          isOther: true,
        });
      }
      return opts;
    };

    const allAnswered = (): boolean => questions.every((q) => answers.has(q.id));

    const syncOptionIndex = () => {
      const q = currentQuestion();
      if (!q) {
        optionIndex = 0;
        return;
      }
      const answer = answers.get(q.id);
      optionIndex = answer?.wasCustom ? q.options.length : Math.max(0, (answer?.index ?? 1) - 1);
    };

    const saveAnswer = (
      questionId: string,
      value: string,
      label: string,
      wasCustom: boolean,
      index?: number,
    ) => {
      answers.set(questionId, {
        id: questionId,
        value,
        label,
        wasCustom,
        index,
      });
    };

    const advanceAfterAnswer = () => {
      if (!isMulti) {
        submit(false);
        return;
      }
      if (currentTab < questions.length - 1) currentTab++;
      else currentTab = questions.length;
      syncOptionIndex();
      refresh();
    };

    editor.onSubmit = (value) => {
      if (!inputQuestionId) return;
      const trimmed = value.trim() || "(no response)";
      saveAnswer(inputQuestionId, trimmed, trimmed, true);
      inputMode = false;
      inputQuestionId = null;
      editor.setText("");
      advanceAfterAnswer();
    };

    function handleInput(data: string) {
      if (inputMode) {
        if (matchesKey(data, Key.escape)) {
          inputMode = false;
          inputQuestionId = null;
          editor.setText("");
          refresh();
          return;
        }
        editor.handleInput(data);
        refresh();
        return;
      }

      const q = currentQuestion();
      const opts = currentOptions();

      if (isMulti) {
        if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
          currentTab = (currentTab + 1) % totalTabs;
          syncOptionIndex();
          refresh();
          return;
        }
        if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
          currentTab = (currentTab - 1 + totalTabs) % totalTabs;
          syncOptionIndex();
          refresh();
          return;
        }
      }

      if (currentTab === questions.length) {
        if (matchesKey(data, Key.enter) && allAnswered()) {
          submit(false);
          return;
        }
        if (matchesKey(data, Key.escape)) {
          submit(true);
        }
        return;
      }

      if (matchesKey(data, Key.up)) {
        optionIndex = Math.max(0, optionIndex - 1);
        refresh();
        return;
      }
      if (matchesKey(data, Key.down)) {
        optionIndex = Math.min(Math.max(0, opts.length - 1), optionIndex + 1);
        refresh();
        return;
      }

      if (matchesKey(data, Key.enter) && q) {
        const opt = opts[optionIndex];
        if (!opt) {
          refresh();
          return;
        }
        if (opt.isOther) {
          inputMode = true;
          inputQuestionId = q.id;
          editor.setText("");
          refresh();
          return;
        }

        saveAnswer(q.id, opt.value, opt.label, false, optionIndex + 1);
        advanceAfterAnswer();
        return;
      }

      if (matchesKey(data, Key.escape)) submit(true);
    }

    function render(width: number): string[] {
      if (cachedLines && cachedWidth === width) return cachedLines;

      const lines: string[] = [];
      const q = currentQuestion();
      const opts = currentOptions();
      const add = (s: string) => lines.push(truncateToWidth(s, width));
      const addWrapped = (s: string, firstPrefix = "", continuationPrefix = firstPrefix) => {
        const prefixWidth = Math.max(visibleWidth(firstPrefix), visibleWidth(continuationPrefix));
        const wrapped = wrapTextWithAnsi(s, Math.max(1, width - prefixWidth));
        for (let i = 0; i < wrapped.length; i++) {
          lines.push((i === 0 ? firstPrefix : continuationPrefix) + wrapped[i]);
        }
      };

      add(theme.fg("accent", "─".repeat(width)));

      if (isMulti) {
        const tabs: string[] = ["← "];
        for (let i = 0; i < questions.length; i++) {
          const isActive = i === currentTab;
          const isAnswered = answers.has(questions[i].id);
          const box = isAnswered ? "■" : "□";
          const text = ` ${box} ${questions[i].label} `;
          const styled = isActive
            ? theme.bg("selectedBg", theme.fg("text", text))
            : theme.fg(isAnswered ? "success" : "muted", text);
          tabs.push(`${styled} `);
        }
        const canSubmit = allAnswered();
        const isSubmitTab = currentTab === questions.length;
        const submitText = " ✓ Submit ";
        const submitStyled = isSubmitTab
          ? theme.bg("selectedBg", theme.fg("text", submitText))
          : theme.fg(canSubmit ? "success" : "dim", submitText);
        tabs.push(`${submitStyled} →`);
        add(` ${tabs.join("")}`);
        lines.push("");
      }

      const renderOptions = () => {
        for (let i = 0; i < opts.length; i++) {
          const opt = opts[i];
          const selected = i === optionIndex;
          const prefix = selected ? theme.fg("accent", "> ") : "  ";
          const color = selected ? "accent" : "text";
          if (opt.isOther && inputMode) {
            addWrapped(theme.fg("accent", `${i + 1}. ${opt.label} ✎`), prefix, "     ");
          } else {
            addWrapped(theme.fg(color, `${i + 1}. ${opt.label}`), prefix, "     ");
          }
          if (opt.description) addWrapped(theme.fg("muted", opt.description), "     ", "     ");
        }
      };

      if (inputMode && q) {
        addWrapped(theme.fg("text", q.prompt), " ", " ");
        lines.push("");
        renderOptions();
        lines.push("");
        add(theme.fg("muted", " Your answer:"));
        for (const line of editor.render(width - 2)) add(` ${line}`);
        lines.push("");
        add(theme.fg("dim", " Enter to submit • Esc to cancel"));
      } else if (currentTab === questions.length) {
        add(theme.fg("accent", theme.bold(" Ready to submit")));
        lines.push("");
        for (const question of questions) {
          const answer = answers.get(question.id);
          if (!answer) continue;
          const prefix = answer.wasCustom ? "(wrote) " : "";
          addWrapped(
            `${theme.fg("muted", `${question.label}: `)}${theme.fg("text", prefix + answer.label)}`,
            " ",
            "   ",
          );
        }
        lines.push("");
        if (allAnswered()) add(theme.fg("success", " Press Enter to submit"));
        else {
          const missing = questions
            .filter((question) => !answers.has(question.id))
            .map((question) => question.label)
            .join(", ");
          add(theme.fg("warning", ` Unanswered: ${missing}`));
        }
      } else if (q) {
        addWrapped(theme.fg("text", q.prompt), " ", " ");
        lines.push("");
        renderOptions();
      }

      lines.push("");
      if (!inputMode) {
        const help = isMulti
          ? " Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel"
          : " ↑↓ navigate • Enter select • Esc cancel";
        addWrapped(theme.fg("dim", help.trim()), " ", " ");
      }
      add(theme.fg("accent", "─".repeat(width)));

      cachedLines = lines;
      cachedWidth = width;
      return lines;
    }

    return {
      render,
      invalidate: () => {
        cachedLines = undefined;
        cachedWidth = undefined;
      },
      handleInput,
      dispose: () => {
        signal?.removeEventListener("abort", abort);
      },
    };
  });

  const values: Record<string, string> = {};
  for (const answer of result.answers) values[answer.id] = answer.value;

  return {
    ok: true,
    result,
    values,
  };
}

export function registerQuestionnaireTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "questionnaire",
    label: "Questionnaire",
    description:
      "Ask the user one or more questions. Use for clarifying requirements, getting preferences, or confirming decisions. For single questions, shows a simple option list. For multiple questions, shows a tab-based interface.",
    parameters: QuestionnaireParams,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      const asked = await askQuestionnaire(ctx, params.questions as QuestionnaireQuestion[], signal);
      if (!asked.ok) {
        return {
          content: [{ type: "text", text: asked.error }],
          details: { questions: [], answers: [], cancelled: true },
          isError: true,
        };
      }

      if (asked.result.cancelled) {
        return {
          content: [{ type: "text", text: "User cancelled the questionnaire" }],
          details: asked.result,
        };
      }

      const lines = asked.result.answers.map((answer) => {
        const qLabel = asked.result.questions.find((q) => q.id === answer.id)?.label || answer.id;
        return `${qLabel}: ${answer.value}`;
      });

      return {
        content: [{ type: "text", text: lines.join("\n") }],
        details: asked.result,
      };
    },

    renderCall(args, theme) {
      const questions = (args.questions as QuestionnaireQuestion[]) || [];
      const count = questions.length;
      const labels = questions.map((q) => q.label || q.id).join(", ");
      let text = theme.fg("toolTitle", theme.bold("questionnaire "));
      text += theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`);
      if (labels) text += theme.fg("dim", ` (${truncateToWidth(labels, 40)})`);
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as QuestionnaireUiResult | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      if (details.cancelled) return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      const lines = details.answers.map((answer) => {
        const display = answer.wasCustom ? `${answer.value}` : answer.value;
        return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${display}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
