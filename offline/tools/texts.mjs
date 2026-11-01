// Public-domain editions the quote checker can fetch (Gutenberg, MIT Classics,
// Wikisource). sacred-texts.com sits behind a Cloudflare challenge that
// refuses the verifier, so it is not used. Each entry is cached in
// offline/texts/<key>.txt exactly as verifyQuote sees it, so a quote copied
// from the cache is the wording the checker will look for at source_url.

const pg = (id) => `https://www.gutenberg.org/cache/epub/${id}/pg${id}.txt`;
const pgTitle = (id, title) => `${title}, Project Gutenberg eBook #${id}`;

const T = (key, tradition, thinker, work, translator, id, title, extra = {}) => ({
  key, tradition, thinker, work, translator, source_url: pg(id), source_title: pgTitle(id, title), ...extra,
});

export const TEXTS = [
  // Stoic
  T('marcus-long', 'Stoic', 'Marcus Aurelius', 'Meditations', 'George Long (1862)', 15877, 'Thoughts of Marcus Aurelius Antoninus, tr. George Long'),
  T('seneca-dialogues', 'Stoic', 'Seneca', 'Minor Dialogues (On the Shortness of Life, On Tranquillity of Mind, On Anger, On the Happy Life and others)', 'Aubrey Stewart (1889)', 64576, 'Minor Dialogues, Together With the Dialogue on Clemency, tr. Aubrey Stewart'),
  T('epictetus-long', 'Stoic', 'Epictetus', 'Discourses and Enchiridion', 'George Long (1877)', 10661, 'A Selection from the Discourses of Epictetus with the Encheiridion, tr. George Long'),
  T('epictetus-crossley', 'Stoic', 'Epictetus', 'The Golden Sayings of Epictetus', 'Hastings Crossley (1903)', 871, 'The Golden Sayings of Epictetus, tr. Hastings Crossley'),
  T('epictetus-higginson', 'Stoic', 'Epictetus', 'The Enchiridion', 'Thomas Wentworth Higginson (1865)', 45109, 'The Enchiridion, tr. Thomas Wentworth Higginson'),
  // Seneca's letters: one Wikisource page per letter, added below.

  // Confucian
  T('analects-legge', 'Confucian', 'Confucius', 'The Analects', 'James Legge (2nd revised edition, 1893)', 3330, 'The Analects of Confucius (from the Chinese Classics), tr. James Legge'),
  T('filial-duty-chen', 'Confucian', 'Confucius and Zengzi', 'The Classic of Filial Piety (Hsiao Ching)', 'Ivan Chen (1908)', 75878, 'The Book of Filial Duty, tr. Ivan Chen'),

  // Daoist
  T('laozi-legge', 'Daoist', 'Laozi', 'Tao Te Ching', 'James Legge (1891)', 216, 'The Tao Teh King, or the Tao and its Characteristics, tr. James Legge'),
  T('zhuangzi-giles', 'Daoist', 'Zhuangzi', 'Zhuangzi (Chuang Tzŭ)', 'Herbert A. Giles (1889)', 59709, 'Chuang Tzŭ: Mystic, Moralist, and Social Reformer, tr. Herbert A. Giles'),

  // Buddhist
  T('dhammapada-muller', 'Buddhist', 'The Buddha (attributed)', 'The Dhammapada', 'F. Max Müller (1881)', 2017, 'Dhammapada, a Collection of Verses, tr. F. Max Müller'),
  T('shinran-psalms', 'Buddhist', 'Shinran', 'Buddhist Psalms (Wasan)', 'S. Yamabe and L. Adams Beck (1921)', 7015, 'Buddhist Psalms translated from the Japanese of Shinran Shonin, tr. S. Yamabe and L. Adams Beck'),

  // Hindu and Indian
  T('gita-arnold', 'Hindu', 'Bhagavad Gita', 'The Bhagavad Gita (The Song Celestial)', 'Sir Edwin Arnold (1885)', 2388, 'The Song Celestial; Or, Bhagavad-Gîtâ, tr. Sir Edwin Arnold'),
  T('upanishads-paramananda', 'Hindu', 'The Upanishads', 'The Upanishads', 'Swami Paramananda (1919)', 3283, 'The Upanishads, tr. Swami Paramananda'),
  T('kabir-tagore', 'Hindu', 'Kabir', 'Songs of Kabir', 'Rabindranath Tagore (1915)', 6519, 'Songs of Kabir, tr. Rabindranath Tagore'),
  T('tagore-sadhana', 'Hindu', 'Rabindranath Tagore', 'Sadhana: The Realisation of Life', null, 6842, 'Sadhana: The Realisation of Life'),

  // Ancient Egyptian
  T('ptahhotep-gunn', 'Ancient Egyptian', 'Ptahhotep', 'The Instruction of Ptahhotep (and of Ke\'gemni)', 'Battiscombe G. Gunn (1906)', 30508, 'The Instruction of Ptah-Hotep and the Instruction of Ke\'Gemni, tr. Battiscombe G. Gunn'),

  // Classical Greek (and Roman moralists writing in that line)
  { key: 'aristotle-ross', tradition: 'Classical Greek', thinker: 'Aristotle', work: 'Nicomachean Ethics', translator: 'W. D. Ross (1908)', source_url: 'http://classics.mit.edu/Aristotle/nicomachaen.mb.txt', source_title: 'Nicomachean Ethics, tr. W. D. Ross, The Internet Classics Archive (MIT)' },
  T('plato-apology', 'Classical Greek', 'Plato', 'Apology', 'Benjamin Jowett', 1656, 'Apology, tr. Benjamin Jowett'),
  T('plato-crito', 'Classical Greek', 'Plato', 'Crito', 'Benjamin Jowett', 1657, 'Crito, tr. Benjamin Jowett'),
  T('plato-republic', 'Classical Greek', 'Plato', 'The Republic', 'Benjamin Jowett', 1497, 'The Republic, tr. Benjamin Jowett'),
  T('plato-phaedrus', 'Classical Greek', 'Plato', 'Phaedrus', 'Benjamin Jowett', 1636, 'Phaedrus, tr. Benjamin Jowett'),
  T('plato-gorgias', 'Classical Greek', 'Plato', 'Gorgias', 'Benjamin Jowett', 1672, 'Gorgias, tr. Benjamin Jowett'),
  T('plato-symposium', 'Classical Greek', 'Plato', 'Symposium', 'Benjamin Jowett', 1600, 'Symposium, tr. Benjamin Jowett'),
  T('plato-meno', 'Classical Greek', 'Plato', 'Meno', 'Benjamin Jowett', 1643, 'Meno, tr. Benjamin Jowett'),
  T('xenophon-memorabilia', 'Classical Greek', 'Xenophon', 'Memorabilia', 'H. G. Dakyns (1897)', 1177, 'The Memorabilia, tr. Henry Graham Dakyns'),
  T('hesiod-evelyn-white', 'Classical Greek', 'Hesiod', 'Works and Days', 'Hugh G. Evelyn-White (1914)', 348, 'Hesiod, the Homeric Hymns, and Homerica, tr. Hugh G. Evelyn-White'),
  T('plutarch-tucker', 'Classical Greek', 'Plutarch', 'Moralia (Selected Essays)', 'T. G. Tucker (1913)', 62618, 'Selected Essays of Plutarch, Vol. I, tr. T. G. Tucker'),
  T('boethius-james', 'Classical Greek', 'Boethius', 'The Consolation of Philosophy', 'H. R. James (1897)', 14328, 'The Consolation of Philosophy, tr. H. R. James'),

  // Islamic and Persian
  T('rumi-davis', 'Islamic and Persian', 'Rumi', 'Masnavi and Divan (selections)', 'F. Hadland Davis (1907)', 45159, 'The Persian Mystics: Jalálu\'d-dín Rúmí, tr. F. Hadland Davis'),
  T('rumi-redhouse', 'Islamic and Persian', 'Rumi', 'The Masnavi, Book I', 'Sir James W. Redhouse (1881)', 61724, 'The Mesnevi, tr. Sir James W. Redhouse'),
  T('saadi-gulistan-ross', 'Islamic and Persian', 'Saadi', 'The Gulistan (The Rose Garden)', 'James Ross (1823)', 13060, 'The Persian Literature, Volume 2 (The Gulistan, tr. James Ross)'),
  T('saadi-bustan-edwards', 'Islamic and Persian', 'Saadi', 'The Bustan (The Orchard)', 'A. Hart Edwards (1911)', 60471, 'The Bustān of Sadi, tr. A. Hart Edwards'),
  T('hafiz-bell', 'Islamic and Persian', 'Hafiz', 'The Divan', 'Gertrude Lowthian Bell (1897)', 74883, 'Poems from the Divan of Hafiz, tr. Gertrude Lowthian Bell'),
  T('ghazali-confessions', 'Islamic and Persian', 'Al-Ghazali', 'The Confessions (Deliverance from Error)', 'Claud Field (1909)', 58977, 'The Confessions of Al Ghazzali, tr. Claud Field'),
  T('ghazali-teachings', 'Islamic and Persian', 'Al-Ghazali', 'Ihya Ulum al-Din (extracts)', 'Syed Nawab Ali (1920)', 73140, 'Some Religious and Moral Teachings of Al-Ghazzali, tr. Syed Nawab Ali'),

  // Renaissance and early modern
  T('montaigne-cotton', 'Renaissance and early modern', 'Michel de Montaigne', 'Essays', 'Charles Cotton (1685), ed. W. C. Hazlitt', 3600, 'Essays of Michel de Montaigne — Complete, tr. Charles Cotton'),
  T('spinoza-elwes', 'Renaissance and early modern', 'Baruch Spinoza', 'Ethics', 'R. H. M. Elwes (1883)', 3800, 'Ethics, tr. R. H. M. Elwes'),
  T('pascal-trotter', 'Renaissance and early modern', 'Blaise Pascal', 'Pensées', 'W. F. Trotter (1910)', 18269, 'Pascal\'s Pensées, tr. W. F. Trotter'),
  T('bacon-essays', 'Renaissance and early modern', 'Francis Bacon', 'Essays, Civil and Moral', null, 575, 'The Essays or Counsels, Civil and Moral'),
  T('rochefoucauld-friswell', 'Renaissance and early modern', 'François de La Rochefoucauld', 'Maxims', 'J. Hain Friswell (1871)', 9105, 'Reflections; or Sentences and Moral Maxims, tr. J. Hain Friswell'),

  // American
  T('emerson-essays-1', 'American', 'Ralph Waldo Emerson', 'Essays: First Series', null, 2944, 'Essays — First Series'),
  T('emerson-essays-2', 'American', 'Ralph Waldo Emerson', 'Essays: Second Series', null, 2945, 'Essays — Second Series'),
  T('emerson-conduct', 'American', 'Ralph Waldo Emerson', 'The Conduct of Life', null, 39827, 'The Conduct of Life'),
  T('thoreau-walden', 'American', 'Henry David Thoreau', 'Walden', null, 205, 'Walden, and On The Duty Of Civil Disobedience'),
  T('james-will', 'American', 'William James', 'The Will to Believe, and Other Essays', null, 26659, 'The Will to Believe, and Other Essays in Popular Philosophy'),
  T('james-pragmatism', 'American', 'William James', 'Pragmatism', null, 5116, 'Pragmatism: A New Name for Some Old Ways of Thinking'),
  T('james-talks', 'American', 'William James', 'Talks to Teachers on Psychology; and to Students on Some of Life\'s Ideals', null, 16287, 'Talks To Teachers On Psychology; And To Students On Some Of Life\'s Ideals'),
  T('washington-up-from-slavery', 'American', 'Booker T. Washington', 'Up from Slavery', null, 2376, 'Up from Slavery: An Autobiography'),

  // Jewish
  T('avot-gorfinkle', 'Jewish', 'Pirkei Avot', 'Pirkei Avot (Sayings of the Fathers)', 'Joseph I. Gorfinkle (1913)', 8547, 'Pirke Avot: The Sayings of the Jewish Fathers, tr. Joseph I. Gorfinkle'),
  T('maimonides-friedlander', 'Jewish', 'Moses Maimonides', 'The Guide for the Perplexed', 'M. Friedländer (1904)', 73584, 'The Guide for the Perplexed, tr. M. Friedländer'),
  T('apocrypha-wisdom', 'Jewish', 'Ben Sira', 'Ecclesiasticus (The Wisdom of Ben Sira) and the Wisdom of Solomon', 'Wisdom of the East series (1910)', 77250, 'The Wisdom of the Apocrypha'),

  // Japanese
  T('okakura-tea', 'Japanese', 'Okakura Kakuzō', 'The Book of Tea', null, 769, 'The Book of Tea'),
  T('nitobe-bushido', 'Japanese', 'Nitobe Inazō', 'Bushido, the Soul of Japan', null, 12096, 'Bushido, the Soul of Japan'),
];

for (let n = 1; n <= 124; n++) {
  TEXTS.push({
    key: `seneca-letter-${String(n).padStart(3, '0')}`,
    tradition: 'Stoic', thinker: 'Seneca', work: 'Moral Letters to Lucilius', locator: `Letter ${n}`,
    translator: 'Richard M. Gummere (1917–1925)',
    source_url: `https://en.wikisource.org/wiki/Moral_letters_to_Lucilius/Letter_${n}`,
    source_title: `Moral Letters to Lucilius, Letter ${n}, tr. Richard M. Gummere (Wikisource)`,
  });
}

export const byKey = new Map(TEXTS.map((t) => [t.key, t]));
export const byUrl = new Map(TEXTS.map((t) => [t.source_url, t]));
