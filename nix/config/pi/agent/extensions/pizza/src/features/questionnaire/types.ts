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
