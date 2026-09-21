/* Story text format: tokens separated by spaces (the spaces are not shown for Chinese).
   A token may carry a link to an object in the pop-up scene and an action to play on it:
     {小星星:star/fall}  ->  text "小星星", object "star", action "fall"
   tools/build_voice.py splits text the same way; timings.json has one entry per token. */

const LINK = /^([^{]*)\{([^}:]+)(?::([^}]+))?\}(.*)$/;
export const PUNCT = /[，。！？：；、,.!?:;“”"'‘’（）()…—\s]/g;

export function tokenize(text) {
  return text.split(/\s+/).filter(Boolean).map((raw, index) => {
    const m = raw.match(LINK);
    if (m) {
      const [target, action] = (m[3] || "").split("/");
      return { index, text: m[1] + m[2] + m[4], word: m[2], link: target || null, action: action || null };
    }
    return { index, text: raw, word: raw.replace(PUNCT, ""), link: null, action: null };
  });
}

/** Spoken length of a token in characters (punctuation is silent). */
export function spokenWeight(text) {
  return [...text.replace(PUNCT, "")].length;
}
