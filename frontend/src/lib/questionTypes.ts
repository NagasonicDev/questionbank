/** Format a question type key as a readable title. */
export function formatQuestionType(typeKey: string): string {
  return typeKey
    .replace(/_/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
