/**
 * Правовые документы хранятся как данные, а не как вёрстка: три документа
 * устроены одинаково, и общий рендерер сам собирает оглавление и якоря.
 * Правка текста тогда не задевает разметку, а разметка — текста.
 */

/** Абзац, маркированный или нумерованный список. */
export type LegalBlock =
  | string
  | { list: string[] }
  | { ordered: string[] };

export interface LegalSection {
  /** Якорь в адресе страницы. На него ссылаются из других документов. */
  id: string;
  title: string;
  blocks: LegalBlock[];
}

export interface LegalDoc {
  title: string;
  /** Абзац под заголовком, до оглавления. */
  intro?: string;
  sections: LegalSection[];
}

export interface FaqItem {
  id: string;
  question: string;
  /** Абзацы ответа. */
  answer: LegalBlock[];
}
