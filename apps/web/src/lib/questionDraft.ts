import { CHOICE_TYPES, KEYED_TYPES, type ChoiceOption } from '@/lib/forms';

/** The fields every question has, in the form the editors keep them while typing. */
export interface QuestionDraft {
  type: string;
  text: string;
  points: string;
  options: ChoiceOption[];
  answer: string;
  bloom: string;
}

/** Starting options for a question type. */
export const optionsFor = (type: string): ChoiceOption[] =>
  type === 'TRUE_FALSE'
    ? [
        { text: 'True', isCorrect: true },
        { text: 'False', isCorrect: false },
      ]
    : [
        { text: '', isCorrect: true },
        { text: '', isCorrect: false },
      ];

export const blankQuestion = (type = 'MULTIPLE_CHOICE'): QuestionDraft => ({
  type,
  text: '',
  points: '1',
  options: optionsFor(type),
  answer: '',
  bloom: '',
});

/** The part of a question request that is the same for the bank and for a quiz. */
export const questionBody = (d: QuestionDraft) => ({
  questionText: d.text.trim(),
  questionType: d.type,
  points: Number(d.points) || 1,
  optionsJson: CHOICE_TYPES.includes(d.type)
    ? d.options.filter((o) => o.text.trim()).map((o) => ({ ...(o.id ? { id: o.id } : {}), text: o.text.trim(), isCorrect: o.isCorrect }))
    : null,
  correctAnswer: KEYED_TYPES.includes(d.type) ? d.answer.trim() : null,
  bloomLevel: d.bloom || null,
});
