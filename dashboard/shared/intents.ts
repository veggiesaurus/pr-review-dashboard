// What a note asks for, when the user says: a change, an answer, or a change only if it is trivial.
export const NOTE_INTENTS = ["fix", "question", "nit"] as const;
export type NoteIntent = (typeof NOTE_INTENTS)[number];
