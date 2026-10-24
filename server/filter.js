// Cogwild chat filter: typed chat (friends, party, club) and club descriptions go through it on the server, so every
// game version gets the same filtering.
//  - swear words, slurs and sexual words (English and Hebrew) become ****, also when hidden with symbols, numbers,
//    spaces or repeated letters ("f u c k", "sh1t", "fuuuck", "f.u.c.k")
//  - links, email addresses and phone numbers become [hidden] (kids shouldn't share where to find them)
'use strict';

// whole words only (they'd hit normal words inside longer ones: "ass" in "class", "cum" in "cucumber")
const WORDS = [
  'ass', 'arse', 'asses', 'bastard', 'bitch', 'bitches', 'bollocks', 'boner', 'boob', 'boobs', 'butthole', 'cock', 'cocks',
  'cum', 'cunt', 'cunts', 'damn', 'dick', 'dicks', 'dildo', 'dyke', 'fag', 'fags', 'fap', 'hoe', 'hoes', 'homo', 'jizz',
  'kys', 'milf', 'nazi', 'nude', 'nudes', 'piss', 'porn', 'prick', 'pussy', 'rape', 'raped', 'retard', 'retarded', 'sex',
  'sexy', 'slut', 'sluts', 'spic', 'stfu', 'tit', 'tits', 'twat', 'wank', 'wanker', 'whore', 'whores', 'wtf', 'gtfo',
  'כוס', 'זין', 'זונה', 'שרמוטה', 'שרמוטות', 'מניאק', 'מניאקים', 'בנזונה', 'זיון', 'מזדיין', 'תזדיין', 'הומו', 'קוקסינל', 'מפגר', 'זונות', 'כוסית',
];
// anywhere inside a word (long or unusual enough not to hit normal words)
const PARTS = [
  'fuck', 'fuk', 'fck', 'shit', 'bullshit', 'motherf', 'asshole', 'dickhead', 'nigger', 'nigga', 'niggas', 'faggot',
  'cocksucker', 'blowjob', 'handjob', 'masturbat', 'orgasm', 'penis', 'vagina', 'pornhub', 'xvideos', 'hentai',
  'killyourself', 'kysnow', 'hitler', 'retard', 'whore', 'slutty', 'pussies', 'bitchass', 'jerkoff', 'tranny',
  'בןזונה', 'יאזונה', 'כוסאמק', 'כוסעמק', 'כוסאוחתק', 'כוסאחתק', 'לךתזדיין', 'מזדיינים', 'שרמוט',
];

// how a letter can be disguised
const LOOK = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't', '€': 'e', '¡': 'i' };
const norm = (s) => s.toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '') // accents, Hebrew vowel marks
  .replace(/[013457 89@$!|+€¡]/g, (ch) => LOOK[ch] || ch);
const squeeze = (s) => s.replace(/(.)\1+/g, '$1'); // fuuuck -> fuck
const twice = (s) => s.replace(/(.)\1{2,}/g, '$1$1'); // asssshole -> asshole (doubles stay doubles)
const letters = (s) => s.replace(/[^a-zא-ת]/g, '');
// squeezing ("fuuuck" -> "fuck") is only compared with bad words that have no double letters: otherwise "boob" would
// squeeze to "bob" and "nigger" to "niger" and catch normal names
const WORD_SET = new Set(WORDS);
const WORD_SINGLE = new Set(WORDS.filter((w) => squeeze(w) === w));
const PART_SINGLE = PARTS.filter((w) => squeeze(w) === w);

const LINK = /\b(?:https?:\/\/|www\.)\S+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|gg|io|me|tv|xyz|ru|co|il|uk|de|app|link|ly|to)\b(?:\/\S*)?/gi;
const EMAIL = /[^\s@]+@[^\s@]+\.[a-z]{2,}/gi;
const PHONE = /(?:\+?\d[\d\s().-]{6,}\d)/g; // 8+ digits with spaces/dashes: phone numbers
const HANDLE = /(?:discord|insta|instagram|snap|snapchat|tiktok|whatsapp|telegram)\s*[:@]?\s*[\w.#-]{3,}/gi;

// one token is bad (after undoing disguises)
function badToken(t) {
  const n = norm(t), l = letters(n), sq = squeeze(l), tw = twice(l);
  if (!l) return false;
  if (WORD_SET.has(l) || WORD_SET.has(tw) || WORD_SINGLE.has(sq)) return true;
  return PARTS.some((p) => l.includes(p) || tw.includes(p)) || PART_SINGLE.some((p) => sq.includes(p));
}

// the text with bad words starred out and contact details hidden
function clean(text) {
  let s = String(text || '');
  s = s.replace(EMAIL, '[hidden]').replace(LINK, '[hidden]').replace(PHONE, (m) => (m.replace(/\D/g, '').length >= 8 ? '[hidden]' : m)).replace(HANDLE, '[hidden]');
  // word by word
  s = s.replace(/[^\s]+/g, (tok) => (badToken(tok) ? stars(tok) : tok));
  // spelled out with gaps: "f u c k", "f.u.c.k", "f-u-c-k" (single letters in a row)
  s = s.replace(/(?:^|\s)((?:[^\s][\s._*-]+){2,}[^\s])(?=\s|$)/g, (all, seq) => {
    const joined = letters(norm(seq));
    return joined.length >= 3 && badToken(joined) ? all.replace(seq, stars(seq.replace(/[\s._*-]/g, ''))) : all;
  });
  return s;
}
const stars = (t) => '*'.repeat(Math.max(3, Math.min(8, [...t].length)));
// any bad word at all (names: refuse instead of starring)
function isBad(text) { return clean(text) !== String(text || ''); }

module.exports = { clean, isBad };
