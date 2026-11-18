// How the server finds who a message mentions and the page marks them, so the two agree on every edge.
const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// @login or @Full Name, where the @ opens the text or follows a space or "(", and the handle ends there.
export const mentionPattern = (handles: string[], flags = "iu") =>
  new RegExp(`(?<![^\\s(])@(${handles.map(literal).join("|")})(?![\\p{L}\\p{N}_-])`, flags);

// The text around each mention, with the handle as typed at the odd places; the longest handle wins a tie.
export const splitMentions = (text: string, handles: string[]) =>
  handles.length
    ? text.split(
        mentionPattern(
          [...handles].sort((a, b) => b.length - a.length),
          "giu",
        ),
      )
    : [text];
